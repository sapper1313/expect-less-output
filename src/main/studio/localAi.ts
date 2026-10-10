import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { ffmpeg, ffmpegBin, makePlaceholderImage } from './ffmpeg'
import type { StudioConfigService } from './configService'
import type { AuditLog } from './agents/framework'
import type { LlmGateway } from './agents/llm'

const run = promisify(execFile)

export interface ChecklistItem {
  id: 'ollama' | 'vision' | 'embed' | 'whisper' | 'ffmpeg'
  label: string
  ok: boolean
  detail: string
  /** Plain language fix steps, shown only when the item is red. */
  fix: string[]
}

export interface SelfTestResult {
  vision: { ok: boolean; seconds: number; message: string }
  embed: { ok: boolean; seconds: number; message: string }
  whisper: { ok: boolean; seconds: number; message: string }
}

export type Via = 'ollama' | 'claude' | 'keyword' | 'ffmpeg-only' | 'none'

/** Talks to Ollama over HTTP on whatever host the owner typed. Nothing here assumes localhost. */
export class OllamaClient {
  constructor(
    private host: () => string,
    private timeoutMs: () => number,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string) {
    return this.host().replace(/\/+$/, '') + path
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.url(path), { ...init, signal: AbortSignal.timeout(this.timeoutMs()) })
    if (!res.ok) throw new Error(`Ollama answered HTTP ${res.status} for ${path}.`)
    return (await res.json()) as T
  }

  async models(): Promise<string[]> {
    const d = await this.json<{ models?: Array<{ name: string }> }>('/api/tags')
    return (d.models ?? []).map((m) => m.name)
  }

  async version(): Promise<string> {
    return (await this.json<{ version?: string }>('/api/version')).version ?? 'unknown'
  }

  /** Ollama does not report system memory. This is what it does report about loaded models. */
  async loaded(): Promise<Array<{ name: string; size: number; size_vram: number }>> {
    const d = await this.json<{ models?: Array<{ name: string; size: number; size_vram: number }> }>('/api/ps')
    return d.models ?? []
  }

  async embed(model: string, input: string[]): Promise<number[][]> {
    const d = await this.json<{ embeddings?: number[][] }>('/api/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
    })
    if (!d.embeddings?.length) throw new Error('Ollama returned no embeddings.')
    return d.embeddings
  }

  async vision(model: string, prompt: string, imagesB64: string[]): Promise<string> {
    const d = await this.json<{ message?: { content?: string } }>('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: prompt, images: imagesB64 }] }),
    })
    return d.message?.content ?? ''
  }

  /** Downloads a model on the remote machine. Calls `progress` with 0 to 100. */
  async pull(model: string, progress: (pct: number, status: string) => void): Promise<void> {
    const res = await this.fetchImpl(this.url('/api/pull'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(60 * 60_000),
    })
    if (!res.ok || !res.body) throw new Error(`Ollama could not start downloading "${model}" (HTTP ${res.status}). Check the model name.`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const m = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
        if (m.error) throw new Error(`Ollama: ${m.error}`)
        progress(m.status === 'success' ? 100 : m.total ? Math.round(((m.completed ?? 0) / m.total) * 100) : 0, m.status ?? '')
      }
    }
  }
}

export interface WhisperResult {
  text: string
  seconds: number
  /** The tool's own output, with the [start --> end] timing lines when it prints them. */
  raw: string
}

/** A Mac app does not get Homebrew's folders in its PATH, so they are added here. */
const EXTRA_BIN = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), 'bin')]
export const toolEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: [...EXTRA_BIN, process.env.PATH ?? ''].join(':') })

function findBinary(name: string): string | null {
  if (name.includes('/')) return existsSync(name) ? name : null
  for (const dir of [...EXTRA_BIN, ...(process.env.PATH ?? '').split(':')]) {
    const p = join(dir, name)
    if (dir && existsSync(p)) return p
  }
  return null
}

/** The first whisper.cpp model file found in the usual places, or null. */
export function findWhisperModel(): string | null {
  const dirs = [join(homedir(), 'whisper-models'), join(homedir(), 'ELO', 'models'), join(homedir(), '.cache', 'whisper'), '/opt/homebrew/share/whisper-cpp', '/opt/homebrew/share/whisper-cpp/models', '/usr/local/share/whisper-cpp']
  for (const d of dirs) {
    try {
      const f = readdirSync(d).filter((x) => /^ggml-.*\.bin$/.test(x)).sort((a, b) => (/base\.en/.test(a) ? -1 : /base\.en/.test(b) ? 1 : a.localeCompare(b)))[0]
      if (f) return join(d, f)
    } catch {
      // folder not there
    }
  }
  return null
}

/** Turns the owner's command into a program and arguments: finds the program, and adds a model when whisper.cpp is used without one. */
export function resolveWhisperCommand(command: string, audio: string): { bin: string; args: string[] } | { error: string } {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  const bin = findBinary(parts[0])
  if (!bin) return { error: `Could not find "${parts[0]}" on this Mac. In Terminal run: brew install whisper-cpp` }
  let args = parts.slice(1).map((p) => p.replace('{audio}', audio))
  if (!command.includes('{audio}')) args.push('-f', audio)
  if (/whisper-cli|whisper-cpp/.test(bin) && !args.includes('-m') && !args.includes('--model')) {
    const model = findWhisperModel()
    if (!model) return { error: 'whisper.cpp needs a model file such as ggml-base.en.bin. Put one in ~/whisper-models, or add "-m /path/to/model" to the Whisper command.' }
    args = ['-m', model, ...args]
  }
  return { bin, args }
}

/** Whisper runs on this Mac (a command line tool) or on a remote service that speaks the OpenAI transcription format. */
export class Whisper {
  constructor(
    private cfg: StudioConfigService,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async available(): Promise<{ ok: boolean; detail: string }> {
    const l = this.cfg.get().local
    if (l.whisperMode === 'remote') {
      if (!l.whisperHost) return { ok: false, detail: 'No Whisper host is set.' }
      try {
        const res = await this.fetchImpl(l.whisperHost.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(8000) })
        return { ok: res.status < 500, detail: `Remote Whisper answered HTTP ${res.status}.` }
      } catch (e) {
        return { ok: false, detail: `Remote Whisper did not answer: ${(e as Error).message}` }
      }
    }
    const r = resolveWhisperCommand(l.whisperCommand, '/tmp/x.wav')
    if ('error' in r) return { ok: false, detail: r.error }
    return { ok: true, detail: `Found ${r.bin}${r.args.includes('-m') ? ` with model ${r.args[r.args.indexOf('-m') + 1]}` : ''}.` }
  }

  async transcribe(audioPath: string): Promise<WhisperResult> {
    const l = this.cfg.get().local
    const t0 = Date.now()
    if (l.whisperMode === 'remote') {
      const form = new FormData()
      form.append('file', new Blob([readFileSync(audioPath)]), 'audio.wav')
      form.append('model', 'whisper-1')
      const res = await this.fetchImpl(l.whisperHost.replace(/\/+$/, '') + '/v1/audio/transcriptions', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10 * 60_000),
      })
      if (!res.ok) throw new Error(`Remote Whisper answered HTTP ${res.status}.`)
      const d = (await res.json()) as { text?: string }
      const text = (d.text ?? '').trim()
      return { text, raw: text, seconds: (Date.now() - t0) / 1000 }
    }
    const r = resolveWhisperCommand(l.whisperCommand, audioPath)
    if ('error' in r) throw new Error(r.error)
    const { stdout } = await run(r.bin, r.args, { timeout: 10 * 60_000, maxBuffer: 10 * 1024 * 1024, env: toolEnv() })
    return { text: stdout.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(), raw: stdout, seconds: (Date.now() - t0) / 1000 }
  }
}

export interface LocalAiDeps {
  cfg: StudioConfigService
  audit: AuditLog
  gateway: LlmGateway
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * Everything the studio asks of the remote machine goes through here, with the fallback order:
 * (1) ffmpeg and Whisper checks only, (2) Claude vision if the owner enabled it, (3) keyword plus text agent
 * comparison for repetition. Which one was used is written to the Director's Log.
 */
export class LocalAi {
  readonly ollama: OllamaClient
  readonly whisper: Whisper
  private unreachableSince: number | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private d: LocalAiDeps) {
    this.ollama = new OllamaClient(
      () => d.cfg.get().local.ollamaHost,
      () => Math.max(30_000, (d.cfg.get().local.measured.vision ?? 15) * 4000),
      d.fetchImpl,
    )
    this.whisper = new Whisper(d.cfg, d.fetchImpl)
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** One request at a time by default, so an old laptop is never swamped. */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => {})
    return next
  }

  private noteReach(ok: boolean) {
    if (ok) this.unreachableSince = null
    else if (this.unreachableSince === null) this.unreachableSince = this.now()
  }

  unreachableForMs(): number {
    return this.unreachableSince === null ? 0 : this.now() - this.unreachableSince
  }

  async reachable(): Promise<boolean> {
    try {
      await this.ollama.version()
      this.noteReach(true)
      return true
    } catch {
      this.noteReach(false)
      return false
    }
  }

  async checklist(): Promise<ChecklistItem[]> {
    const l = this.d.cfg.get().local
    const items: ChecklistItem[] = []
    let models: string[] = []
    let up = false
    let detail: string
    try {
      const v = await this.ollama.version()
      models = await this.ollama.models()
      detail = `Ollama ${v} at ${l.ollamaHost}.`
      up = true
    } catch (e) {
      detail = `Could not reach ${l.ollamaHost}: ${(e as Error).message}`
    }
    this.noteReach(up)
    items.push({
      id: 'ollama',
      label: 'Ollama is reachable',
      ok: up,
      detail,
      fix: [
        'Check the other computer is on and awake.',
        'Check the address in the Ollama host box is right, for example http://192.168.1.50:11434.',
        'On the other computer make Ollama listen on the network (see "Setup steps for the other computer").',
        'Allow port 11434 through its firewall for your home network.',
      ],
    })
    const have = (name: string) =>
      models.some((m) => m === name || m === `${name}:latest` || (!name.includes(':') && m.split(':')[0] === name))
    items.push({
      id: 'vision',
      label: `Vision model installed (${l.visionModel})`,
      ok: up && have(l.visionModel),
      detail: up ? (have(l.visionModel) ? 'Installed.' : 'Not installed yet.') : 'Cannot check until Ollama is reachable.',
      fix: ['Press "Download recommended models" and wait for the progress bar to finish.'],
    })
    items.push({
      id: 'embed',
      label: `Embedding model installed (${l.embedModel})`,
      ok: up && have(l.embedModel),
      detail: up ? (have(l.embedModel) ? 'Installed.' : 'Not installed yet.') : 'Cannot check until Ollama is reachable.',
      fix: ['Press "Download recommended models" and wait for the progress bar to finish.'],
    })
    const w = await this.whisper.available()
    items.push({
      id: 'whisper',
      label: 'Whisper speech to text is available',
      ok: w.ok,
      detail: w.detail,
      fix:
        l.whisperMode === 'mac'
          ? ['Install whisper.cpp on this Mac: in Terminal run "brew install whisper-cpp".', 'Download a model file and put its path into the Whisper command box.']
          : ['Check the Whisper host address, and that the service is running on the other computer.'],
    })
    const ff = await run(ffmpegBin(), ['-version']).then(
      () => true,
      () => false,
    )
    items.push({
      id: 'ffmpeg',
      label: 'ffmpeg is installed on this Mac',
      ok: ff,
      detail: ff ? 'ffmpeg works.' : 'ffmpeg did not start.',
      fix: ['The app includes ffmpeg. If this is red, reinstall the app. Or in Terminal run "brew install ffmpeg".'],
    })
    return items
  }

  async pullRecommended(progress: (model: string, pct: number, status: string) => void): Promise<string[]> {
    const l = this.d.cfg.get().local
    const done: string[] = []
    for (const m of [l.visionModel, l.embedModel, l.textModel].filter(Boolean)) {
      await this.ollama.pull(m, (pct, status) => progress(m, pct, status))
      done.push(m)
    }
    return done
  }

  /** One sample image to the vision model, two sentences embedded, a 5 second clip transcribed. Times are saved. */
  async selfTest(): Promise<SelfTestResult> {
    const l = this.d.cfg.get().local
    const dir = mkdtempSync(join(tmpdir(), 'elo-selftest-'))
    const out: SelfTestResult = {
      vision: { ok: false, seconds: 0, message: '' },
      embed: { ok: false, seconds: 0, message: '' },
      whisper: { ok: false, seconds: 0, message: '' },
    }
    try {
      const img = join(dir, 'sample.jpg')
      await makePlaceholderImage(img, 256, 256)
      let t = Date.now()
      try {
        const text = await this.queue(() => this.ollama.vision(l.visionModel, 'Describe this image in one short sentence.', [readFileSync(img).toString('base64')]))
        out.vision = { ok: text.length > 0, seconds: (Date.now() - t) / 1000, message: text.slice(0, 120) || 'Empty answer.' }
      } catch (e) {
        out.vision = { ok: false, seconds: (Date.now() - t) / 1000, message: (e as Error).message }
      }
      t = Date.now()
      try {
        const v = await this.queue(() => this.ollama.embed(l.embedModel, ['A raccoon counts coins.', 'A panda sorts trash.']))
        out.embed = { ok: v.length === 2 && v[0].length > 0, seconds: (Date.now() - t) / 1000, message: `${v[0]?.length ?? 0} numbers per sentence.` }
      } catch (e) {
        out.embed = { ok: false, seconds: (Date.now() - t) / 1000, message: (e as Error).message }
      }
      t = Date.now()
      try {
        const wav = join(dir, 'sample.wav')
        await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ar', '16000', '-ac', '1', wav])
        const r = await this.whisper.transcribe(wav)
        out.whisper = { ok: true, seconds: r.seconds, message: r.text ? r.text.slice(0, 80) : 'Ran fine (a tone has no words).' }
      } catch (e) {
        out.whisper = { ok: false, seconds: (Date.now() - t) / 1000, message: (e as Error).message }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    this.d.cfg.set({
      local: {
        ...l,
        measured: {
          vision: out.vision.ok ? out.vision.seconds : l.measured.vision,
          embed: out.embed.ok ? out.embed.seconds : l.measured.embed,
          whisper: out.whisper.ok ? out.whisper.seconds : l.measured.whisper,
        },
      },
    })
    this.d.audit.write({ agent: 'Local AI', action: 'self_test', detail: out })
    return out
  }

  /** Estimated minutes of local checking per video, from the measured speeds. */
  estimateQcSeconds(frames = 4, clipSeconds = 15): number {
    const m = this.d.cfg.get().local.measured
    return Math.round((m.vision ?? 10) * frames + (m.whisper ?? 5) * Math.max(1, clipSeconds / 5))
  }

  // ---------- fallbacks ----------

  /** Asks the vision model about frames. Falls back to Claude vision if enabled, else reports it was skipped. */
  async describeFrames(
    prompt: string,
    framesB64: string[],
    ctx: { brandId?: number | null; episodeId?: string | null } = {},
  ): Promise<{ via: Via; text: string }> {
    const l = this.d.cfg.get().local
    if (await this.reachable()) {
      try {
        const text = await this.queue(() => this.ollama.vision(l.visionModel, prompt, framesB64))
        return { via: 'ollama', text }
      } catch (e) {
        this.d.audit.write({ agent: 'Local AI', action: 'vision_failed', ...ctx, detail: { error: (e as Error).message } })
      }
    }
    if (l.useClaudeVision) {
      const res = await this.d.gateway.call({
        agent: 'Video QC',
        system: 'You check frames from a short video. Answer briefly and plainly.',
        user: prompt,
        images: framesB64.slice(0, 4),
        maxTokens: 500,
        brandId: ctx.brandId,
        episodeId: ctx.episodeId,
      })
      this.d.audit.write({ agent: 'Local AI', action: 'fallback_claude_vision', ...ctx })
      return { via: 'claude', text: res.text }
    }
    this.d.audit.write({ agent: 'Local AI', action: 'fallback_ffmpeg_only', ...ctx, detail: { note: 'Remote machine unreachable. Vision check skipped.' } })
    return { via: 'ffmpeg-only', text: '' }
  }

  /** Embeds texts. Returns null when the remote machine is unreachable, so the caller can use the keyword check. */
  async embed(texts: string[]): Promise<{ via: Via; vectors: number[][] | null }> {
    const l = this.d.cfg.get().local
    if (await this.reachable()) {
      try {
        const vectors = await this.queue(() => this.ollama.embed(l.embedModel, texts))
        return { via: 'ollama', vectors }
      } catch (e) {
        this.d.audit.write({ agent: 'Local AI', action: 'embed_failed', detail: { error: (e as Error).message } })
      }
    }
    this.d.audit.write({ agent: 'Local AI', action: 'fallback_keyword_repetition_check' })
    return { via: 'keyword', vectors: null }
  }
}
