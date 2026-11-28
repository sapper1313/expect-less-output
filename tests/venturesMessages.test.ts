import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEnv } from './helpers'
import { SecretStore } from '../src/main/services/secrets'
import { VentureStore } from '../src/main/ventures/store'
import { MessagePoller, parseEtsyMessageEmail, MAIL_PASSWORD_KEY } from '../src/main/ventures/messages'

const fakeCrypto = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('enc:' + s), decryptString: (b: Buffer) => b.toString().slice(4) }
const mail = (over: { from?: string; subject?: string; body?: string; headers?: string; contentType?: string; encoding?: string } = {}) =>
  [
    `From: ${over.from ?? 'Etsy Conversations <convo@etsy.com>'}`,
    'To: seller@example.com',
    `Subject: ${over.subject ?? 'You have a new message from Sam Rivers on Etsy'}`,
    'Date: Mon, 01 Jun 2026 12:00:00 +0000',
    'Message-ID: <abc123@etsy.com>',
    'MIME-Version: 1.0',
    `Content-Type: ${over.contentType ?? 'text/plain; charset=utf-8'}`,
    `Content-Transfer-Encoding: ${over.encoding ?? '7bit'}`,
    over.headers ?? '',
    '',
    over.body ??
      'Sam Rivers wrote:\n\nHi, is the blue mug still available? You can reach me at sam@private.com.\n\nView message: https://www.etsy.com/messages/12345?ref=email\n',
  ].join('\r\n')

describe('parseEtsyMessageEmail', () => {
  it('reads sender, subject, snippet, time and link without any email address', async () => {
    const m = await parseEtsyMessageEmail(mail())
    expect(m).not.toBeNull()
    expect(m!.sender).toBe('Sam Rivers')
    expect(m!.subject).toContain('new message')
    expect(m!.snippet).toContain('is the blue mug still available')
    expect(m!.at).toBe('2026-06-01T12:00:00.000Z')
    expect(m!.url).toBe('https://www.etsy.com/messages/12345?ref=email')
    // The Message-ID is Etsy's own technical id used only to avoid duplicates. Everything shown has no address.
    expect(JSON.stringify({ ...m, messageId: '' })).not.toContain('@')
    expect(m!.snippet.length).toBeLessThanOrEqual(140)
  })
  it('handles base64 and quoted-printable bodies', async () => {
    const text = 'Sam wrote:\n\nCafé mug question\n\nhttps://www.etsy.com/messages/9\n'
    const b64 = await parseEtsyMessageEmail(mail({ body: Buffer.from(text).toString('base64'), encoding: 'base64' }))
    expect(b64!.snippet).toContain('Café mug question')
    const qp = await parseEtsyMessageEmail(mail({ body: 'Sam wrote:\r\n\r\nCaf=C3=A9 mug question\r\n\r\nhttps://www.etsy.com/messages/9\r\n', encoding: 'quoted-printable' }))
    expect(qp!.snippet).toContain('Café mug question')
  })
  it('truncates a long snippet', async () => {
    const m = await parseEtsyMessageEmail(mail({ body: 'Sam wrote:\n\n' + 'word '.repeat(200) }))
    expect(m!.snippet.length).toBeLessThanOrEqual(140)
  })
  it('returns null for a non-Etsy sender, a non-message subject, or junk', async () => {
    expect(await parseEtsyMessageEmail(mail({ from: 'Scam <x@evil.com>' }))).toBeNull()
    expect(await parseEtsyMessageEmail(mail({ from: 'Etsy <x@etsy.com.evil.com>' }))).toBeNull()
    expect(await parseEtsyMessageEmail(mail({ subject: 'Your weekly shop stats' }))).toBeNull()
    expect(await parseEtsyMessageEmail('not an email at all')).toBeNull()
  })
  it('falls back to the Etsy messages page when the email has no usable link', async () => {
    const m = await parseEtsyMessageEmail(mail({ body: 'Sam wrote:\n\nhello\n\nhttps://evil.example.com/steal\n' }))
    expect(m!.url).toBe('https://www.etsy.com/messages')
  })
})

describe('MessagePoller', () => {
  const setup = (cfg: boolean) => {
    const store = new VentureStore(makeEnv().db)
    const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'elo-m-')), 's.json'), fakeCrypto)
    if (cfg) {
      store.setState('etsy', 'mail_host', 'imap.example.com')
      store.setState('etsy', 'mail_user', 'me@example.com')
      store.setState('etsy', 'mail_folder', 'Etsy')
      secrets.set(MAIL_PASSWORD_KEY, 'MAILPASSWORD')
    }
    const notes: string[] = []
    const seen: Array<{ host: string; password: string }> = []
    const poller = new MessagePoller({
      secrets,
      store,
      now: () => Date.UTC(2026, 5, 2),
      notify: (n, key) => void (store.addNotification(n, key) && notes.push(n.title)),
      imap: { fetchUnseen: async (c) => (seen.push({ host: c.host, password: c.password }), [mail(), mail()]) },
    })
    return { poller, store, notes, seen }
  }
  it('stores a message once and notifies once', async () => {
    const { poller, store, notes } = setup(true)
    expect(await poller.poll()).toBe(1)
    expect(await poller.poll()).toBe(0)
    expect(notes).toEqual(['New message from Sam Rivers'])
    expect(store.notifications('etsy')[0].detail).toContain('is the blue mug')
  })
  it('does nothing without mailbox settings', async () => {
    const { poller, seen } = setup(false)
    expect(await poller.poll()).toBe(0)
    expect(seen).toHaveLength(0)
  })
})
