import { simpleParser } from 'mailparser'
import { ImapFlow } from 'imapflow'
import type { SecretStore } from '../services/secrets'
import type { VentureNotification } from '@shared/ventures'
import type { VentureStore } from './store'

export const MAIL_PASSWORD_KEY = 'ventures.mail.password'
const SF = 'etsy'
const SNIPPET_MAX = 140
const ETSY_FROM = /@([a-z0-9-]+\.)*etsy\.com$/i
const ETSY_URL = /^https:\/\/www\.etsy\.com\//

export interface ParsedMessage {
  messageId: string
  sender: string
  subject: string
  snippet: string
  at: string
  url: string
}

const noAddresses = (s: string) => s.replace(/\S+@\S+/g, '').replace(/\s+/g, ' ').trim()

/**
 * Reads one Etsy "new message" notification email. Returns null for anything that is not clearly from Etsy about a
 * message. The result never holds an email address or the full body: only sender name, subject, a short snippet, the
 * time and a link that opens the conversation on Etsy.
 */
export async function parseEtsyMessageEmail(raw: string | Buffer): Promise<ParsedMessage | null> {
  let mail
  try {
    mail = await simpleParser(raw)
  } catch {
    return null
  }
  const fromAddr = mail.from?.value?.[0]?.address ?? ''
  if (!ETSY_FROM.test(fromAddr)) return null
  const subject = noAddresses(mail.subject ?? '')
  if (!/message|conversation|convo/i.test(subject)) return null

  const named = /(?:from|message from)\s+(.+?)(?:\s+on\s+Etsy)?$/i.exec(subject)?.[1]
  const display = noAddresses(mail.from?.value?.[0]?.name ?? '')
  const sender = noAddresses(named ?? '') || (display && !/etsy/i.test(display) ? display : 'Etsy buyer')

  const text = mail.text ?? ''
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//i.test(l) && !/wrote:?$/i.test(l) && !/^view message/i.test(l))
  const snippet = noAddresses(lines.join(' ')).slice(0, SNIPPET_MAX)

  const link = (text.match(/https:\/\/www\.etsy\.com\/[^\s<>)"']+/g) ?? []).find((u) => /messages|convo/i.test(u))
  const url = link && ETSY_URL.test(link) ? link : 'https://www.etsy.com/messages'

  const at = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date.toISOString() : new Date().toISOString()
  return { messageId: mail.messageId ?? `${at}:${sender}:${subject}`, sender, subject, snippet, at, url }
}

export interface MailboxConfig {
  host: string
  port: number
  user: string
  password: string
  folder: string
}

export interface ImapSource {
  fetchUnseen(cfg: MailboxConfig): Promise<Array<string | Buffer>>
}

/** The real mailbox reader. Read only: it never marks, moves or deletes anything. */
export const realImap: ImapSource = {
  async fetchUnseen(cfg) {
    const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.password }, logger: false })
    await client.connect()
    const out: Buffer[] = []
    try {
      const lock = await client.getMailboxLock(cfg.folder, { readOnly: true })
      try {
        const since = new Date(Date.now() - 30 * 86_400_000)
        const uids = ((await client.search({ seen: false, since })) || []).slice(-50)
        for (const uid of uids) {
          const m = await client.fetchOne(String(uid), { source: true }, { uid: true })
          if (m && m.source) out.push(m.source)
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
    return out
  },
}

export interface PollerDeps {
  secrets: SecretStore
  imap: ImapSource
  store: VentureStore
  notify: (n: Omit<VentureNotification, 'id' | 'read'>, key: string) => void
  now: () => number
}

/** Checks the mailbox for new Etsy message emails. Does nothing until the mailbox is set up. */
export class MessagePoller {
  constructor(private d: PollerDeps) {}

  config(): MailboxConfig | null {
    const host = this.d.store.getState(SF, 'mail_host')
    const user = this.d.store.getState(SF, 'mail_user')
    const password = this.d.secrets.get(MAIL_PASSWORD_KEY)
    if (!host || !user || !password) return null
    return { host, port: Number(this.d.store.getState(SF, 'mail_port') ?? 993), user, password, folder: this.d.store.getState(SF, 'mail_folder') || 'INBOX' }
  }

  /** How many new messages were stored. */
  async poll(): Promise<number> {
    const cfg = this.config()
    if (!cfg) return 0
    let added = 0
    for (const raw of await this.d.imap.fetchUnseen(cfg)) {
      const m = await parseEtsyMessageEmail(raw)
      if (!m) continue
      const key = `message:${m.messageId}`
      if (!this.d.store.addMessage(SF, { dedupeKey: key, sender: m.sender, subject: m.subject, snippet: m.snippet, at: m.at, url: m.url })) continue
      added++
      this.d.notify(
        { storefront: SF, kind: 'message', title: `New message from ${m.sender}`, detail: m.snippet ? `${m.subject}: ${m.snippet}` : m.subject, at: m.at, url: m.url },
        key,
      )
    }
    return added
  }
}
