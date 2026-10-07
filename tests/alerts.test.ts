import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AlertService } from '../src/main/alerts/service'
import {
  formatAlert,
  formatBatch,
  MAX_ALERT_CHARS,
  type AlertItem,
} from '../src/main/alerts/format'
import {
  PERMISSION_HELP,
  SIGNED_OUT_HELP,
  normalizeNumber,
  resetIMessageMemory,
  sendIMessage,
  type ScriptRunner,
} from '../src/main/alerts/imessage'
import { SecretStore } from '../src/main/services/secrets'
import { DEFAULT_SETTINGS } from '../src/main/services/settings'
import type { Settings } from '../src/shared/types'
import { fakeCrypto } from './googleHelpers'
import { makeEnv } from './helpers'
import type { Notifier } from '../src/main/scheduler/scheduler'

const MIN = 60_000
const HOUR = 60 * MIN

const failure = (n = 1): AlertItem => ({
  kind: 'failure',
  headline: 'Could not post. Probably for the best.',
  detail: 'x',
  platform: 'Instagram',
  brand: 'Trash Panda',
  title: `Fridge Math ${n}`,
  whenUtc: '2026-06-02T21:00:00.000Z',
  reason: 'token expired',
})

describe('alert text', () => {
  it('uses the exact failure format', () => {
    expect(formatAlert(failure())).toBe(
      'Could not post. Probably for the best. Instagram, Trash Panda, "Fridge Math 1", Tue Jun 2, 5:00 PM ET. Reason: token expired. Open Expect Less Output to retry.',
    )
  })

  it('stays under 300 characters even with a huge title and reason', () => {
    const big = { ...failure(), title: 'T'.repeat(400), reason: 'because '.repeat(80) }
    const text = formatAlert(big)
    expect(text.length).toBeLessThanOrEqual(MAX_ALERT_CHARS)
    expect(text).toContain('Open Expect Less Output')
    expect(text.startsWith('Could not post. Probably for the best.')).toBe(true)
    const other = formatAlert({
      kind: 'expiry',
      headline: 'Meta sign-in runs out soon.',
      detail: 'y'.repeat(500),
    })
    expect(other.length).toBeLessThanOrEqual(MAX_ALERT_CHARS)
  })

  it('combines many alerts into one short message and says how many were left out', () => {
    const items = Array.from({ length: 12 }, (_, i) => failure(i))
    const text = formatBatch(items, 'busy')
    expect(text.length).toBeLessThanOrEqual(MAX_ALERT_CHARS)
    expect(text).toMatch(/^12 alerts in a few minutes\./)
    expect(text).toMatch(/and \d+ more\./)
    expect(formatBatch([failure()], 'busy')).toBe(formatAlert(failure()))
    expect(formatBatch(items.slice(0, 2), 'quiet')).toMatch(/^2 alerts while you were away\./)
  })
})

describe('iMessage sender', () => {
  beforeEach(() => resetIMessageMemory())
  const ok: ScriptRunner = async () => ({ stdout: '', stderr: '' })

  it('passes the number and text as arguments, never inside the script', async () => {
    const calls: Array<{ script: string; args: string[] }> = []
    const r = await sendIMessage(
      '+1 (804) 634-0444',
      'hello "quoted" \\ text',
      async (script, args) => {
        calls.push({ script, args })
        return { stdout: '', stderr: '' }
      },
    )
    expect(r.ok).toBe(true)
    expect(calls[0].args).toEqual(['+18046340444', 'hello "quoted" \\ text'])
    expect(calls[0].script).not.toContain('quoted')
    expect(normalizeNumber('+1 804-634-0444')).toBe('+18046340444')
    expect(normalizeNumber('abc')).toBeNull()
    expect((await sendIMessage('abc', 'x', ok)).message).toContain(
      'does not look like a phone number',
    )
  })

  it('tries the second AppleScript form when the first fails, and remembers what worked', async () => {
    const seen: string[] = []
    const runner: ScriptRunner = async (script) => {
      seen.push(script.includes('participant') ? 'participant' : 'buddy')
      if (script.includes('participant'))
        throw Object.assign(new Error('x'), {
          stderr: 'execution error: Messages got an error: Invalid key form. (-1728)',
        })
      return { stdout: '', stderr: '' }
    }
    expect((await sendIMessage('+18046340444', 'a', runner)).ok).toBe(true)
    expect(seen).toEqual(['participant', 'buddy'])
    seen.length = 0
    await sendIMessage('+18046340444', 'b', runner)
    expect(seen).toEqual(['buddy']) // went straight to the one that works
  })

  it('gives the exact permission steps and does not keep trying', async () => {
    let n = 0
    const r = await sendIMessage('+18046340444', 'a', async () => {
      n++
      throw Object.assign(new Error('x'), {
        stderr: 'Not authorized to send Apple events to Messages. (-1743)',
      })
    })
    expect(r).toEqual({ ok: false, message: PERMISSION_HELP })
    expect(n).toBe(1)
    expect(PERMISSION_HELP).toContain('System Settings')
    expect(PERMISSION_HELP).toContain('Automation')
  })

  it('explains when Messages is not signed in and when both forms fail for another reason', async () => {
    const signedOut = await sendIMessage('+18046340444', 'a', async () => {
      throw Object.assign(new Error('x'), {
        stderr: "Can't get account whose service type = iMessage. (-1728)",
      })
    })
    expect(signedOut).toEqual({ ok: false, message: SIGNED_OUT_HELP })
    const other = await sendIMessage('+18046340444', 'a', async () => {
      throw Object.assign(new Error('boom'), { stderr: 'something odd' })
    })
    expect(other.ok).toBe(false)
    expect(other.message).toContain('Messages would not send it')
  })
})

describe('AlertService', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elo-alerts-'))
  const make = (patch: Partial<Settings> = {}, startMs = Date.UTC(2026, 5, 2, 18, 0, 0)) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mediaRoot: dir, ...patch }
    const clock = { ms: startMs }
    const sent: string[] = []
    const local: string[][] = []
    const logs: string[] = []
    const mails: Array<{ subject: string; text: string; to: string }> = []
    const secrets = new SecretStore(
      join(mkdtempSync(join(tmpdir(), 'elo-as-')), 's.bin'),
      fakeCrypto,
    )
    let iMessageResult = { ok: true, message: 'Sent through Messages.' }
    let mailFails: Error | null = null
    const svc = new AlertService({
      getSettings: () => settings,
      secrets,
      showLocal: (h, d) => local.push([h, d]),
      log: (_l, m) => logs.push(m),
      now: () => clock.ms,
      sendIMessage: async (_n, text) => {
        if (iMessageResult.ok) sent.push(text)
        return iMessageResult
      },
      mailer: async (o) => {
        if (mailFails) throw mailFails
        mails.push({ subject: o.subject, text: o.text, to: o.to })
      },
      mediaRoot: () => settings.mediaRoot,
    })
    return {
      svc,
      settings,
      clock,
      sent,
      local,
      logs,
      mails,
      secrets,
      setIMessage: (r: typeof iMessageResult) => (iMessageResult = r),
      failMail: (e: Error | null) => (mailFails = e),
    }
  }

  it('shows every alert on screen and sends exactly one iMessage for one failure', async () => {
    const t = make()
    await t.svc.alert(failure())
    expect(t.local).toHaveLength(1)
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toContain('Instagram, Trash Panda, "Fridge Math 1"')
  })

  it('sends the first 3 right away and the rest as one combined message when the window ends', async () => {
    const t = make()
    for (let i = 1; i <= 6; i++) {
      await t.svc.alert(failure(i))
      t.clock.ms += 10_000
    }
    expect(t.local).toHaveLength(6) // all six shown on screen
    expect(t.sent).toHaveLength(3)
    await t.svc.processDue()
    expect(t.sent).toHaveLength(3) // window still open
    t.clock.ms += 5 * MIN
    await t.svc.processDue()
    expect(t.sent).toHaveLength(4)
    expect(t.sent[3]).toMatch(/^3 alerts in a few minutes\./)
    await t.svc.processDue()
    expect(t.sent).toHaveLength(4) // nothing more to send
    // a later failure goes out on its own again
    t.clock.ms += 6 * MIN
    await t.svc.alert(failure(9))
    expect(t.sent).toHaveLength(5)
  })

  it('holds iMessage during quiet hours and sends one summary when they end, with the screen alert still shown', async () => {
    // 23:00 Eastern on June 2 is 03:00 UTC June 3
    const t = make(
      { alertQuietEnabled: true, alertQuietStart: '22:00', alertQuietEnd: '08:00' },
      Date.UTC(2026, 5, 3, 3, 0, 0),
    )
    await t.svc.alert(failure(1))
    await t.svc.alert(failure(2))
    expect(t.local).toHaveLength(2)
    expect(t.sent).toHaveLength(0)
    t.clock.ms += 4 * HOUR // 03:00 Eastern, still quiet
    await t.svc.processDue()
    expect(t.sent).toHaveLength(0)
    t.clock.ms += 5.1 * HOUR // after 08:00 Eastern
    await t.svc.processDue()
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatch(/^2 alerts while you were away\./)
  })

  it('does not hold anything when quiet hours are off', async () => {
    const t = make({ alertQuietEnabled: false }, Date.UTC(2026, 5, 3, 5, 0, 0))
    await t.svc.alert(failure())
    expect(t.sent).toHaveLength(1)
  })

  it('sends tests for each channel and never batches or holds a test', async () => {
    const t = make({ alertQuietEnabled: true, alertQuietStart: '00:00', alertQuietEnd: '23:59' })
    const r = await t.svc.sendTest('imessage')
    expect(r.ok).toBe(true)
    expect(t.sent[0]).toContain('test alert')
    expect((await t.svc.sendTest('notification')).ok).toBe(true)
    expect(t.local[0][0]).toBe('Test alert')
    // email needs addresses and the app password first
    expect((await t.svc.sendTest('email')).message).toContain('from and to')
    t.settings.alertEmailFrom = 'me@gmail.com'
    t.settings.alertEmailTo = 'me@gmail.com'
    expect((await t.svc.sendTest('email')).message).toContain('app password')
    t.svc.saveEmailPassword('abcd efgh ijkl mnop')
    expect(t.svc.status()).toMatchObject({ emailPasswordSet: true })
    expect(t.svc.status().emailPasswordMasked).not.toContain('abcd')
    const e = await t.svc.sendTest('email')
    expect(e.ok).toBe(true)
    expect(t.mails[0].to).toBe('me@gmail.com')
  })

  it('sends email too when it is on, and says why when Gmail refuses', async () => {
    const t = make({
      alertEmailEnabled: true,
      alertEmailFrom: 'me@gmail.com',
      alertEmailTo: 'you@x.com',
    })
    t.svc.saveEmailPassword('abcdefghijklmnop')
    await t.svc.alert(failure())
    expect(t.sent).toHaveLength(1)
    expect(t.mails).toHaveLength(1)
    expect(t.mails[0].text).toContain('Fridge Math 1')
    t.failMail(
      Object.assign(new Error('Invalid login: 535 5.7.8 Username and Password not accepted'), {}),
    )
    const r = await t.svc.sendTest('email')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('16 character app password')
  })

  it('tells you on screen when the iMessage could not be sent, without looping', async () => {
    const t = make()
    t.setIMessage({ ok: false, message: PERMISSION_HELP })
    await t.svc.alert(failure())
    expect(t.local.map((l) => l[0])).toEqual([
      'Could not post. Probably for the best.',
      'Could not send the iMessage alert',
    ])
    expect(t.sent).toHaveLength(0)
  })

  it('does nothing remote when no channel is on', async () => {
    const t = make({ alertIMessageEnabled: false })
    await t.svc.alert(failure())
    expect(t.local).toHaveLength(1)
    expect(t.sent).toHaveLength(0)
  })

  it('alerts once when the Media Root goes missing, and again only after it comes back and goes away', async () => {
    const t = make()
    const gone = join(dir, 'missing-drive')
    t.settings.mediaRoot = gone
    await t.svc.checkMediaRoot()
    await t.svc.checkMediaRoot()
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toContain('Media Root folder is missing.')
    t.settings.mediaRoot = dir
    await t.svc.checkMediaRoot()
    t.settings.mediaRoot = gone
    await t.svc.checkMediaRoot()
    expect(t.sent).toHaveLength(2)
    rmSync(gone, { force: true })
  })
})

describe('forced failure through the real scheduler', () => {
  it('sends exactly one iMessage after the final retry, in the required format', async () => {
    const sent: string[] = []
    const settingsRef: { env: ReturnType<typeof makeEnv> | null } = { env: null }
    const alerts = new AlertService({
      getSettings: () => settingsRef.env!.settings.get(),
      secrets: new SecretStore(join(mkdtempSync(join(tmpdir(), 'elo-s2-')), 's.bin'), fakeCrypto),
      showLocal: () => {},
      log: () => {},
      now: () => settingsRef.env!.clock.ms,
      sendIMessage: async (_n, text) => {
        sent.push(text)
        return { ok: true, message: 'ok' }
      },
    })
    const notifier: Notifier = {
      failure: (h, d, meta) =>
        void alerts.alert({ kind: meta?.kind ?? 'other', headline: h, detail: d, ...meta }),
      missed: (h, d, meta) =>
        void alerts.alert({ kind: 'missed', headline: h, detail: d, ...meta }),
      success: () => {},
    }
    const env = makeEnv(Date.UTC(2026, 5, 1, 12, 0, 0), { notifier })
    settingsRef.env = env
    env.settings.set({ dryRunFailPlatform: 'instagram', dryRunFailKind: 'transient' })
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram'],
      title: 'Fridge Math',
    })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick() // attempt 1
    for (const wait of [2 * MIN, 10 * MIN, 30 * MIN]) {
      expect(sent).toHaveLength(0) // nothing is sent while it is still retrying
      env.clock.ms += wait + 1000
      await env.scheduler.tick()
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(env.posts.get(post.id)!.targets[0].status).toBe('failed')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(
      /^Could not post\. Probably for the best\. Instagram, Trash Panda, "Fridge Math", .* ET\. Reason: .* Open Expect Less Output to retry\.$/,
    )
    expect(sent[0].length).toBeLessThanOrEqual(300)
  })
})
