import { describe, it, expect } from 'vitest'
import { PrimaryBackupAdapter } from '../src/main/adapters/primaryBackup'
import { AdapterError, ambiguous, unreachableIf, type AdapterContext, type PlatformAdapter } from '../src/main/adapters/types'
import { UploadPostVideoAdapter } from '../src/main/adapters/uploadPostVideo'

function ctx(): AdapterContext & { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {}
  return {
    state,
    postId: 1,
    targetId: 7,
    brandId: 3,
    brandName: 'Test',
    title: 'T',
    caption: 'C',
    aiFlag: false,
    videoAbsPath: '/x/video.mp4',
    externalId: null,
    videoDurationSeconds: 10,
    videoSizeBytes: 100,
    scheduledAtUtc: '2026-11-15T00:00:00.000Z',
    account: null,
    getState: () => ({ ...state }),
    setState: (p: Record<string, unknown>) => Object.assign(state, p),
    settings: {},
    nowMs: () => 1_000_000,
    reportProgress: () => undefined,
  } as never
}

function fake(name: string, over: Partial<PlatformAdapter> = {}, calls: string[] = []): PlatformAdapter {
  return {
    platform: 'youtube',
    wantsHandoff: () => false,
    minHandoffLeadMs: () => 0,
    connect: async () => undefined,
    refreshIfNeeded: async () => undefined,
    validate: async () => {
      calls.push(`${name}.validate`)
    },
    publish: async () => {
      calls.push(`${name}.publish`)
      return { status: 'posted', externalId: name }
    },
    checkStatus: async () => {
      calls.push(`${name}.check`)
      return { status: 'posted', externalId: name }
    },
    ...over,
  }
}

const host = (log: string[] = []) => ({
  log: (_l: string, m: string) => void log.push(m),
  onFallback: (_c: AdapterContext, r: string) => void log.push(`FALLBACK ${r}`),
})

describe('primary and backup posting', () => {
  it('uses Upload-Post and never touches the backup when it works', async () => {
    const calls: string[] = []
    const a = new PrimaryBackupAdapter('youtube', fake('up', {}, calls), fake('elo', {}, calls), host())
    const c = ctx()
    const r = await a.publish(c)
    expect(r.externalId).toBe('up')
    expect(calls.filter((x) => x.startsWith('elo'))).toEqual([])
    expect(c.state.route).toBeUndefined()
  })

  it('falls back to ELO after a definite Upload-Post failure, and remembers it', async () => {
    const calls: string[] = []
    const log: string[] = []
    const up = fake('up', { publish: async () => { throw new AdapterError('Username not associated with any profile', 'permanent') } }, calls)
    const a = new PrimaryBackupAdapter('youtube', up, fake('elo', {}, calls), host(log))
    const c = ctx()
    const r = await a.publish(c)
    expect(r.externalId).toBe('elo')
    expect(c.state.route).toBe('elo')
    expect(String(c.state.upFailure)).toContain('Username not associated')
    expect(log.some((l) => l.startsWith('FALLBACK'))).toBe(true)
    // later calls stay on the backup
    expect((await a.checkStatus(c, 1)).externalId).toBe('elo')
  })

  it('never falls back when the outcome is unsure (the video may already be out)', async () => {
    const calls: string[] = []
    const up = fake('up', { checkStatus: async () => { throw ambiguous(new AdapterError('lost track', 'transient')) } }, calls)
    const a = new PrimaryBackupAdapter('youtube', up, fake('elo', {}, calls), host())
    const c = ctx()
    await expect(a.checkStatus(c, 1)).rejects.toThrow('lost track')
    expect(c.state.route).toBeUndefined()
    expect(calls.filter((x) => x.startsWith('elo'))).toEqual([])
  })

  it('falls back only on the second "cannot reach Upload-Post" answer', async () => {
    const calls: string[] = []
    const up = fake('up', { publish: async () => { throw unreachableIf(new AdapterError('no net', 'transient'), 0) } }, calls)
    const a = new PrimaryBackupAdapter('youtube', up, fake('elo', {}, calls), host())
    const c = ctx()
    await expect(a.publish(c)).rejects.toThrow('no net')
    expect(c.state.route).toBeUndefined()
    const r = await a.publish(c)
    expect(r.externalId).toBe('elo')
    expect(c.state.route).toBe('elo')
  })

  it('reports both reasons when the backup fails too', async () => {
    const up = fake('up', { publish: async () => { throw new AdapterError('up broke', 'permanent') } })
    const elo = fake('elo', { publish: async () => { throw new AdapterError('elo broke', 'transient') } })
    const a = new PrimaryBackupAdapter('youtube', up, elo, host())
    await expect(a.publish(ctx())).rejects.toThrow(/up broke.*elo broke/)
  })

  it('a validate failure on Upload-Post moves to the backup when the backup can take it', async () => {
    const up = fake('up', { validate: async () => { throw new AdapterError('no profile', 'permanent') } })
    const a = new PrimaryBackupAdapter('youtube', up, fake('elo'), host())
    const c = ctx()
    await a.validate(c)
    expect(c.state.route).toBe('elo')
  })
})

describe('Upload-Post video adapter', () => {
  const deps = (client: any) => ({
    client,
    apiKey: () => 'k',
    profileFor: () => 'prof',
    fieldsFor: () => ({ fields: { title: 'T' } }),
    host: { log: () => undefined },
  })

  it('sends once, then reports posted with the platform url', async () => {
    const sent: string[] = []
    const client = {
      uploadVideo: async (_k: string, i: { platform: string }) => void sent.push(i.platform),
      status: async () => ({ status: 'completed', results: [{ platform: 'facebook', success: true, postId: '99', postUrl: 'https://fb.com/x' }] }),
    }
    const a = new UploadPostVideoAdapter('facebook', deps(client) as never)
    const c = ctx()
    const first = await a.publish(c)
    expect(first.status).toBe('processing')
    expect(sent).toEqual(['facebook'])
    const done = await a.checkStatus(c)
    expect(done).toMatchObject({ status: 'posted', externalId: '99', externalUrl: 'https://fb.com/x' })
  })

  it('a failed result is a clear error and not marked unsure', async () => {
    const client = {
      uploadVideo: async () => undefined,
      status: async () => ({ status: 'completed', results: [{ platform: 'youtube', success: false, message: 'reauth needed' }] }),
    }
    const a = new UploadPostVideoAdapter('youtube', deps(client) as never)
    const c = ctx()
    await a.publish(c)
    await expect(a.checkStatus(c)).rejects.toMatchObject({ kind: 'permanent', ambiguous: undefined })
  })
})
