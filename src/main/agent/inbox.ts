import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, extname, join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { ZodError } from 'zod'
import { CreatePostBody, type CreatePostInput } from '@shared/agentSchemas'
import { AgentError, agentCreatePost, validateVideoFile, type AgentServices } from './core'
import { moveFile, uniquePath } from '../services/library'
import type { Library } from '../services/library'
import type { IngestHooks } from '../studio/ingest'
import { PipelineIntake } from '../pipeline/intake'
import type { DropLog } from '../pipeline/dropLog'
import type { DropRow } from '@shared/pipeline'

const VIDEO = ['.mp4', '.mov']
/** A file that has not changed size for this long is finished copying. */
const STABLE_MS = 5_000
/** A video with no sidecar waits this long for one to show up before becoming a draft. */
const SIDECAR_GRACE_MS = 10_000
/** A video_url download that takes longer than this is given up on. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
/** A video_url download bigger than this is refused. */
const DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024

export interface InboxDeps {
  s: AgentServices
  library: Library
  /** Studio hooks for sidecars that name an episode. Without episode_id they are never called. */
  studio?: IngestHooks
  /** Takes sidecars that carry schema_version (the bot pipeline). Without it they are treated as plain sidecars. */
  pipeline?: PipelineIntake
  /** The drop log, so an API drop can return the decision. */
  drops?: DropLog
  /** Called once for each rejected file. */
  alert: (headline: string, detail: string) => void
  now?: () => number
  /** Replaces the network call for video_url downloads (tests). */
  fetch?: typeof fetch
}

interface Seen {
  size: number
  since: number
  firstSeen: number
}

/**
 * Watches <Media Root>/<Brand>/Inbox for videos. A video with a same-name .json sidecar becomes a post with the
 * sidecar's choices. A video without one becomes a draft with the brand's defaults. The files are MOVED into
 * Queue. Anything that cannot be accepted goes to Inbox/Rejected with an explanation. Nothing is ever deleted.
 */
export class InboxWatcher {
  private seen = new Map<string, Seen>()
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private d: InboxDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  start(intervalMs = 15_000): void {
    this.timer = setInterval(() => void this.scan().catch(() => {}), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * A drop that came through the API. The video and the sidecar are put in the channel's Inbox with a .ready marker,
   * exactly as if a bot had copied them there, and the Inbox is read at once. Returns the decision when it is made.
   */
  async receive(
    channelSlug: string,
    sidecar: Record<string, unknown>,
    filePath: string | null,
    actor: string,
  ): Promise<DropRow | null> {
    const brand = this.d.s.brands.bySlug(channelSlug)
    if (!brand) throw new AgentError(404, 'not_found', `No channel with the slug ${channelSlug}.`)
    const videoFile = typeof sidecar.video_file === 'string' ? sidecar.video_file : ''
    if (
      !videoFile ||
      videoFile !== basename(videoFile) ||
      !VIDEO.includes(extname(videoFile).toLowerCase())
    )
      throw new AgentError(
        400,
        'validation',
        'The sidecar needs video_file, a plain .mp4 or .mov file name.',
        [{ path: 'sidecar.video_file', message: 'Required.' }],
      )
    const dir = this.inboxDir(brand.name)
    mkdirSync(join(dir, 'Rejected'), { recursive: true })
    const stem = videoFile.slice(0, videoFile.length - extname(videoFile).length)
    const target = join(dir, videoFile)
    if (existsSync(target) || existsSync(join(dir, `${stem}.json`)))
      throw new AgentError(
        409,
        'conflict',
        `${videoFile} is already waiting in the ${brand.name} Inbox.`,
      )
    if (filePath) {
      validateVideoFile(filePath)
      if (basename(filePath) !== videoFile)
        throw new AgentError(
          400,
          'validation',
          `file_path ends in ${basename(filePath)} but video_file says ${videoFile}. They must be the same name.`,
        )
      copyFileSync(filePath, target)
      // Sidecar and marker last, so the watcher never sees half a drop.
      writeFileSync(join(dir, `${stem}.json`), JSON.stringify(sidecar, null, 2))
      writeFileSync(join(dir, `${stem}.ready`), '')
    } else {
      if (typeof sidecar.video_url !== 'string')
        throw new AgentError(400, 'validation', 'Give file_path, or put video_url in the sidecar.')
      writeFileSync(join(dir, `${stem}.json`), JSON.stringify(sidecar, null, 2))
    }
    this.d.s.log.log(
      'info',
      `Drop received through the API from ${actor}: ${videoFile} for ${brand.name}.`,
    )
    // The Inbox only reads channels it is switched on for.
    await this.scan()
    const id = typeof sidecar.episode_id === 'string' ? sidecar.episode_id : null
    return id && this.d.drops
      ? (this.d.drops.list({ channel: channelSlug, limit: 20 }).find((r) => r.episodeId === id) ??
          null)
      : null
  }

  inboxDir(brandName: string): string {
    return join(this.d.library.brandDir(brandName), 'Inbox')
  }

  /** One pass over every enabled brand. Safe to call often. */
  async scan(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let handled = 0
    try {
      if (!this.d.s.settings.get().pipelineIntakeEnabled) return 0
      const enabled = new Set(this.d.s.settings.get().inboxBrandIds)
      for (const b of this.d.s.brands.list(false)) {
        if (!enabled.has(b.id)) continue
        const dir = this.inboxDir(b.name)
        mkdirSync(join(dir, 'Rejected'), { recursive: true })
        const names = readdirSync(dir)
        for (const name of names) {
          const full = join(dir, name)
          if (extname(name).toLowerCase() === '.json') {
            if (await this.handleUrlSidecar(b.name, dir, name, full, names)) handled++
            continue
          }
          if (!VIDEO.includes(extname(name).toLowerCase())) continue
          let st
          try {
            st = statSync(full)
          } catch {
            continue
          }
          if (!st.isFile()) continue
          if (await this.handle(b.id, b.name, dir, name, full, st.size)) handled++
        }
      }
    } finally {
      this.running = false
    }
    return handled
  }

  private async handle(
    brandId: number,
    brandName: string,
    dir: string,
    name: string,
    full: string,
    size: number,
  ): Promise<boolean> {
    const now = this.now()
    const prev = this.seen.get(full)
    const stem = name.slice(0, name.length - extname(name).length)
    const sidecar = join(dir, `${stem}.json`)
    // A .ready file next to the video says the copy is finished, so the wait is skipped.
    const ready = existsSync(join(dir, `${stem}.ready`)) && existsSync(sidecar)
    if (!ready) {
      if (!prev || prev.size !== size) {
        this.seen.set(full, { size, since: now, firstSeen: prev?.firstSeen ?? now })
        return false // still arriving, look again next time
      }
      if (now - prev.since < STABLE_MS) return false
    }
    const hasSidecar = existsSync(sidecar)
    const cfg = this.d.s.settings.get()
    // Automatic scheduling only works while agents are allowed to schedule.
    const auto = cfg.agentMaySchedule && cfg.inboxAutoScheduleBrandIds.includes(brandId)
    if (!hasSidecar && now - (prev?.firstSeen ?? now) < SIDECAR_GRACE_MS) return false

    let body: CreatePostInput
    let episodeId: string | null = null
    let sideForAfter: Record<string, unknown> = {}
    try {
      if (hasSidecar) {
        let raw: unknown
        try {
          raw = JSON.parse(readFileSync(sidecar, 'utf8'))
        } catch {
          throw new AgentError(
            400,
            'bad_request',
            'The .json file next to the video is not valid JSON.',
          )
        }
        if (this.d.pipeline && PipelineIntake.handles(raw)) {
          const brand = this.d.s.brands.get(brandId)
          await this.d.pipeline.process({
            brand,
            videoPath: full,
            sidecarPath: sidecar,
            raw,
            inboxDir: dir,
          })
          rmSync(join(dir, `${stem}.ready`), { force: true })
          this.seen.delete(full)
          return true
        }
        const obj = { ...(raw as object) } as Record<string, unknown>
        // video_url only says where the video came from. By now the video is a file in the Inbox.
        delete obj.video_url
        // The folder decides the brand and the file. Both may be left out, but not contradicted.
        if (obj.brand_id !== undefined && Number(obj.brand_id) !== brandId) {
          throw new AgentError(
            400,
            'bad_request',
            `The sidecar says brand_id ${String(obj.brand_id)} but this is the ${brandName} Inbox (brand_id ${brandId}).`,
          )
        }
        obj.brand_id = brandId
        obj.file_path = full
        // An episode id ties the finished video to a Library episode. The studio fills in what the sidecar leaves out.
        if (obj.episode_id !== undefined) {
          episodeId = String(obj.episode_id)
          const side = { ...obj }
          delete obj.episode_id
          delete obj.description
          delete obj.thumbnail_url
          if (!this.d.studio)
            throw new AgentError(
              400,
              'bad_request',
              'This build has no studio, so episode_id cannot be used.',
            )
          try {
            const fill = await this.d.studio.before(episodeId, full, side)
            for (const [k, v] of Object.entries(fill)) if (obj[k] === undefined) obj[k] = v
          } catch (e) {
            throw new AgentError(400, 'bad_request', (e as Error).message)
          }
          sideForAfter = side
        }
        // A sidecar that does not mention status gets the brand's automatic rule. An explicit status always wins.
        if (auto && obj.status === undefined) {
          obj.status = 'scheduled'
          if (obj.scheduled_at === undefined && obj.next_slot === undefined) obj.next_slot = true
        }
        body = CreatePostBody.parse(obj)
      } else {
        body = CreatePostBody.parse(
          auto
            ? { brand_id: brandId, file_path: full, status: 'scheduled', next_slot: true }
            : { brand_id: brandId, file_path: full, status: 'draft' },
        )
      }
      const post = await agentCreatePost(this.d.s, body, { source: 'inbox', moveSource: true })
      if (episodeId && this.d.studio) await this.d.studio.after(episodeId, post.id, sideForAfter)
      // Keep the sidecar with its video, in Queue.
      if (hasSidecar) {
        const queueVideo = this.d.library.resolve(post.videoPath)
        const dest = queueVideo.slice(0, queueVideo.length - extname(queueVideo).length) + '.json'
        moveFile(sidecar, uniquePath(join(dest, '..'), basename(dest)))
      }
      this.seen.delete(full)
      return true
    } catch (e) {
      this.reject(brandName, dir, name, hasSidecar ? sidecar : null, e)
      this.seen.delete(full)
      return true
    }
  }

  /**
   * A .json with a "video_url" and no video next to it: download the video into the Inbox as <name>.mp4.
   * Once it is there, the normal path above picks it up with its sidecar. If a video with that name is
   * already in the Inbox, the file wins and the URL is ignored. A .json without video_url is left alone.
   */
  private async handleUrlSidecar(
    brandName: string,
    dir: string,
    name: string,
    full: string,
    names: string[],
  ): Promise<boolean> {
    const stem = name.slice(0, name.length - extname(name).length)
    if (
      names.some(
        (n) => VIDEO.includes(extname(n).toLowerCase()) && n.slice(0, -extname(n).length) === stem,
      )
    )
      return false
    let size: number
    try {
      const st = statSync(full)
      if (!st.isFile()) return false
      size = st.size
    } catch {
      return false
    }
    const now = this.now()
    const prev = this.seen.get(full)
    if (!prev || prev.size !== size) {
      this.seen.set(full, { size, since: now, firstSeen: prev?.firstSeen ?? now })
      return false // maybe still being written
    }
    if (now - prev.since < STABLE_MS) return false

    let url: unknown
    try {
      url = (JSON.parse(readFileSync(full, 'utf8')) as { video_url?: unknown } | null)?.video_url
    } catch {
      this.seen.delete(full)
      return false // not valid JSON and no video: not ours to judge
    }
    if (url === undefined) {
      this.seen.delete(full)
      return false
    }
    const videoName = `${stem}.mp4`
    try {
      await this.download(url, join(dir, videoName))
    } catch (e) {
      this.reject(brandName, dir, videoName, full, e)
    }
    this.seen.delete(full)
    return true
  }

  /** Downloads to a temporary file, checks it is a whole video, then renames it to `dest`. */
  private async download(url: unknown, dest: string): Promise<void> {
    const bad = (m: string) => new AgentError(400, 'bad_request', m, { field: 'video_url' })
    let u: URL
    try {
      u = new URL(String(url))
    } catch {
      throw bad('video_url is not a valid web address.')
    }
    if (typeof url !== 'string' || (u.protocol !== 'https:' && u.protocol !== 'http:'))
      throw bad('video_url must be an http or https address.')
    // Only the site is written down. The full address can carry a secret token.
    const from = u.origin
    const tmp = join(dest, '..', `.${basename(dest)}.download`)
    try {
      const res = await (this.d.fetch ?? fetch)(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!res.ok || !res.body) throw bad(`The server at ${from} answered ${res.status}.`)
      let got = 0
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          got += chunk.length
          if (got > DOWNLOAD_MAX_BYTES) cb(new Error('the file is bigger than 2 GB'))
          else cb(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))
      // Verify the download finished: something arrived, it is as long as the server said, and it is an MP4/MOV.
      const expected = Number(res.headers.get('content-length'))
      const encoded = !!res.headers.get('content-encoding')
      if (got === 0 || statSync(tmp).size !== got) throw bad('The download came back empty.')
      if (!encoded && expected > 0 && got !== expected)
        throw bad(`The download stopped early (${got} of ${expected} bytes).`)
      const head = Buffer.alloc(8)
      const fd = openSync(tmp, 'r')
      try {
        readSync(fd, head, 0, 8, 0)
      } finally {
        closeSync(fd)
      }
      if (head.subarray(4, 8).toString('latin1') !== 'ftyp')
        throw bad('The download is not an MP4 or MOV video.')
      moveFile(tmp, dest)
    } catch (e) {
      rmSync(tmp, { force: true })
      if (e instanceof AgentError) throw e
      const why = e instanceof Error ? e.message : String(e)
      throw bad(`Could not download the video from ${from}: ${why}`)
    }
  }

  private reject(
    brandName: string,
    dir: string,
    name: string,
    sidecar: string | null,
    e: unknown,
  ): void {
    const why =
      e instanceof ZodError
        ? 'The sidecar does not match the format:\n' +
          e.issues.map((i) => `- ${i.path.join('.') || '(top)'}: ${i.message}`).join('\n')
        : e instanceof AgentError
          ? e.message
          : `Unexpected problem: ${(e as Error).message}`
    const rejected = join(dir, 'Rejected')
    mkdirSync(rejected, { recursive: true })
    const dest = uniquePath(rejected, name)
    try {
      // A failed video_url download has no video to move.
      if (existsSync(join(dir, name))) renameSync(join(dir, name), dest)
      if (sidecar && existsSync(sidecar))
        renameSync(sidecar, uniquePath(rejected, basename(sidecar)))
      writeFileSync(
        dest.replace(/\.[^.]+$/, '') + '.error.txt',
        `This file was not accepted from the Inbox.\n\n${why}\n`,
      )
    } catch {
      // If even moving fails, leave it where it is. It will be tried again.
    }
    this.d.s.log.log(
      'error',
      `Inbox (${brandName}): "${name}" was not accepted. ${why.split('\n')[0]}`,
    )
    this.d.alert(
      'An Inbox file was not accepted.',
      `${brandName}: ${name}. ${why.split('\n')[0]} See the Rejected folder inside the Inbox.`,
    )
  }
}
