import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { makeStudioEnv } from './helpers'
import { recommendModels, remoteSetupSteps } from '../../src/shared/studio/localModels'

let servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))))
  servers = []
})

/** A fake Ollama on a random port. */
function fakeOllama(installed: string[]) {
  const state = { models: [...installed], pulled: [] as string[], chats: 0, embeds: 0 }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (obj: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(obj))
      }
      if (req.url === '/api/version') return send({ version: '0.9.9' })
      if (req.url === '/api/tags') return send({ models: state.models.map((name) => ({ name })) })
      if (req.url === '/api/ps') return send({ models: [] })
      if (req.url === '/api/embed') {
        state.embeds++
        const input = JSON.parse(body).input as string[]
        return send({ embeddings: input.map((_, i) => [1, i, 0.5]) })
      }
      if (req.url === '/api/chat') {
        state.chats++
        return send({ message: { content: 'A flat orange square.' } })
      }
      if (req.url === '/api/pull') {
        const name = JSON.parse(body).name as string
        if (name === 'nonexistent') {
          res.statusCode = 404
          return res.end('{"error":"model not found"}')
        }
        res.write(JSON.stringify({ status: 'pulling', total: 100, completed: 40 }) + '\n')
        res.write(JSON.stringify({ status: 'pulling', total: 100, completed: 100 }) + '\n')
        state.pulled.push(name)
        state.models.push(name)
        return res.end(JSON.stringify({ status: 'success' }) + '\n')
      }
      res.statusCode = 404
      res.end('{}')
    })
  })
  servers.push(server)
  return new Promise<{ url: string; state: typeof state; server: Server }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, server })),
  )
}

const cfgLocal = (e: ReturnType<typeof makeStudioEnv>, patch: Record<string, unknown>) =>
  e.studio.cfg.set({ local: { ...e.studio.cfg.get().local, whisperCommand: 'echo {audio}', ...patch } as never })

describe('Local AI (remote Ollama host)', () => {
  it('detects installed and missing pieces over the network, downloads models, and passes the self test', async () => {
    const f = await fakeOllama(['nomic-embed-text:latest'])
    const e = makeStudioEnv()
    cfgLocal(e, { ollamaHost: f.url, visionModel: 'moondream', embedModel: 'nomic-embed-text' })
    let list = await e.studio.localChecklist()
    const by = (id: string) => list.find((i) => i.id === id)!
    expect(by('ollama').ok).toBe(true)
    expect(by('embed').ok).toBe(true)
    expect(by('vision').ok).toBe(false)
    expect(by('vision').fix.length).toBeGreaterThan(0)
    expect(by('ffmpeg').ok).toBe(true)

    const done = await e.studio.localPull()
    expect(done).toEqual(['moondream', 'nomic-embed-text'])
    expect(f.state.pulled).toContain('moondream')
    expect((await e.studio.localPullProgress()).find((p) => p.model === 'moondream')?.pct).toBe(100)
    list = await e.studio.localChecklist()
    expect(list.find((i) => i.id === 'vision')!.ok).toBe(true)

    const t = await e.studio.localSelfTest()
    expect(t.vision.ok).toBe(true)
    expect(t.embed.ok).toBe(true)
    expect(t.whisper.ok).toBe(true)
    const m = e.studio.cfg.get().local.measured
    expect(m.vision).toBeGreaterThanOrEqual(0)
    expect(e.studio.localAi.estimateQcSeconds()).toBeGreaterThanOrEqual(0)
  })

  it('moving to another machine needs only a new host URL, with no restart', async () => {
    const a = await fakeOllama(['moondream:latest', 'nomic-embed-text:latest'])
    const b = await fakeOllama([])
    const e = makeStudioEnv()
    cfgLocal(e, { ollamaHost: a.url })
    expect((await e.studio.localChecklist()).find((i) => i.id === 'vision')!.ok).toBe(true)
    cfgLocal(e, { ollamaHost: b.url })
    expect((await e.studio.localChecklist()).find((i) => i.id === 'vision')!.ok).toBe(false)
    await e.studio.localAi.embed(['x'])
    expect(b.state.embeds).toBe(1)
    expect(a.state.embeds).toBe(0)
  })

  it('a bad model name is reported plainly', async () => {
    const f = await fakeOllama([])
    const e = makeStudioEnv()
    cfgLocal(e, { ollamaHost: f.url, visionModel: 'nonexistent', embedModel: '' })
    await expect(e.studio.localPull()).rejects.toThrow(/could not start downloading "nonexistent"/)
  })

  it('falls back without a crash when the remote machine is unreachable, in the documented order', async () => {
    const f = await fakeOllama(['moondream'])
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 12) })
    cfgLocal(e, { ollamaHost: f.url, visionModel: 'moondream' })
    expect((await e.studio.localAi.describeFrames('what is this', ['AAAA'])).via).toBe('ollama')
    await new Promise((r) => f.server.close(r))
    servers = []

    // (1) ffmpeg and Whisper checks only
    const one = await e.studio.localAi.describeFrames('what is this', ['AAAA'])
    expect(one).toEqual({ via: 'ffmpeg-only', text: '' })
    // (3) repetition guard uses the keyword check
    expect(await e.studio.localAi.embed(['a'])).toEqual({ via: 'keyword', vectors: null })
    // (2) Claude vision, when the owner turned it on, with cost in the ledger and counted against the AI text cap
    cfgLocal(e, { useClaudeVision: true })
    e.studio.mockLlm.respond('Video QC', () => 'It is a flat square.')
    const two = await e.studio.localAi.describeFrames('what is this', ['AAAA'], { brandId: 1 })
    expect(two.via).toBe('claude')
    expect(e.db.prepare("SELECT vendor FROM spend_ledger WHERE purpose = 'text'").get()).toEqual({ vendor: 'anthropic' })
    // which fallback was used is logged
    const acts = e.studio.audit.list({ agent: 'Local AI' }).map((a) => a.action)
    expect(acts).toEqual(expect.arrayContaining(['fallback_ffmpeg_only', 'fallback_keyword_repetition_check', 'fallback_claude_vision']))
    // unreachable time is tracked for the watchdog
    e.clock.ms += 3 * 3600_000
    expect(e.studio.localAi.unreachableForMs()).toBeGreaterThan(2 * 3600_000)
  })

  it('recommends small models for an old CPU only laptop, and gives setup steps for both systems', () => {
    const old = recommendModels(8, false)
    expect(old.tier).toBe('tiny')
    expect(old.warning).toMatch(/minute or more/)
    expect(old.vision[0].name).toBe('moondream')
    expect(recommendModels(64, true).tier).toBe('large')
    const steps = remoteSetupSteps()
    expect(steps.windows.join(' ')).toMatch(/OLLAMA_HOST/)
    expect(steps.linux.join(' ')).toMatch(/11434/)
    expect(steps.warning).toMatch(/NEVER forward/)
  })
})
