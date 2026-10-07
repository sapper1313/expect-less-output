import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { resumableUpload } from '../src/main/google/uploader'
import { QuotaTracker } from '../src/main/google/quota'
import { buildVideoMetadata, tagsFromText } from '../src/main/google/metadata'
import { AdapterError } from '../src/main/adapters/types'
import { SecretStore } from '../src/main/services/secrets'
import { refreshTokenKey } from '../src/main/google/config'
import { connectBrand, fakeCrypto, makeGoogleEnv } from './googleHelpers'
import { makeEnv } from './helpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
async function env(opts?: Parameters<typeof makeGoogleEnv>[0]) {
  const g = await makeGoogleEnv(opts)
  closers.push(g.close)
  return g
}
const tmpFile = (bytes: number) => {
  const p = join(mkdtempSync(join(tmpdir(), 'elo-up-')), 'v.mp4')
  writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

describe('sign in (against the fake Google)', () => {
  it('connects one channel, uses PKCE, saves the refresh token encrypted, and shows the Connected page', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    expect(acct.mode).toBe('manual_assist')
    expect(acct.displayName).toBe('Fake Channel')
    expect(acct.externalId).toBe('UC_FAKE_1')
    expect(g.secrets.has(refreshTokenKey(acct.id))).toBe(true)
    expect(g.secrets.status([refreshTokenKey(acct.id)])[0].masked).toMatch(/^\*+/)
    const req = g.fake.state.tokenRequests[0]
    expect(req.code_verifier).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(g.browserPages[0]).toContain('Connected.')
    expect(g.browserPages[0]).toContain('You can close this tab and return to Expect Less Output.')
  })

  it('asks which channel when the account has several, then saves the chosen one', async () => {
    const g = await env()
    g.fake.state.channels = [
      { id: 'UC_A', title: 'Channel A' },
      { id: 'UC_B', title: 'Channel B' },
    ]
    const r = await g.service.connect(2)
    expect(r.status).toBe('pick')
    if (r.status !== 'pick') return
    expect(r.channels.map((c) => c.title)).toEqual(['Channel A', 'Channel B'])
    const done = g.service.finishConnect(r.sessionId, 'UC_B')
    expect(done.status === 'connected' && done.account.displayName).toBe('Channel B')
    expect(() => g.service.finishConnect(r.sessionId, 'UC_B')).toThrow(/expired/)
  })

  it('refuses a channel already linked to another brand', async () => {
    const g = await env()
    await connectBrand(g, 1)
    await expect(g.service.connect(2)).rejects.toThrow(/already connected to Trash Panda/)
  })

  it('explains a missing refresh token', async () => {
    const g = await env()
    g.fake.state.omitRefreshToken = true
    await expect(g.service.connect(1)).rejects.toThrow(/long-lived sign-in/)
  })

  it('needs the Client ID and Secret first', async () => {
    const g = await env()
    g.secrets.delete('google.client_id')
    await expect(g.service.connect(1)).rejects.toThrow(/Client ID and Client Secret/)
  })

  it('can be canceled and times out', async () => {
    const g = await env({ signInTimeoutMs: 150 })
    g.service['d'].openBrowser = async () => {}
    await expect(g.service.connect(1)).rejects.toThrow(/timed out/)
    const g2 = await env()
    g2.service['d'].openBrowser = async () => {}
    const p = g2.service.connect(1)
    setTimeout(() => g2.service.cancelConnect(), 80)
    await expect(p).rejects.toThrow(/canceled/)
  })

  it('stores Client ID and Secret encrypted and shows them masked', async () => {
    const g = await env()
    const st = g.service.saveCredentials(
      'abc123.apps.googleusercontent.com',
      'GOCSPX-supersecretvalue',
    )
    expect(st.hasClientId && st.hasClientSecret).toBe(true)
    expect(st.clientSecretMasked).not.toContain('supersecret')
    expect(st.clientSecretMasked.endsWith('alue')).toBe(true)
  })

  it('disconnect revokes the token, deletes the secret and returns to a dry run placeholder', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    await g.service.disconnect(1)
    expect(g.fake.state.revoked.length).toBe(1)
    expect(g.secrets.has(refreshTokenKey(acct.id))).toBe(false)
    const row = g.env.db
      .prepare('SELECT mode, external_id FROM accounts WHERE id = ?')
      .get(acct.id) as any
    expect(row).toEqual({ mode: 'dry_run', external_id: null })
  })

  it('sets the mode only for connected channels', async () => {
    const g = await env()
    expect(() => g.service.setMode(1, 'auto')).toThrow(/Connect a YouTube channel/)
    await connectBrand(g)
    g.service.setMode(1, 'test_private')
    expect(
      (
        g.env.db
          .prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'youtube'")
          .get() as any
      ).mode,
    ).toBe('test_private')
  })
})

describe('tokens', () => {
  it('refreshes once and reuses the token, then refreshes again after it expires', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    const before = g.fake.state.refreshCount
    const a = await g.tokens.getAccessToken(acct.id)
    const b = await g.tokens.getAccessToken(acct.id)
    expect(a).toBe(b)
    expect(g.fake.state.refreshCount).toBe(before + 1)
    g.env.clock.ms += 2 * 3600_000
    const c = await g.tokens.getAccessToken(acct.id)
    expect(c).not.toBe(a)
  })

  it('marks needs_reauth once and raises the alert when Google says invalid_grant', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    g.fake.state.refreshInvalid = true
    await expect(g.tokens.getAccessToken(acct.id, true)).rejects.toMatchObject({
      kind: 'permanent',
    })
    expect(
      (g.env.db.prepare('SELECT status FROM accounts WHERE id = ?').get(acct.id) as any).status,
    ).toBe('needs_reauth')
    expect(g.reauth).toEqual([acct.id])
    await expect(g.tokens.getAccessToken(acct.id, true)).rejects.toThrow(/sign in again/)
    expect(g.reauth).toEqual([acct.id]) // no second alert
  })

  it('treats a network failure as temporary, not a dead sign-in', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    await g.fake.close()
    await expect(g.tokens.getAccessToken(acct.id, true)).rejects.toMatchObject({
      kind: 'transient',
    })
    expect(
      (g.env.db.prepare('SELECT status FROM accounts WHERE id = ?').get(acct.id) as any).status,
    ).toBe('connected')
  })

  it('the daily health check keeps working accounts and flags dead ones', async () => {
    const g = await env()
    await connectBrand(g)
    await g.service.checkHealth(true)
    g.fake.state.refreshInvalid = true
    g.env.clock.ms += 2 * 3600_000
    g.tokens.forget(1)
    await g.service.checkHealth(true)
    expect(
      (
        g.env.db
          .prepare("SELECT status FROM accounts WHERE brand_id = 1 AND platform = 'youtube'")
          .get() as any
      ).status,
    ).toBe('needs_reauth')
  })
})

describe('resumable upload', () => {
  const run = async (
    g: Awaited<ReturnType<typeof env>>,
    bytes: number,
    extra: Partial<Parameters<typeof resumableUpload>[0]> = {},
    beforeUpload?: () => void,
  ) => {
    const acct = await connectBrand(g)
    beforeUpload?.()
    const progress: number[] = []
    const video = await resumableUpload({
      initUrl: `${g.urls.uploadUrl}?uploadType=resumable&part=snippet,status`,
      accessToken: (f) => g.tokens.getAccessToken(acct.id, f),
      metadata: { snippet: { title: 't' }, status: { privacyStatus: 'private' } },
      filePath: tmpFile(bytes),
      fileSize: bytes,
      chunkSize: 256 * 1024,
      sleep: async () => {},
      onProgress: (s, t) => progress.push(s / t),
      ...extra,
    })
    return { video, progress }
  }

  it('uploads in chunks with progress', async () => {
    const g = await env()
    const { video, progress } = await run(g, 700 * 1024)
    expect(video.id).toBeTruthy()
    expect(g.fake.state.uploads[0].bytes).toBe(700 * 1024)
    expect(progress[progress.length - 1]).toBe(1)
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true)
  })

  it('resumes from the server offset after the connection drops mid chunk', async () => {
    const g = await env()
    g.fake.state.putFault = (n) => (n === 2 ? 'drop' : null)
    const { video } = await run(g, 700 * 1024)
    expect(video.id).toBeTruthy()
    expect(g.fake.state.uploads).toHaveLength(1) // one session, never restarted
    expect(g.fake.state.uploads[0].bytes).toBe(700 * 1024)
  })

  it('retries a 503 and carries on', async () => {
    const g = await env()
    g.fake.state.putFault = (n) => (n === 1 ? '503' : null)
    const { video } = await run(g, 300 * 1024)
    expect(video.id).toBeTruthy()
  })

  it('starts a fresh session when a saved one has expired', async () => {
    const g = await env()
    const sessions: Array<string | null> = []
    const { video } = await run(g, 300 * 1024, {
      sessionUrl: `${g.fake.base}/upload/session/s-expired`,
      onSession: (u) => sessions.push(u),
    })
    expect(video.id).toBeTruthy()
    expect(sessions[0]).toBeNull() // old one cleared
    expect(g.fake.state.uploads).toHaveLength(1)
  })

  it('refreshes the token once after a 401 and finishes', async () => {
    const g = await env()
    const { video } = await run(g, 100 * 1024, {}, () => {
      g.fake.state.auth401Once = true
    })
    expect(video.id).toBeTruthy()
  })

  it('gives up with a clear temporary error when the server keeps failing', async () => {
    const g = await env()
    g.fake.state.putFault = () => '503'
    await expect(run(g, 100 * 1024, { maxFailures: 3 })).rejects.toMatchObject({
      kind: 'transient',
    })
  })

  it('stops on a permanent Google error', async () => {
    const g = await env()
    const acct = await connectBrand(g)
    await expect(
      resumableUpload({
        initUrl: `${g.fake.base}/upload/nope`,
        accessToken: (f) => g.tokens.getAccessToken(acct.id, f),
        metadata: {},
        filePath: tmpFile(10),
        fileSize: 10,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ kind: 'permanent' })
  })
})

describe('quota', () => {
  it('counts by Pacific day, warns once at 80 percent, and resets at midnight Pacific', () => {
    const env = makeEnv()
    const warns: string[] = []
    let now = Date.UTC(2026, 5, 1, 6, 59) // 23:59 Pacific on May 31
    const q = new QuotaTracker(
      env.db,
      () => now,
      (b, u, l) => warns.push(`${b}:${u}/${l}`),
    )
    expect(q.dayPt()).toBe('2026-05-31')
    for (let i = 0; i < 79; i++) q.record('videoInsert')
    expect(warns).toEqual([])
    q.record('videoInsert')
    expect(warns).toEqual(['uploads:80/100'])
    q.record('videoInsert')
    expect(warns).toHaveLength(1)
    expect(q.uploadsLeft()).toBe(19)
    now += 2 * 60_000 // 00:01 Pacific on June 1
    expect(q.dayPt()).toBe('2026-06-01')
    expect(q.uploadsLeft()).toBe(100)
    q.record('playlistItemInsert')
    q.record('channelsList')
    expect(q.status().other.used).toBe(51)
  })
})

describe('video metadata', () => {
  const base = {
    title: 'Fridge Math',
    caption: 'Hello\n\n#trashpanda #Shorts #funny #trashpanda',
    categoryId: '28',
    madeForKids: false,
    aiFlag: true,
    appendShorts: false,
    privacy: 'private' as const,
  }

  it('builds snippet and status with the AI flag, tags without #, and publishAt', () => {
    const m = buildVideoMetadata({ ...base, publishAt: '2026-06-01T21:00:00-04:00' })
    expect(m.snippet.tags).toEqual(['trashpanda', 'Shorts', 'funny'])
    expect(m.snippet.categoryId).toBe('28')
    expect(m.status).toEqual({
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      publishAt: '2026-06-02T01:00:00.000Z',
    })
  })

  it('appends #Shorts only when the brand setting is on and it is not already there', () => {
    expect(
      buildVideoMetadata({ ...base, caption: 'Hi', appendShorts: true }).snippet.description,
    ).toBe('Hi\n\n#Shorts')
    expect(
      buildVideoMetadata({ ...base, caption: 'Hi #shorts', appendShorts: true }).snippet
        .description,
    ).toBe('Hi #shorts')
    expect(buildVideoMetadata({ ...base, caption: 'Hi' }).snippet.description).toBe('Hi')
  })

  it('rejects bad titles and descriptions with permanent errors', () => {
    expect(() => buildVideoMetadata({ ...base, title: '' })).toThrow(AdapterError)
    expect(() => buildVideoMetadata({ ...base, title: 'x'.repeat(101) })).toThrow(/limit is 100/)
    expect(() => buildVideoMetadata({ ...base, title: 'a < b' })).toThrow(/< and >/)
    expect(() => buildVideoMetadata({ ...base, caption: 'y'.repeat(5001) })).toThrow(
      /limit is 5000/,
    )
    expect(() =>
      buildVideoMetadata({ ...base, privacy: 'public', publishAt: '2026-06-01T00:00:00Z' }),
    ).toThrow(/must start as private/)
  })

  it('keeps tags inside YouTube size limits', () => {
    const many = Array.from({ length: 200 }, (_, i) => `#tag${i}longer`).join(' ')
    const tags = tagsFromText(many)
    expect(tags.join('').length + tags.length).toBeLessThanOrEqual(480)
  })
})

describe('secret store', () => {
  it('never returns raw values from status', () => {
    const s = new SecretStore(join(mkdtempSync(join(tmpdir(), 'elo-s-')), 'x.bin'), fakeCrypto)
    s.set('k', 'topsecretvalue1234')
    const st = s.status(['k', 'missing'])
    expect(st[0].masked).toBe('********1234')
    expect(JSON.stringify(st)).not.toContain('topsecret')
    expect(st[1].has).toBe(false)
  })
})
