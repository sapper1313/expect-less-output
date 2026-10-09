import { createWriteStream, mkdirSync } from 'fs'
import { dirname } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { makePlaceholderImage, makePlaceholderVideo } from './ffmpeg'
import { RetryableError } from './agents/framework'
import { explainHttp } from './agents/llm'
import type { Resolution } from '@shared/studio/types'

export interface VideoRequest {
  model: string
  prompt: string
  durationSeconds: number
  resolution: Resolution
  aspectRatio: '9:16' | '16:9'
  /** Reference images (public URLs), max 14. Cannot be mixed with imageUrl. */
  referenceImageUrls?: string[]
  /** Image to animate (image to video). */
  imageUrl?: string
}

export type VideoStatus =
  | { status: 'pending' }
  | { status: 'done'; url: string }
  | { status: 'failed'; error: string }
  | { status: 'expired' }

export interface VideoClient {
  start(req: VideoRequest): Promise<{ requestId: string }>
  poll(requestId: string): Promise<VideoStatus>
  /** Result URLs expire, so this is called the moment a job is done. */
  download(url: string, dest: string): Promise<void>
  test(): Promise<string>
}

export interface ImageRequest {
  model: string
  prompt: string
  aspectRatio: string
}

export interface ImageClient {
  generate(req: ImageRequest, dest: string): Promise<{ requestId: string }>
}

const BASE = 'https://api.x.ai'

/**
 * Real xAI client. Endpoints and statuses verified against docs.x.ai on 2026-10-09:
 * POST /v1/videos/generations returns a request_id, GET /v1/videos/{request_id} returns status done, failed or expired
 * and the file at video.url. Field names for aspect_ratio, resolution and reference_image_urls come from the same docs
 * and the xAI announcement; the Phase 3 live check confirms them with the owner's key.
 */
export class XaiClient implements VideoClient, ImageClient {
  constructor(
    private apiKey: () => string | null,
    private fetchImpl: typeof fetch = fetch,
    private base = BASE,
  ) {}

  private headers(): Record<string, string> {
    const key = this.apiKey()
    if (!key) throw new Error('The xAI API key is not set. Add it in Studio Settings.')
    return { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  }

  async test(): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/v1/api-key`, { headers: this.headers() })
    if (res.status === 404) {
      const r2 = await this.fetchImpl(`${this.base}/v1/models`, { headers: this.headers() })
      if (!r2.ok) throw new Error(await explainHttp('xAI', r2))
      return 'Connected.'
    }
    if (!res.ok) throw new Error(await explainHttp('xAI', res))
    return 'Connected.'
  }

  async start(req: VideoRequest): Promise<{ requestId: string }> {
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      duration: req.durationSeconds,
      aspect_ratio: req.aspectRatio,
      resolution: req.resolution,
    }
    if (req.imageUrl) body.image = { url: req.imageUrl }
    if (req.referenceImageUrls?.length) body.reference_image_urls = req.referenceImageUrls.slice(0, 14)
    const res = await this.fetchImpl(`${this.base}/v1/videos/generations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      throw new RetryableError(await explainHttp('xAI', res), ra > 0 ? ra : undefined)
    }
    if (!res.ok) throw new Error(await explainHttp('xAI', res))
    const data = (await res.json()) as { request_id?: string }
    if (!data.request_id) throw new Error('xAI did not return a request id.')
    return { requestId: data.request_id }
  }

  async poll(requestId: string): Promise<VideoStatus> {
    const res = await this.fetchImpl(`${this.base}/v1/videos/${encodeURIComponent(requestId)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      throw new RetryableError(await explainHttp('xAI', res), ra > 0 ? ra : undefined)
    }
    if (!res.ok) throw new Error(await explainHttp('xAI', res))
    const data = (await res.json()) as { status?: string; video?: { url?: string }; error?: unknown }
    if (data.status === 'done' && data.video?.url) return { status: 'done', url: data.video.url }
    if (data.status === 'failed') return { status: 'failed', error: JSON.stringify(data.error ?? 'failed').slice(0, 300) }
    if (data.status === 'expired') return { status: 'expired' }
    return { status: 'pending' }
  }

  async download(url: string, dest: string): Promise<void> {
    mkdirSync(dirname(dest), { recursive: true })
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok || !res.body) throw new RetryableError(`The finished video could not be downloaded (HTTP ${res.status}).`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  }

  async generate(req: ImageRequest, dest: string): Promise<{ requestId: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/images/generations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: req.model, prompt: req.prompt, aspect_ratio: req.aspectRatio, response_format: 'url' }),
      signal: AbortSignal.timeout(120_000),
    })
    if (res.status === 429 || res.status >= 500) throw new RetryableError(await explainHttp('xAI', res))
    if (!res.ok) throw new Error(await explainHttp('xAI', res))
    const data = (await res.json()) as { data?: Array<{ url?: string }>; id?: string }
    const url = data.data?.[0]?.url
    if (!url) throw new Error('xAI returned no image.')
    await this.download(url, dest)
    return { requestId: data.id ?? `img-${Date.now()}` }
  }
}

// ---------------- mock ----------------

export type MockOutcome = 'ok' | 'failed' | 'expired'

/**
 * Mock mode video client: placeholder clips made with ffmpeg, a short fake delay, and failures on demand.
 * The request id carries everything needed to rebuild the clip, so a job started before the app quit can still
 * be finished after it relaunches, exactly like a real request id.
 */
export class MockVideoClient implements VideoClient, ImageClient {
  private pending = new Map<string, { readyAt: number; outcome: MockOutcome }>()
  private n = 0
  /** Outcomes for upcoming jobs, first in first out. Missing entries mean ok. */
  script: MockOutcome[] = []
  /** The next N clips come out as black clips with no sound (for the QC retry test). */
  brokenNext = 0
  /** Every clip started with a prompt containing this text comes out broken. */
  alwaysBrokenFor: string | null = null
  delayMs = 0
  started: VideoRequest[] = []

  constructor(private now: () => number = Date.now) {}

  async test(): Promise<string> {
    return 'Mock mode: no network call was made.'
  }

  async start(req: VideoRequest): Promise<{ requestId: string }> {
    this.started.push(req)
    const outcome = this.script.shift() ?? 'ok'
    let broken = this.brokenNext > 0
    if (broken) this.brokenNext--
    if (this.alwaysBrokenFor && req.prompt.includes(this.alwaysBrokenFor)) broken = true
    const id = `mock-${req.durationSeconds}-${req.aspectRatio === '9:16' ? 'v' : 'h'}-${broken ? 'b' : 'o'}-${++this.n}-${Math.random().toString(36).slice(2, 7)}`
    this.pending.set(id, { readyAt: this.now() + this.delayMs, outcome })
    return { requestId: id }
  }

  async poll(requestId: string): Promise<VideoStatus> {
    const j = this.pending.get(requestId)
    if (!j) return { status: 'done', url: `mock://${requestId}` } // started before a relaunch: finished by now
    if (this.now() < j.readyAt) return { status: 'pending' }
    if (j.outcome === 'failed') return { status: 'failed', error: 'Simulated failure.' }
    if (j.outcome === 'expired') return { status: 'expired' }
    return { status: 'done', url: `mock://${requestId}` }
  }

  async download(url: string, dest: string): Promise<void> {
    const m = /^mock-([\d.]+)-([vh])-([bo])-/.exec(url.replace('mock://', ''))
    const seconds = m ? Number(m[1]) : 3
    const vertical = (m?.[2] ?? 'v') === 'v'
    await makePlaceholderVideo({
      out: dest,
      seconds: Math.max(1, Math.min(15, seconds)),
      width: vertical ? 270 : 480,
      height: vertical ? 480 : 270,
      text: `MOCK ${seconds}s`,
      black: m?.[3] === 'b',
    })
  }

  async generate(req: ImageRequest, dest: string): Promise<{ requestId: string }> {
    const [a, b] = req.aspectRatio.split(':').map(Number)
    const w = 640
    await makePlaceholderImage(dest, w, Math.round((w * (b || 9)) / (a || 16)))
    return { requestId: `mock-img-${++this.n}` }
  }
}
