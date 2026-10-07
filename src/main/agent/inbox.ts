import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, extname, join } from 'path'
import { ZodError } from 'zod'
import { CreatePostBody, type CreatePostInput } from '@shared/agentSchemas'
import { AgentError, agentCreatePost, type AgentServices } from './core'
import { moveFile, uniquePath } from '../services/library'
import type { Library } from '../services/library'

const VIDEO = ['.mp4', '.mov']
/** A file that has not changed size for this long is finished copying. */
const STABLE_MS = 5_000
/** A video with no sidecar waits this long for one to show up before becoming a draft. */
const SIDECAR_GRACE_MS = 10_000

export interface InboxDeps {
  s: AgentServices
  library: Library
  /** Called once for each rejected file. */
  alert: (headline: string, detail: string) => void
  now?: () => number
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

  inboxDir(brandName: string): string {
    return join(this.d.library.brandDir(brandName), 'Inbox')
  }

  /** One pass over every enabled brand. Safe to call often. */
  async scan(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let handled = 0
    try {
      const enabled = new Set(this.d.s.settings.get().inboxBrandIds)
      for (const b of this.d.s.brands.list(false)) {
        if (!enabled.has(b.id)) continue
        const dir = this.inboxDir(b.name)
        mkdirSync(join(dir, 'Rejected'), { recursive: true })
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
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
    if (!prev || prev.size !== size) {
      this.seen.set(full, { size, since: now, firstSeen: prev?.firstSeen ?? now })
      return false // still arriving, look again next time
    }
    if (now - prev.since < STABLE_MS) return false
    const stem = name.slice(0, name.length - extname(name).length)
    const sidecar = join(dir, `${stem}.json`)
    const hasSidecar = existsSync(sidecar)
    if (!hasSidecar && now - prev.firstSeen < SIDECAR_GRACE_MS) return false

    let body: CreatePostInput
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
        const obj = { ...(raw as object) } as Record<string, unknown>
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
        body = CreatePostBody.parse(obj)
      } else {
        body = CreatePostBody.parse({ brand_id: brandId, file_path: full, status: 'draft' })
      }
      const post = await agentCreatePost(this.d.s, body, { source: 'inbox', moveSource: true })
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
      renameSync(join(dir, name), dest)
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
