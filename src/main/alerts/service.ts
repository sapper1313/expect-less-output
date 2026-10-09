import { existsSync } from 'fs'
import { DateTime } from 'luxon'
import type { SecretStore } from '../services/secrets'
import { mask } from '../services/secrets'
import type { Settings, AlertChannel, AlertStatus, AlertTestResult } from '@shared/types'
import { ZONE } from '@shared/time'
import { explainMailError, sendGmail, type Mailer } from './email'
import { formatAlert, formatBatch, type AlertItem } from './format'
import { sendIMessage, type IMessageResult } from './imessage'

export const EMAIL_PASSWORD_KEY = 'alert.email_app_password'
export const BATCH_LIMIT = 3
export const BATCH_WINDOW_MS = 5 * 60_000

export interface AlertDeps {
  getSettings: () => Settings
  secrets: SecretStore
  /** macOS notification and an in-app message. Always shown, even in quiet hours. */
  showLocal: (headline: string, detail: string) => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  now?: () => number
  sendIMessage?: (number: string, text: string) => Promise<IMessageResult>
  mailer?: Mailer
  /** Folder that must exist for posting to work. */
  mediaRoot?: () => string
}

/**
 * Failure alerts. Every alert shows on screen right away. iMessage and email go through two filters:
 * quiet hours (held, then sent as one summary) and batching (the first 3 in 5 minutes go out at once,
 * the rest are sent as one combined message).
 */
export class AlertService {
  private recent: number[] = []
  private batch: AlertItem[] = []
  private batchFlushAt: number | null = null
  private held: AlertItem[] = []
  private mediaRootAlerted = false
  private timer: NodeJS.Timeout | null = null
  private lastMediaCheck = 0

  constructor(private d: AlertDeps) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------- public ----------

  async alert(item: AlertItem): Promise<void> {
    this.d.showLocal(item.headline, item.detail)
    this.d.log(item.kind === 'test' ? 'info' : 'error', `Alert: ${formatAlert(item)}`)
    await this.remote(item)
  }

  /** Sends one plain message (iMessage and email) right now, without the alert batching. Used for the morning digest. */
  async broadcast(text: string): Promise<void> {
    this.d.log('info', 'Sending a message to the owner.')
    await this.sendText(text)
  }

  status(): AlertStatus {
    const pw = this.d.secrets.get(EMAIL_PASSWORD_KEY)
    return { emailPasswordSet: !!pw, emailPasswordMasked: pw ? mask(pw) : '' }
  }

  saveEmailPassword(pw: string): AlertStatus {
    const clean = pw.replace(/\s+/g, '')
    if (!clean) throw new Error('Paste the 16 character app password first.')
    this.d.secrets.set(EMAIL_PASSWORD_KEY, clean)
    return this.status()
  }

  async sendTest(channel: AlertChannel): Promise<AlertTestResult> {
    const s = this.d.getSettings()
    const text =
      'Expect Less Output test alert. If you can read this, alerts are working. Nothing is wrong.'
    if (channel === 'notification') {
      this.d.showLocal('Test alert', 'If you can see this, macOS notifications are working.')
      return { ok: true, message: 'Sent a macOS notification.' }
    }
    if (channel === 'imessage') {
      const r = await this.sendOneIMessage(s.alertIMessageNumber, text)
      this.d.log(r.ok ? 'info' : 'error', `iMessage test: ${r.message}`)
      return r
    }
    const r = await this.sendOneEmail(s, 'Expect Less Output test alert', text)
    this.d.log(r.ok ? 'info' : 'error', `Email test: ${r.message}`)
    return r
  }

  /** Run every few seconds. Releases held and batched alerts when their time comes, and checks the Media Root. */
  async processDue(): Promise<void> {
    const now = this.now()
    if (this.held.length && !this.inQuietHours(now)) {
      const items = this.held
      this.held = []
      await this.sendText(formatBatch(items, 'quiet'))
      this.recent.push(now)
    }
    if (this.batch.length && this.batchFlushAt !== null && now >= this.batchFlushAt) {
      const items = this.batch
      this.batch = []
      this.batchFlushAt = null
      await this.sendText(formatBatch(items, 'busy'))
      this.recent.push(now)
    }
    if (this.d.mediaRoot && now - this.lastMediaCheck >= 5 * 60_000) {
      this.lastMediaCheck = now
      await this.checkMediaRoot()
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.processDue().catch(() => {}), 15_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Alerts once when the Media Root disappears (for example an unplugged drive), and again if it comes back and goes away. */
  async checkMediaRoot(): Promise<void> {
    if (!this.d.mediaRoot) return
    const root = this.d.mediaRoot()
    if (!existsSync(root)) {
      if (!this.mediaRootAlerted) {
        this.mediaRootAlerted = true
        await this.alert({
          kind: 'media_root',
          headline: 'Media Root folder is missing.',
          detail: `Expect Less Output cannot find ${root}. If it is on a drive, plug the drive back in. Posts cannot go out until it is back.`,
        })
      }
    } else this.mediaRootAlerted = false
  }

  // ---------- filters ----------

  private inQuietHours(nowMs: number): boolean {
    const s = this.d.getSettings()
    if (!s.alertQuietEnabled) return false
    const t = DateTime.fromMillis(nowMs, { zone: ZONE })
    const minutes = t.hour * 60 + t.minute
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + (m || 0)
    }
    const start = toMin(s.alertQuietStart)
    const end = toMin(s.alertQuietEnd)
    if (start === end) return false
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
  }

  private anyRemote(): boolean {
    const s = this.d.getSettings()
    return (
      (s.alertIMessageEnabled && !!s.alertIMessageNumber) ||
      (s.alertEmailEnabled && !!s.alertEmailTo)
    )
  }

  private async remote(item: AlertItem): Promise<void> {
    if (item.kind === 'test' || !this.anyRemote()) return
    const now = this.now()
    if (this.inQuietHours(now)) {
      this.held.push(item)
      return
    }
    this.recent = this.recent.filter((t) => now - t < BATCH_WINDOW_MS)
    if (this.batch.length === 0 && this.recent.length < BATCH_LIMIT) {
      this.recent.push(now)
      await this.sendText(formatAlert(item))
      return
    }
    this.batch.push(item)
    if (this.batchFlushAt === null)
      this.batchFlushAt = Math.max(now + 1000, (this.recent[0] ?? now) + BATCH_WINDOW_MS)
  }

  // ---------- sending ----------

  private async sendText(text: string): Promise<void> {
    const s = this.d.getSettings()
    if (s.alertIMessageEnabled && s.alertIMessageNumber) {
      const r = await this.sendOneIMessage(s.alertIMessageNumber, text)
      this.d.log(
        r.ok ? 'info' : 'error',
        r.ok ? 'iMessage alert sent.' : `iMessage alert could not be sent: ${r.message}`,
      )
      if (!r.ok) this.d.showLocal('Could not send the iMessage alert', r.message)
    }
    if (s.alertEmailEnabled && s.alertEmailTo) {
      const r = await this.sendOneEmail(s, 'Expect Less Output alert', text)
      this.d.log(
        r.ok ? 'info' : 'error',
        r.ok ? 'Email alert sent.' : `Email alert could not be sent: ${r.message}`,
      )
      if (!r.ok) this.d.showLocal('Could not send the email alert', r.message)
    }
  }

  private async sendOneIMessage(number: string, text: string): Promise<IMessageResult> {
    return (this.d.sendIMessage ?? sendIMessage)(number, text)
  }

  private async sendOneEmail(s: Settings, subject: string, text: string): Promise<AlertTestResult> {
    const pw = this.d.secrets.get(EMAIL_PASSWORD_KEY)
    if (!s.alertEmailFrom || !s.alertEmailTo)
      return { ok: false, message: 'Fill in the from and to email addresses first.' }
    if (!pw) return { ok: false, message: 'Save the Gmail app password first.' }
    try {
      await (this.d.mailer ?? sendGmail)({
        from: s.alertEmailFrom,
        to: s.alertEmailTo,
        appPassword: pw,
        subject,
        text,
      })
      return { ok: true, message: `Email sent to ${s.alertEmailTo}.` }
    } catch (err) {
      return { ok: false, message: explainMailError(err) }
    }
  }
}
