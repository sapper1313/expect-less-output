import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { speechSimilarity, parseVision, VISION_PROMPT } from '@shared/studio/qc'
import { cosine } from './repetition'
import { blackSeconds, extractWav, frozenSeconds, peakDb, probe, sampleFrames, silentSeconds } from './ffmpeg'
import type { StudioConfigService } from './configService'
import type { AuditLog } from './agents/framework'
import type { LocalAi } from './localAi'
import type { BrandAssets } from './assets'

export interface QcInput {
  path: string
  episodeId?: string
  brandId?: number
  clipN?: number
  /** Seconds of content expected in this file. */
  expectSeconds: number
  aspect: '9:16' | '16:9'
  scriptedLines: string[]
  scene: string
  /** Full runs every step. Light runs only the ffmpeg checks (used for videos that arrive from Muse). */
  mode: 'full' | 'light'
}

export interface QcStep {
  name: 'ffmpeg' | 'speech' | 'visual' | 'consistency'
  ok: boolean
  note: string
  /** What did the work: this Mac, the remote machine, Claude, or nothing (skipped). */
  via: string
}

export interface QcResult {
  pass: boolean
  reasons: string[]
  steps: QcStep[]
}

export interface QcHooks {
  transcribe?: (wavPath: string) => Promise<string>
  describe?: (prompt: string, framesB64: string[]) => Promise<{ via: string; text: string }>
}

/**
 * Video QC. Checks run cheapest first and stop at the first failure. The decision is automatic: pass and continue,
 * or fail with a plain reason that the Producer uses to retry. Nothing waits on the owner.
 */
export class VideoQc {
  /** Mock mode simulates the speech and picture checks, because placeholder clips have neither. Tests turn this off. */
  simulate: boolean | null = null
  hooks: QcHooks = {}

  constructor(
    private d: { cfg: StudioConfigService; localAi: LocalAi; audit: AuditLog; assets: BrandAssets },
  ) {}

  private isSimulated() {
    return this.simulate ?? this.d.cfg.get().mockMode
  }

  async check(i: QcInput): Promise<QcResult> {
    const cfg = this.d.cfg.get()
    const steps: QcStep[] = []
    const done = (reasons: string[]): QcResult => {
      const r = { pass: reasons.length === 0, reasons, steps }
      this.d.audit.write({ agent: 'Video QC', action: r.pass ? 'pass' : 'fail', brandId: i.brandId, episodeId: i.episodeId, detail: { clip: i.clipN, reasons, steps: steps.map((s) => `${s.name}:${s.ok ? 'ok' : 'fail'}:${s.via}`) } })
      return r
    }
    if (cfg.qcMode === 'off') {
      steps.push({ name: 'ffmpeg', ok: true, note: 'QC is switched off.', via: 'none' })
      return done([])
    }

    // 1. ffmpeg hard checks
    const hard = await this.hardChecks(i)
    steps.push({ name: 'ffmpeg', ok: hard.length === 0, note: hard[0] ?? 'Plays, right shape, sound present, no long black or frozen picture.', via: 'this Mac' })
    if (hard.length) return done(hard)
    if (i.mode === 'light') return done([])

    // 2. speech
    if (i.scriptedLines.length) {
      const sp = await this.speech(i)
      steps.push(sp)
      if (!sp.ok) return done([sp.note])
    }
    // 3. picture
    const dir = mkdtempSync(join(tmpdir(), 'elo-qc-'))
    try {
      const vis = await this.visual(i, dir)
      steps.push(vis)
      if (!vis.ok) return done([vis.note])
      // 4. character consistency
      const con = await this.consistency(i, dir)
      if (con) {
        steps.push(con)
        if (!con.ok) return done([con.note])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return done([])
  }

  private async hardChecks(i: QcInput): Promise<string[]> {
    const fails: string[] = []
    let info
    try {
      info = await probe(i.path)
    } catch (e) {
      return [`The file does not play: ${(e as Error).message}`]
    }
    const dur = info.durationSeconds
    if (!dur || dur < 0.5) return ['The video has no length.']
    if (dur < i.expectSeconds * 0.6) fails.push(`The video is only ${dur.toFixed(1)} seconds. About ${i.expectSeconds} were expected.`)
    const ratio = info.width / (info.height || 1)
    const want = i.aspect === '9:16' ? 9 / 16 : 16 / 9
    if (Math.abs(ratio - want) / want > 0.04) fails.push(`The shape is ${info.width}x${info.height}. ${i.aspect} was expected.`)
    if (!info.hasAudio) fails.push('The video has no sound.')
    if (fails.length) return fails
    const black = await blackSeconds(i.path)
    if (black / dur > 0.35 || black > 2) fails.push(`${black.toFixed(1)} seconds of the video are black.`)
    const frozen = await frozenSeconds(i.path)
    if (frozen / dur > 0.6) fails.push(`The picture is frozen for ${frozen.toFixed(1)} seconds.`)
    const peak = await peakDb(i.path)
    if (peak !== null && peak >= -0.05) fails.push('The sound is clipping (too loud and distorted).')
    if (i.mode === 'full' && i.scriptedLines.length) {
      const silent = await silentSeconds(i.path)
      if (silent / dur > 0.8) fails.push('The video is silent where speech was expected.')
    }
    return fails
  }

  private async speech(i: QcInput): Promise<QcStep> {
    const scripted = i.scriptedLines.join(' ')
    if (this.isSimulated() && !this.hooks.transcribe)
      return { name: 'speech', ok: true, note: 'Mock mode: speech check simulated as a pass.', via: 'simulated' }
    const dir = mkdtempSync(join(tmpdir(), 'elo-qcw-'))
    try {
      const wav = join(dir, 'a.wav')
      await extractWav(i.path, wav)
      let heard: string
      try {
        heard = this.hooks.transcribe ? await this.hooks.transcribe(wav) : (await this.d.localAi.whisper.transcribe(wav)).text
      } catch (e) {
        this.d.audit.write({ agent: 'Video QC', action: 'whisper_unavailable', brandId: i.brandId, episodeId: i.episodeId, detail: { error: (e as Error).message } })
        return { name: 'speech', ok: true, note: `Speech check skipped (Whisper unavailable: ${(e as Error).message}).`, via: 'none' }
      }
      const sim = speechSimilarity(scripted, heard)
      return sim >= 0.4
        ? { name: 'speech', ok: true, note: `Heard ${Math.round(sim * 100)} percent of the scripted words.`, via: 'whisper' }
        : { name: 'speech', ok: false, note: `The speech does not match the script. Heard "${heard.slice(0, 80)}" but the script says "${scripted.slice(0, 80)}".`, via: 'whisper' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  private async frames(i: QcInput, dir: string): Promise<string[]> {
    const info = await probe(i.path)
    return (await sampleFrames(i.path, 3, dir, info.durationSeconds)).map((p) => readFileSync(p).toString('base64'))
  }

  private async visual(i: QcInput, dir: string): Promise<QcStep> {
    if (this.isSimulated() && !this.hooks.describe) return { name: 'visual', ok: true, note: 'Mock mode: picture check simulated as a pass.', via: 'simulated' }
    const frames = await this.frames(i, dir)
    const describe = this.hooks.describe ?? ((p, f) => this.d.localAi.describeFrames(p, f, { brandId: i.brandId, episodeId: i.episodeId }))
    const r = await describe(VISION_PROMPT(i.scene), frames)
    if (r.via === 'ffmpeg-only') return { name: 'visual', ok: true, note: 'The remote machine is unreachable, so only the ffmpeg and Whisper checks were used.', via: 'none' }
    const v = parseVision(r.text)
    return v.issues.length
      ? { name: 'visual', ok: false, note: `Picture problem: ${v.issues.join('; ')}`, via: r.via }
      : { name: 'visual', ok: true, note: v.ignored.length ? `Low confidence notes ignored: ${v.ignored.join('; ')}` : 'No problems seen.', via: r.via }
  }

  /** Is the character the same as in the brand reference images? Compares descriptions with the text embedding model. */
  private async consistency(i: QcInput, dir: string): Promise<QcStep | null> {
    if (!i.brandId) return null
    const refs = this.d.assets.list(i.brandId, 'reference_image').slice(0, 3)
    if (!refs.length) return null
    if (this.isSimulated()) return { name: 'consistency', ok: true, note: 'Mock mode: character check simulated as a pass.', via: 'simulated' }
    const ask = 'Describe the main character in this image in one sentence: species, colors, clothing, shape.'
    const describe = this.hooks.describe ?? ((p, f) => this.d.localAi.describeFrames(p, f, { brandId: i.brandId, episodeId: i.episodeId }))
    const frame = (await this.frames(i, dir))[1]
    const mine = await describe(ask, [frame])
    if (mine.via === 'ffmpeg-only' || !mine.text) return { name: 'consistency', ok: true, note: 'Character check skipped (no vision model reachable).', via: 'none' }
    const descs: string[] = []
    for (const r of refs) {
      let text = r.description
      if (!text) {
        text = (await describe(ask, [readFileSync(r.path).toString('base64')])).text
        if (text) this.d.assets.setDescription(r.id, text)
      }
      if (text) descs.push(text)
    }
    if (!descs.length) return { name: 'consistency', ok: true, note: 'Character check skipped (no reference descriptions).', via: 'none' }
    const emb = await this.d.localAi.embed([mine.text, ...descs])
    if (!emb.vectors) return { name: 'consistency', ok: true, note: 'Character check skipped (embedding model unreachable).', via: 'none' }
    const [a, ...rest] = emb.vectors
    const best = Math.max(...rest.map((v) => cosine(a, v)))
    const need = this.d.cfg.get().characterSimilarityThreshold
    return best >= need
      ? { name: 'consistency', ok: true, note: `Character matches the references (${Math.round(best * 100)} percent).`, via: 'ollama' }
      : { name: 'consistency', ok: false, note: `The character does not look like the reference images (${Math.round(best * 100)} percent, needs ${Math.round(need * 100)}).`, via: 'ollama' }
  }
}
