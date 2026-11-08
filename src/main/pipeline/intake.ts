import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, resolve as pathResolve } from 'path'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { BrandService } from '../services/brands'
import type { Library } from '../services/library'
import { moveFile, uniquePath } from '../services/library'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import type { AlertKind } from '../alerts/format'
import { formatEastern } from '@shared/time'
import { slotKindFor } from '@shared/slots'
import { slotKinds } from '../services/channelSettings'
import type { Brand, Post, PostTargetInput } from '@shared/types'
import { PLATFORM_LIMITS, isExtraPlatform, type Platform } from '@shared/platformLimits'
import { loudnessProblem, morphCaption, normalizeTopic, type Loudness } from '@shared/growth'
import {
  CLIP_MAX_SECONDS,
  CLIP_MIN_SECONDS,
  isPipelineSidecar,
  validatePipelineSidecar,
  type DropResult,
  type PipelineSidecarInput,
  type ScheduleOutcome,
  type Reason,
} from '@shared/pipeline'
import type { DropInput, DropLog } from './dropLog'
import type { AuditEvents } from './auditEvents'
import { channelState } from './state'
import { realPlatforms, sha256File, verifyPipelinePost } from './verify'
import { uploadPostOn } from '../services/uploadPost'

export interface ProbeResult {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
}

export interface IntakeDeps {
  db: Db
  settings: SettingsService
  brands: BrandService
  posts: PostService
  library: Library
  drops: DropLog
  audit: AuditEvents
  log: ActivityLog
  /** Tells the owner (screen, iMessage, email, Telegram) when the setting for that kind allows it. */
  notify: (kind: AlertKind, headline: string, detail: string) => void
  /** Reads width, height, length and sound. Without it the video rules are skipped (tests with fake files). */
  probe?: (path: string) => Promise<ProbeResult>
  now?: () => number
  /** Called after any change a screen should show. */
  onChange?: () => void
  /** The extra platforms (Bluesky, X, LinkedIn and Pinterest) a channel has a working login for. */
  extraPlatforms?: (brandId: number) => Platform[]
  /** Search phrases from autocomplete for a title. Without it, no phrases are added by ELO. */
  suggest?: (query: string) => Promise<string[]>
  /** Measures the loudness of a video. Without it the loudness check is skipped. */
  loudness?: (path: string) => Promise<Loudness | null>
  /** Called when a drop is accepted (not held), so Upcoming can mark the episode dropped. */
  onAccepted?: (info: { channel: string; episodeId: string; dropId: string }) => void
}

export type { ScheduleOutcome }
export type IntakeOutcome = {
  result: DropResult
  postId: number | null
  reasons: Reason[]
  scheduledAtUtc: string | null
}

const MAX_THUMB_BYTES = 2 * 1024 * 1024

/** Hashtags for the caption: each tag as #tag, only the ones the text does not already contain. */
export function withHashtags(text: string, tags: string[] | undefined): string {
  const have = new Set(
    (text.match(/#([\p{L}\p{N}_]+)/gu) ?? []).map((t) => t.slice(1).toLowerCase()),
  )
  const add: string[] = []
  for (const raw of tags ?? []) {
    const t = raw
      .trim()
      .replace(/^#/, '')
      .replace(/[^\p{L}\p{N}_]/gu, '')
    if (!t || have.has(t.toLowerCase())) continue
    have.add(t.toLowerCase())
    add.push(`#${t}`)
  }
  return add.length ? `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${add.join(' ')}` : text
}

/**
 * Takes one finished video and its pipeline sidecar from a channel Inbox: checks them, logs the drop, creates the post,
 * and (when the rules allow) gives it the next open slot. The schedule is whatever the owner set in the app. Nothing the
 * sidecar says can pick or promise a time.
 */
export class PipelineIntake {
  constructor(private d: IntakeDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** Is this sidecar a pipeline sidecar? */
  static handles(raw: unknown): boolean {
    return isPipelineSidecar(raw)
  }

  /** The kinds this channel makes, from its Shorts and Long form ticks. Before any tick exists it is the Studio format. */
  private kinds(brandId: number): Array<'short' | 'long'> {
    const rows = slotKinds(this.d.db, brandId).filter((r) => r.enabled)
    return rows.length ? rows.map((r) => r.kind) : [this.format(brandId)]
  }

  private format(brandId: number): 'short' | 'long' {
    const row = this.d.db
      .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
      .get(brandId) as { config_json: string } | undefined
    try {
      return (JSON.parse(row?.config_json ?? '{}') as { format?: string }).format === 'long'
        ? 'long'
        : 'short'
    } catch {
      return 'short'
    }
  }

  private durationRange(brandId: number, fmt: 'short' | 'long'): [number, number] {
    const r = this.d.db
      .prepare('SELECT min_seconds, max_seconds FROM channel_rules WHERE brand_id = ?')
      .get(brandId) as { min_seconds: number | null; max_seconds: number | null } | undefined
    // Long form has no length limit at all. Only a Short has one (5 to 180 seconds, unless the channel sets its own).
    if (fmt === 'long') return [0, Number.POSITIVE_INFINITY]
    return [r?.min_seconds ?? 5, r?.max_seconds ?? 180]
  }

  /** Platforms that cannot take a video this long. They are skipped for this video with a note. */
  private tooLongFor(platforms: string[]): string[] {
    const s = this.lastSeconds
    this.lastSeconds = null
    if (s === null) return []
    return platforms.filter((p) => {
      const l = (PLATFORM_LIMITS as Record<string, { maxSeconds?: number }>)[p]
      return !!l?.maxSeconds && p !== 'youtube' && s > l.maxSeconds
    })
  }

  /** Platforms the owner switched off for this channel in the Studio's per-channel settings. */
  /** The platform ticks that apply to a video: its kind's ticks on Setup Channels, or the clip ticks for a clip. */
  private tickMap(
    brandId: number,
    type: 'episode' | 'clip',
    kind?: 'short' | 'long' | null,
  ): Record<string, boolean> {
    const row = this.d.db
      .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
      .get(brandId) as { config_json: string } | undefined
    try {
      const c = JSON.parse(row?.config_json ?? '{}') as {
        platforms?: Record<string, boolean>
        clipPlatforms?: Record<string, boolean>
      }
      // A Short or Long form video uses its own platform ticks from Setup Channels. A clip uses the clip ticks.
      const own =
        type === 'episode' && kind
          ? slotKinds(this.d.db, brandId).find((r) => r.kind === kind)?.platforms
          : null
      return (type === 'clip' ? c.clipPlatforms : (own ?? c.platforms)) ?? {}
    } catch {
      return {}
    }
  }

  private switchedOff(
    brandId: number,
    type: 'episode' | 'clip' = 'episode',
    kind?: 'short' | 'long' | null,
  ): string[] {
    return Object.entries(this.tickMap(brandId, type, kind))
      .filter(([, on]) => on === false)
      .map(([k]) => k)
  }

  /**
   * The four main platforms ticked for this kind of video. The ticks decide where a video goes, so the bot's list does
   * not matter. Null means this channel has no ticks (or it is a clip), so the bot's list is used. A platform with no
   * connected account is dropped later with a note.
   */
  private tickedCore(brandId: number, type: 'episode' | 'clip', kind?: 'short' | 'long' | null): string[] | null {
    if (type !== 'episode') return null
    const m = this.tickMap(brandId, type, kind)
    const core = ['youtube', 'facebook', 'instagram', 'tiktok']
    if (!core.some((p) => p in m)) return null
    return core.filter((p) => m[p] === true)
  }

  /** Why a drop for this channel would wait instead of being scheduled, or null when it can be scheduled now. */
  waitingReason(
    brandId: number,
    platforms?: string[],
    type: 'episode' | 'clip' = 'episode',
  ): string | null {
    const s = this.d.settings.get()
    if (!s.agentMaySchedule)
      return 'Agents may create drafts only is on in Settings, so nothing is scheduled automatically.'
    if (!s.inboxAutoScheduleBrandIds.includes(brandId))
      return 'Automatic scheduling is off for this channel.'
    const state = channelState(this.d.db, brandId)
    if (state === 'archived') return 'The channel is archived.'
    if (state === 'on-hold') return 'The channel is on hold.'
    if (state === 'paused') return 'The channel is paused.'
    if (type === 'clip' && this.d.posts.clipSchedule(brandId).days.length === 0)
      return 'No clip days are set for this channel (Channels, Studio settings per channel).'
    const real = realPlatforms(this.d.db, brandId)
    const wanted = platforms ?? real
    if (!wanted.some((p) => real.includes(p)))
      return 'The channel has no connected account for these platforms yet.'
    return null
  }

  async process(a: {
    brand: Brand
    videoPath: string
    sidecarPath: string
    raw: unknown
    inboxDir: string
  }): Promise<IntakeOutcome> {
    const s = this.d.settings.get()
    const name = basename(a.videoPath)
    const slug = a.brand.slug ?? ''
    const reasons: Reason[] = []
    let sha: string | null = null
    let size: number | null = null
    try {
      size = statSync(a.videoPath).size
      sha = await sha256File(a.videoPath)
    } catch {
      reasons.push({ code: 'unreadable', message: 'The video file could not be read.' })
    }
    const v = validatePipelineSidecar(a.raw, {
      strict: s.pipelineStrict,
      requireApproval: s.pipelineRequireApproval,
      requireQc: s.pipelineRequireQc,
      sourceBots: s.pipelineSourceBots,
      channelSlug: slug,
    })
    reasons.push(...v.errors)
    const notes = [...v.notes]
    const side = v.data
    const raw = (a.raw && typeof a.raw === 'object' ? a.raw : {}) as Record<string, any>
    const common = {
      sourceBot: side?.source_bot ?? (typeof raw.source_bot === 'string' ? raw.source_bot : null),
      fileName: name,
      filePath: a.videoPath,
      fileSize: size,
      sha256: sha,
      brandId: a.brand.id,
      channel: slug,
      episodeId: side?.episode_id ?? (typeof raw.episode_id === 'string' ? raw.episode_id : null),
      title: side?.title ?? (typeof raw.title === 'string' ? raw.title : null),
      approvedBy: side?.approval?.approved_by ?? raw.approval?.approved_by ?? null,
      approvedAt: side?.approval?.approved_at ?? raw.approval?.approved_at ?? null,
      render: side?.render ?? raw.render,
      postType: ((side?.post_type ?? raw.post_type) === 'clip' ? 'clip' : 'episode') as
        'episode' | 'clip',
    }

    if (side) {
      if (side.video_file !== name)
        reasons.push({
          code: 'video_file_mismatch',
          field: 'video_file',
          message: `video_file says ${side.video_file} but the video dropped is ${name}.`,
        })
      if (sha && side.checksum.value.toLowerCase() !== sha.toLowerCase())
        reasons.push({
          code: 'bad_checksum',
          field: 'checksum',
          message: `The checksum in the sidecar does not match the video (the video is ${sha}).`,
        })
      if (!reasons.length && this.d.probe)
        await this.checkVideo(
          a.brand,
          a.videoPath,
          reasons,
          side.post_type === 'clip' ? 'clip' : 'episode',
        )
      if (!reasons.length) await this.checkThumbnail(side, a.sidecarPath, reasons, notes)
    }
    if (reasons.length) return this.reject(a, reasons, common, !!side, notes)
    const sc = side as PipelineSidecarInput

    // Duplicates: the same video, or the same episode for this channel.
    if (s.pipelineDuplicateDetection) {
      const sameFile = this.d.db
        .prepare(
          `SELECT p.id FROM posts p WHERE p.checksum = ? AND p.status != 'canceled'
           UNION SELECT post_id FROM drops WHERE sha256 = ? AND result IN ('accepted','held') AND post_id IS NOT NULL`,
        )
        .get(sha, sha)
      const sameEpisode = this.d.db
        .prepare(
          "SELECT id FROM posts WHERE brand_id = ? AND episode_ref = ? AND status != 'canceled'",
        )
        .get(a.brand.id, sc.episode_id)
      if (sameFile || sameEpisode) {
        const dup: Reason = sameFile
          ? { code: 'duplicate_checksum', message: 'This exact video was already dropped.' }
          : {
              code: 'duplicate_episode',
              field: 'episode_id',
              message: `Episode ${sc.episode_id} is already in the queue or posted for this channel.`,
            }
        return this.reject(a, [dup], common, true, notes, 'duplicate')
      }
    }

    // Oct 13 safeguard: the file name must carry the episode id, or the drop is held for a look.
    let hold: string | null = null
    if (!name.includes(sc.episode_id))
      hold = `The file name ${name} does not contain the episode id ${sc.episode_id}.`

    // Build and create the post. Every requested platform gets a target. Platforms with no real account are dropped
    // when the post is scheduled, so a drop that arrives before the accounts exist can still wait.
    const fmt = this.format(a.brand.id)
    const thumb = this.thumbnailFile(sc, a.sidecarPath)
    const caption = withHashtags(sc.description, sc.tags)
    const postType: 'episode' | 'clip' = sc.post_type === 'clip' ? 'clip' : 'episode'
    // A clip with no platforms goes to every platform the show has switched on for clips.
    // The four original platforms come from the sidecar. Bluesky, X, LinkedIn and Pinterest are not chosen by a
    // bot: a channel with a login for one posts there on its own, and a channel without one ignores it.
    const kindNow = this.lastKind ?? (this.kinds(a.brand.id).length === 1 ? this.kinds(a.brand.id)[0]! : null)
    this.lastKind = null
    // The ticks on Setup Channels decide where a video goes. The bot's list is used only for a channel with no ticks yet.
    const ticked = this.tickedCore(a.brand.id, postType, kindNow)
    const fromBot = (sc.platforms ?? ['youtube', 'facebook', 'instagram', 'tiktok']).filter(
      (p) => !isExtraPlatform(p),
    )
    const asked: string[] = [
      ...new Set([
        ...(ticked === null ? fromBot : ticked),
        ...(this.d.extraPlatforms?.(a.brand.id) ?? []),
      ]),
    ]
    // Platforms the bot asked for that are not ticked stay out, and the note says so.
    const notTicked = ticked === null ? [] : fromBot.filter((p) => !ticked.includes(p))
    const everAsked = [...asked, ...notTicked]
    const off = [
      ...this.switchedOff(a.brand.id, postType, kindNow),
      ...this.tooLongFor(asked),
      ...notTicked,
    ]
    const wanted = asked.filter((p) => !off.includes(p))
    if (wanted.length < everAsked.length)
      notes.push(
        `Skipped (switched off or too long for the platform): ${everAsked.filter((p) => off.includes(p)).join(', ')}.`,
      )
    if (wanted.length === 0 && !hold)
      hold = 'Every platform for this video is switched off for this channel.'
    const targets: PostTargetInput[] = (wanted.length ? wanted : asked).map((p) => ({
      platform: p as Platform,
      aiFlag: sc.ai_flags?.[p] ?? true,
      captionOverride: sc.caption_overrides?.[p] ?? null,
      settings: {
        ...(p === 'instagram' && sc.thumb_offset_ms !== undefined
          ? { thumbOffsetMs: sc.thumb_offset_ms }
          : {}),
        ...(postType === 'clip' && p === 'youtube' ? { shorts: true } : {}),
        ...(sc.first_comments?.[p] ? { firstComment: sc.first_comments[p] } : {}),
      },
    }))
    let post: Post
    try {
      post = await this.d.posts.create({
        brandId: a.brand.id,
        sourcePath: a.videoPath,
        moveSource: true,
        title: sc.title.slice(0, 200),
        caption,
        scheduledAtUtc: null,
        status: 'draft',
        targets,
        firstComment: sc.first_comment ?? null,
        origin: 'inbox',
        pipeline: {
          episodeRef: sc.episode_id,
          checksum: (sha as string).toLowerCase(),
          sidecarTitle: sc.title.slice(0, 200),
          sourceBot: sc.source_bot,
          videoBasename: name,
          postType,
          channelLink: postType === 'clip' && sc.channel_link !== false,
          sourceEpisodeRef: postType === 'clip' ? (sc.source_episode_id ?? null) : null,
          holdReason: hold,
        },
      })
    } catch (e) {
      return this.reject(
        a,
        [{ code: 'unreadable', message: (e as Error).message }],
        common,
        true,
        notes,
      )
    }
    // Keep the sidecar and the thumbnail with the video, in Queue.
    const queueVideo = this.d.library.resolve(post.videoPath)
    const stem = queueVideo.slice(0, queueVideo.length - extname(queueVideo).length)
    try {
      moveFile(a.sidecarPath, uniquePath(dirname(stem), `${basename(stem)}.json`))
    } catch {
      // The post exists; a missing sidecar copy is not worth failing the drop.
    }
    if (thumb) {
      const dest = uniquePath(dirname(stem), `${basename(stem)}_thumb${extname(thumb)}`)
      try {
        moveFile(thumb, dest)
        if ((slotKindFor(post.videoMeta) ?? fmt) === 'long' && postType === 'episode')
          this.setYoutubeThumbnail(post.id, dest)
      } catch {
        notes.push('The thumbnail could not be moved.')
      }
    }
    await this.applyGrowth(
      post.id,
      sc,
      a.sidecarPath,
      wanted.length ? wanted : asked,
      queueVideo,
      stem,
      notes,
    )
    if (sc.preferred_slot !== undefined) notes.push('Ignored: the schedule is set in ELO.')

    const result: DropResult = hold ? 'held' : 'accepted'
    const row = this.d.drops.record({
      ...common,
      sidecarValid: true,
      result,
      reason: hold,
      postId: post.id,
      notes: notes.join(' ') || null,
    })
    this.d.log.log(
      hold ? 'warn' : 'info',
      hold
        ? `Drop held: ${sc.episode_id} "${sc.title}" (${a.brand.name}). ${hold}`
        : `Drop accepted: ${sc.episode_id} "${sc.title}" for ${a.brand.name} from ${sc.source_bot}.`,
      { postId: post.id },
    )
    this.d.audit.write({
      actor: `agent:${sc.source_bot}`,
      action: hold ? 'drop.held' : 'drop.accepted',
      target: `${slug}/${sc.episode_id}`,
      after: { postId: post.id, sha256: sha, reason: hold },
    })
    if (hold)
      this.d.notify(
        'drop_rejected',
        'A drop was held.',
        `${a.brand.name}, ${sc.episode_id}: ${hold}`,
      )
    else {
      this.d.notify(
        'drop_accepted',
        'A video was dropped.',
        `${a.brand.name}: "${sc.title}" (${sc.episode_id}) is in the queue.`,
      )
      this.d.onAccepted?.({ channel: slug, episodeId: sc.episode_id, dropId: row.dropId })
    }

    let scheduledAtUtc: string | null = null
    if (!hold) {
      const wait = this.waitingReason(a.brand.id, wanted.length ? wanted : asked, postType)
      if (!wait) {
        const r = await this.scheduleDrop(post.id)
        if (r.ok) scheduledAtUtc = r.scheduledAtUtc ?? null
      } else {
        this.d.drops.update(row.dropId, {
          notes: [notes.join(' '), `Waiting: ${wait}`].filter(Boolean).join(' '),
        })
      }
    }
    this.d.onChange?.()
    return { result, postId: post.id, reasons: [], scheduledAtUtc }
  }

  /** Length of the last video checked, so platforms that cannot take it can be skipped. */
  private lastSeconds: number | null = null
  /** Short or Long form, from the shape of the last video checked. */
  private lastKind: 'short' | 'long' | null = null

  /** The reasons a video does not fit a channel (shape, length, sound), for a replacement file. Empty means it fits. */
  async videoProblems(brand: Brand, path: string, type: 'episode' | 'clip'): Promise<Reason[]> {
    const reasons: Reason[] = []
    if (this.d.probe) await this.checkVideo(brand, path, reasons, type)
    return reasons
  }

  private async checkVideo(
    brand: Brand,
    path: string,
    reasons: Reason[],
    type: 'episode' | 'clip' = 'episode',
  ): Promise<void> {
    let info: ProbeResult
    try {
      info = await (this.d.probe as (p: string) => Promise<ProbeResult>)(path)
    } catch (e) {
      reasons.push({
        code: 'unreadable',
        message: `The video could not be read: ${(e as Error).message}`,
      })
      return
    }
    this.lastSeconds = info.durationSeconds
    this.lastKind = null
    if (type === 'clip') {
      // A clip is always tall, whatever the show's video type is.
      const r = info.height ? info.width / info.height : 0
      if (!r || Math.abs(r - 9 / 16) / (9 / 16) > 0.03)
        reasons.push({
          code: 'bad_format',
          message: `A clip must be 9:16 (tall). This one is ${info.width}x${info.height}.`,
        })
      if (info.durationSeconds < CLIP_MIN_SECONDS || info.durationSeconds > CLIP_MAX_SECONDS)
        reasons.push({
          code: 'bad_duration',
          message: `A clip is ${CLIP_MIN_SECONDS} to ${CLIP_MAX_SECONDS} seconds. This one is ${Math.round(info.durationSeconds)}.`,
        })
      if (!info.hasAudio) reasons.push({ code: 'no_audio', message: 'The video has no sound.' })
      return
    }
    const ratio = info.height ? info.width / info.height : 0
    const near = (want: number) => !!ratio && Math.abs(ratio - want) / want <= 0.03
    const kinds = this.kinds(brand.id)
    if (kinds.length > 1) {
      // The channel does both. The shape of the video decides: tall is a Short, wide is Long form.
      const fmt: 'short' | 'long' | null = near(9 / 16) ? 'short' : near(16 / 9) ? 'long' : null
      this.lastKind = fmt
      const [smin, smax] = this.durationRange(brand.id, 'short')
      const base = `This channel takes tall shorts or wide long videos. Shorts are ${smin} to ${smax} seconds, long videos have no length limit. This one is ${info.width}x${info.height} and ${Math.round(info.durationSeconds)} seconds.`
      if (!fmt) reasons.push({ code: 'bad_format', message: base })
      else if (fmt === 'short' && (info.durationSeconds < smin || info.durationSeconds > smax))
        reasons.push({ code: 'bad_duration', message: base })
      if (!info.hasAudio) reasons.push({ code: 'no_audio', message: 'The video has no sound.' })
      return
    }
    const fmt = kinds[0]!
    this.lastKind = fmt
    const want = fmt === 'long' ? 16 / 9 : 9 / 16
    if (!ratio || Math.abs(ratio - want) / want > 0.03)
      reasons.push({
        code: 'bad_format',
        message: `This channel makes ${fmt === 'long' ? '16:9 (wide)' : '9:16 (tall)'} videos. This one is ${info.width}x${info.height}.`,
      })
    const [min, max] = this.durationRange(brand.id, fmt)
    if (info.durationSeconds < min || info.durationSeconds > max)
      reasons.push({
        code: 'bad_duration',
        message: `The video is ${Math.round(info.durationSeconds)} seconds. This channel takes ${min} to ${max} seconds.`,
      })
    if (!info.hasAudio) reasons.push({ code: 'no_audio', message: 'The video has no sound.' })
  }

  private thumbnailFile(sc: PipelineSidecarInput, sidecarPath: string): string | null {
    if (!sc.thumbnail_path) return null
    const p = pathResolve(dirname(sidecarPath), sc.thumbnail_path)
    return existsSync(p) ? p : null
  }

  private async checkThumbnail(
    sc: PipelineSidecarInput,
    sidecarPath: string,
    reasons: Reason[],
    notes: string[],
  ): Promise<void> {
    if (!sc.thumbnail_path) return
    const p = pathResolve(dirname(sidecarPath), sc.thumbnail_path)
    const problem = !existsSync(p)
      ? `The thumbnail ${sc.thumbnail_path} is not there.`
      : !/\.(jpe?g|png)$/i.test(p)
        ? 'The thumbnail must be a JPG or PNG.'
        : statSync(p).size > MAX_THUMB_BYTES
          ? 'The thumbnail is bigger than 2 MB.'
          : null
    if (!problem) return
    if (this.d.settings.get().pipelineStrict)
      reasons.push({ code: 'bad_thumbnail', field: 'thumbnail_path', message: problem })
    else notes.push(problem)
  }

  /**
   * The growth fields of a drop: topic, first comment, poll, platform captions, search tags, spare thumbnails and the
   * loudness check. Nothing here can fail the drop: a problem becomes a note.
   */
  private async applyGrowth(
    postId: number,
    sc: PipelineSidecarInput,
    sidecarPath: string,
    platforms: string[],
    queueVideo: string,
    stem: string,
    notes: string[],
  ): Promise<void> {
    const s = this.d.settings.get()
    const db = this.d.db
    try {
      db.prepare(
        'UPDATE posts SET topic = ?, pinned_comment = ?, community_poll = ? WHERE id = ?',
      ).run(
        normalizeTopic(sc.topic),
        sc.pinned_comment?.trim() || null,
        sc.community_poll?.trim() || null,
        postId,
      )
    } catch {
      // The drop stands without them.
    }
    if (s.captionMorphEnabled) {
      const full = withHashtags(sc.description, sc.tags)
      for (const p of platforms) {
        if (p === 'youtube' || sc.caption_overrides?.[p]) continue
        const text = morphCaption(p as Platform, { description: sc.description, tags: sc.tags })
        if (text && text !== full)
          db.prepare(
            'UPDATE post_targets SET caption_override = ? WHERE post_id = ? AND platform = ?',
          ).run(text, postId, p)
      }
    }
    if (s.seoTagsEnabled && platforms.includes('youtube')) {
      try {
        let phrases = sc.search_phrases ?? []
        if (!phrases.length && this.d.suggest) {
          const words = sc.title
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean)
          const found: string[] = []
          for (const n of [5, 3]) {
            const q = words.slice(0, n).join(' ')
            if (q) found.push(...(await this.d.suggest(q)))
          }
          phrases = [...new Set(found)].filter((x) => x.length <= 60).slice(0, 8)
        }
        if (phrases.length) this.mergeYoutubeSettings(postId, { searchTags: phrases })
      } catch {
        notes.push('Search phrases could not be fetched.')
      }
    }
    if (sc.thumbnail_variants?.length && platforms.includes('youtube')) {
      const kept: string[] = []
      sc.thumbnail_variants.forEach((v, i) => {
        const src = pathResolve(dirname(sidecarPath), v)
        if (
          !/\.(jpe?g|png)$/i.test(src) ||
          !existsSync(src) ||
          statSync(src).size > MAX_THUMB_BYTES
        ) {
          notes.push(`Thumbnail variant ${v} was skipped (missing, not JPG or PNG, or over 2 MB).`)
          return
        }
        const dest = uniquePath(dirname(stem), `${basename(stem)}_thumb_v${i + 1}${extname(src)}`)
        try {
          moveFile(src, dest)
          kept.push(this.d.library.toRelative(dest))
        } catch {
          notes.push(`Thumbnail variant ${v} could not be moved.`)
        }
      })
      if (kept.length)
        db.prepare('UPDATE posts SET thumb_variants_json = ? WHERE id = ?').run(
          JSON.stringify(kept),
          postId,
        )
    }
    if (s.loudnessCheckEnabled && this.d.loudness) {
      try {
        const l = await this.d.loudness(queueVideo)
        if (l) {
          db.prepare('UPDATE posts SET loudness_json = ? WHERE id = ?').run(
            JSON.stringify(l),
            postId,
          )
          const problem = loudnessProblem(l)
          if (problem) notes.push(problem)
        }
      } catch {
        // No loudness reading. The drop stands.
      }
    }
  }

  private mergeYoutubeSettings(postId: number, patch: Record<string, unknown>): void {
    const row = this.d.db
      .prepare(
        "SELECT id, settings_json FROM post_targets WHERE post_id = ? AND platform = 'youtube'",
      )
      .get(postId) as { id: number; settings_json: string | null } | undefined
    if (!row) return
    const st = ((): Record<string, unknown> => {
      try {
        return JSON.parse(row.settings_json ?? '{}') as Record<string, unknown>
      } catch {
        return {}
      }
    })()
    this.d.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...st, ...patch }), row.id)
  }

  private setYoutubeThumbnail(postId: number, file: string): void {
    this.mergeYoutubeSettings(postId, { thumbnailPath: file })
  }

  private reject(
    a: { brand: Brand; videoPath: string; sidecarPath: string; inboxDir: string },
    reasons: Reason[],
    common: Omit<DropInput, 'sidecarValid' | 'result'>,
    sidecarValid: boolean,
    notes: string[],
    result: 'rejected' | 'duplicate' = 'rejected',
  ): IntakeOutcome {
    const name = basename(a.videoPath)
    const rejectedDir = join(a.inboxDir, 'Rejected')
    mkdirSync(rejectedDir, { recursive: true })
    const row = this.d.drops.record({
      ...common,
      sidecarValid,
      result,
      reason: reasons.map((r) => r.message).join(' | '),
      notes: notes.join(' ') || null,
    })
    const dest = uniquePath(rejectedDir, name)
    try {
      if (existsSync(a.videoPath)) renameSync(a.videoPath, dest)
      if (existsSync(a.sidecarPath))
        renameSync(a.sidecarPath, uniquePath(rejectedDir, basename(a.sidecarPath)))
      const stem = dest.replace(/\.[^.]+$/, '')
      const text = reasons.map((r) => `- ${r.message}`).join('\n')
      writeFileSync(`${stem}.error.txt`, `This file was not accepted from the Inbox.\n\n${text}\n`)
      writeFileSync(
        `${stem}.reason.json`,
        JSON.stringify(
          {
            drop_id: row.dropId,
            result,
            at: new Date(this.now()).toISOString(),
            file: name,
            reasons: reasons.map((r) => ({
              code: r.code,
              field: r.field ?? null,
              message: r.message,
            })),
          },
          null,
          2,
        ) + '\n',
      )
    } catch {
      // If even moving fails, leave the files where they are. The drop log still has the reason.
    }
    const first = reasons[0]?.message ?? 'Not accepted.'
    this.d.log.log('error', `Drop ${result}: "${name}" (${a.brand.name}). ${first}`)
    this.d.audit.write({
      actor: common.sourceBot ? `agent:${common.sourceBot}` : 'system',
      action: `drop.${result}`,
      target: `${common.channel ?? ''}/${common.episodeId ?? name}`,
      after: { reasons: reasons.map((r) => r.code) },
    })
    this.d.notify(
      'drop_rejected',
      result === 'duplicate' ? 'A duplicate drop was refused.' : 'A drop was not accepted.',
      `${a.brand.name}: ${name}. ${first} See the Rejected folder inside the Inbox.`,
    )
    this.d.onChange?.()
    return { result, postId: null, reasons, scheduledAtUtc: null }
  }

  // ---------- scheduling ----------

  /**
   * Gives a waiting drop the next open slot, using the channel's own slots, days, cap and blackout dates.
   * Platforms with no real account are dropped from the post first. Nothing here picks a time of its own.
   */
  async scheduleDrop(postId: number, opts: { slot?: string } = {}): Promise<ScheduleOutcome> {
    const post = this.d.posts.get(postId)
    if (!post) return { ok: false, message: 'That post was not found.' }
    if (post.status !== 'draft')
      return { ok: false, message: `This post is already ${post.status}.` }
    if (post.holdReason) return { ok: false, message: `It is held: ${post.holdReason}`, held: true }
    const why = await verifyPipelinePost(this.d.db, this.d.library, postId)
    if (why) {
      this.d.posts.setHold(postId, why)
      this.recordHold(post, why)
      return { ok: false, message: `Held: ${why}`, held: true }
    }
    // TikTok is always Drafts mode in the pipeline. A channel set to Direct post leaves TikTok out, with a note.
    // A channel posting to TikTok through Upload-Post is not left out: it posts to the feed.
    const tiktokDirect =
      !uploadPostOn(this.d.db, post.brandId, 'tiktok') &&
      !!this.d.db
        .prepare(
          "SELECT 1 FROM accounts WHERE brand_id = ? AND platform = 'tiktok' AND mode = 'direct'",
        )
        .get(post.brandId)
    const real = realPlatforms(this.d.db, post.brandId).filter(
      (p) => !(p === 'tiktok' && tiktokDirect),
    )
    const keep = post.targets.filter((t) => real.includes(t.platform))
    if (keep.length === 0)
      return {
        ok: false,
        message:
          'Connect an account first. None of the platforms for this drop has a real account.',
      }
    const skipped = post.targets.filter((t) => !real.includes(t.platform)).map((t) => t.platform)
    if (skipped.length) {
      this.d.db
        .prepare(
          `DELETE FROM post_targets WHERE post_id = ? AND platform IN (${skipped.map(() => '?').join(',')})`,
        )
        .run(postId, ...skipped)
    }
    const isClip = post.postType === 'clip'
    const open = (n: number) =>
      isClip
        ? this.d.posts.nextClipSlots(post.brandId, n)
        : this.d.posts.nextSlots(post.brandId, n, undefined, [], slotKindFor(post.videoMeta))
    const slot = opts.slot ?? open(1)[0]
    if (!slot)
      return {
        ok: false,
        message: isClip
          ? `${post.brandName} has no clip days. Tick some in Channels, Studio settings per channel.`
          : `${post.brandName} has no open slot. Add slot times first.`,
      }
    const slotOk = (s: string) =>
      open(60).includes(s) ||
      this.d.posts
        .openSlotsInRange(
          post.brandId,
          new Date(new Date(s).getTime() - 60_000).toISOString(),
          new Date(new Date(s).getTime() + 60_000).toISOString(),
        )
        .some((o) => o.whenUtc === s && o.kind === (isClip ? 'clip' : 'episode'))
    if (opts.slot && !slotOk(opts.slot))
      return { ok: false, message: 'That time is not one of the open slots for this channel.' }
    this.d.posts.update(postId, { scheduledAtUtc: slot, status: 'scheduled' })
    const drop = this.d.drops.forPost(postId)
    if (drop)
      this.d.drops.update(drop.dropId, {
        scheduledSlot: slot,
        notes: [
          drop.notes,
          skipped.length ? `Skipped (no real account): ${skipped.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      })
    this.d.log.log(
      'info',
      `Scheduled "${post.title}" (${post.brandName}) for ${formatEastern(slot)}${skipped.length ? `. Skipped ${skipped.join(', ')}: no real account` : ''}.`,
      { postId },
    )
    this.d.audit.write({
      actor: 'system',
      action: 'post.schedule',
      target: `${post.brandName}/${post.episodeRef ?? post.id}`,
      after: { slot, skipped },
    })
    this.d.notify(
      'scheduled',
      'A video was scheduled.',
      `${post.brandName}: "${post.title}" goes out ${formatEastern(slot)}.`,
    )
    this.d.onChange?.()
    return { ok: true, message: `Scheduled for ${formatEastern(slot)}.`, scheduledAtUtc: slot }
  }

  /**
   * Why a paused channel cannot be resumed yet, or null. A channel with finished videos waiting for it and no real
   * connected account cannot be resumed, because there is nowhere to send them.
   */
  resumeProblem(brandId: number): string | null {
    if (this.d.settings.get().globalDryRun) return null
    if (realPlatforms(this.d.db, brandId).length > 0) return null
    if (this.waitingPostIds(brandId).length === 0) return null
    return 'Connect an account first. Open Connections, connect at least one platform for this channel, then resume it. Videos are waiting for it.'
  }

  /** What resume does for a channel: refuse with no real account, otherwise schedule the waiting drops in arrival order. */
  async scheduleWaiting(brandId: number): Promise<{ scheduled: number; message: string }> {
    const ids = this.waitingPostIds(brandId)
    if (ids.length === 0) return { scheduled: 0, message: '' }
    let n = 0
    for (const id of ids) {
      const r = await this.scheduleDrop(id)
      if (!r.ok && !r.held) return { scheduled: n, message: r.message }
      if (r.ok) n++
    }
    return { scheduled: n, message: n ? `Scheduled ${n} waiting video(s).` : '' }
  }

  /** Drops that are accepted and have no slot yet, oldest first. Held ones are not included. */
  waitingPostIds(brandId?: number): number[] {
    return (
      this.d.db
        .prepare(
          `SELECT id FROM posts WHERE origin = 'inbox' AND episode_ref IS NOT NULL AND status = 'draft'
           AND hold_reason IS NULL AND media_purged_at IS NULL ${brandId ? 'AND brand_id = ?' : ''} ORDER BY id`,
        )
        .all(...(brandId ? [brandId] : [])) as Array<{ id: number }>
    ).map((r) => r.id)
  }

  private recordHold(post: Post, why: string): void {
    this.d.log.log('warn', `Held "${post.title}" (${post.brandName}): ${why}`, { postId: post.id })
    this.d.audit.write({
      actor: 'system',
      action: 'post.hold',
      target: `${post.brandName}/${post.episodeRef ?? post.id}`,
      after: { reason: why },
    })
    this.d.notify('drop_rejected', 'A post was held.', `${post.brandName}, "${post.title}": ${why}`)
  }
}
