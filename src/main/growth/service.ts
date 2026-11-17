import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { SettingsService } from '../services/settings'
import {
  isViewerQuestion,
  learningLine,
  slowStart,
  steepestDrop,
  type CurvePoint,
} from '@shared/growth'
import { ZONE } from '@shared/time'

const HOUR = 3_600_000

function json<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

export interface YoutubePort {
  postComment(accountId: number, videoId: string, text: string): Promise<string>
  listComments(
    accountId: number,
    videoId: string,
  ): Promise<Array<{ id: string; text: string; author: string; publishedAt: string }>>
  setPrivacy(
    accountId: number,
    videoId: string,
    privacy: 'private' | 'unlisted' | 'public',
  ): Promise<void>
  videoStatus(
    accountId: number,
    videoId: string,
  ): Promise<{ privacyStatus: string; uploadStatus?: string; rejectionReason?: string } | null>
}

export interface GrowthDeps {
  db: Db
  settings: SettingsService
  log: ActivityLog
  /** A message on screen and in Telegram. */
  notify: (headline: string, detail: string) => void
  /** The Monday brief: iMessage, email and Telegram. */
  send: (text: string) => Promise<void>
  youtube: YoutubePort
  /** Reads the live numbers for a post's targets into post_stats. */
  refreshStats: (postId: number) => Promise<unknown>
  /** The audience curve from YouTube Analytics. */
  readRetention: (
    accountId: number,
    videoId: string,
    fromDate: string,
    toDate: string,
  ) => Promise<{ avgViewPercent: number | null; curve: CurvePoint[] }>
  /** Thumbnail click through rate (a fraction, 0.045 is 4.5 percent) for a video between two times. */
  readCtr: (
    accountId: number,
    videoId: string,
    fromUtc: string,
    toUtc: string,
  ) => Promise<number | null>
  setThumbnail: (accountId: number, videoId: string, file: string) => Promise<void>
  /** Turns a path inside the Media Root into a full path. */
  resolve: (rel: string) => string
  /** Adds an idea card to Upcoming. */
  addIdea: (i: {
    channel: string
    title: string
    premise: string
    extra: Record<string, unknown>
  }) => Promise<string>
  upcomingCounts: () => Record<string, number>
  /** Lines about better posting times, for the brief. */
  bestTimeLines: () => string[]
  /** Slots with nothing in them in the next days, for the brief. */
  emptySlotCount: (days: number) => number
  sharedDir: () => string
  /** True when real platforms are in use (not dry run). */
  live: () => boolean
  now?: () => number
}

interface TargetRow {
  target_id: number
  post_id: number
  platform: string
  account_id: number | null
  external_id: string
  external_url: string | null
  posted_at_utc: string
  settings_json: string | null
  brand_id: number
  brand_name: string
  brand_slug: string | null
  episode_ref: string | null
  title: string
  pinned_comment: string | null
  community_poll: string | null
  thumb_variants_json: string | null
  video_meta_json: string | null
  a_mode: string | null
}

export interface RetractOutcome {
  platform: string
  outcome: 'hidden' | 'manual' | 'skipped' | 'failed'
  detail: string
  url: string | null
}

const SELECT = `
  SELECT t.id AS target_id, t.post_id, t.platform, t.account_id, t.external_id, t.external_url, t.posted_at_utc,
         t.settings_json, p.brand_id, b.name AS brand_name, b.slug AS brand_slug, p.episode_ref, p.title,
         p.pinned_comment, p.community_poll, p.thumb_variants_json, p.video_meta_json, a.mode AS a_mode
  FROM post_targets t
  JOIN posts p ON p.id = t.post_id
  JOIN brands b ON b.id = p.brand_id
  LEFT JOIN accounts a ON a.id = t.account_id
  WHERE t.status = 'posted' AND t.external_id IS NOT NULL AND t.posted_at_utc IS NOT NULL`

/**
 * The growth jobs that run after a video is live: early warnings, the pinned comment, the poll reminder, what viewers
 * watched, thumbnail rescue, viewer questions and the Monday brief. Every job is safe to repeat: what it did is remembered.
 */
export class GrowthService {
  private lastFanScan = 0
  private running = false

  constructor(private d: GrowthDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------------------------------------------------------------- helpers

  private state(r: TargetRow): Record<string, any> {
    return json(r.settings_json, {})
  }

  private setState(targetId: number, patch: Record<string, unknown>): void {
    const row = this.d.db
      .prepare('SELECT settings_json FROM post_targets WHERE id = ?')
      .get(targetId) as { settings_json: string | null } | undefined
    const cur = json<Record<string, unknown>>(row?.settings_json, {})
    this.d.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...cur, ...patch }), targetId)
  }

  /** Posted targets that are real (not dry run, not a test copy), newest first, posted after a time. */
  private posted(sinceMs: number, platform?: string): TargetRow[] {
    if (!this.d.live()) return []
    const since = new Date(sinceMs).toISOString()
    const rows = this.d.db
      .prepare(
        `${SELECT} AND t.posted_at_utc >= ? ${platform ? 'AND t.platform = ?' : ''} ORDER BY t.posted_at_utc DESC`,
      )
      .all(...(platform ? [since, platform] : [since])) as TargetRow[]
    return rows.filter(
      (r) => r.a_mode !== 'dry_run' && r.account_id !== null && !this.state(r).mock,
    )
  }

  private ageHours(r: TargetRow): number {
    return (this.now() - new Date(r.posted_at_utc).getTime()) / HOUR
  }

  private link(r: TargetRow): string {
    return r.external_url ?? ''
  }

  private guard(name: string, f: () => Promise<unknown>): Promise<void> {
    return f()
      .then(() => undefined)
      .catch((e) =>
        this.d.log.log('warn', `Growth job "${name}" could not finish: ${(e as Error).message}`),
      )
  }

  /** Runs every job once. The app calls this every few minutes. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const s = this.d.settings.get()
      if (s.velocityRadarEnabled) await this.guard('early check', () => this.velocity())
      if (s.pinnedCommentEnabled) await this.guard('pinned comment', () => this.pinnedComments())
      if (s.pollReminderEnabled) await this.guard('poll reminder', () => this.pollReminders())
      if (s.learningsEnabled) await this.guard('learnings', () => this.learnings())
      if (s.thumbRescueEnabled) await this.guard('thumbnail rescue', () => this.thumbRescue())
      if (s.fanQuestionsEnabled) await this.guard('viewer questions', () => this.fanQuestions())
      if (s.briefEnabled) await this.guard('Monday brief', () => this.briefIfDue())
    } finally {
      this.running = false
    }
  }

  // ---------------------------------------------------------------- early warning (hours 1, 2 and 4)

  async velocity(): Promise<number> {
    let flagged = 0
    const done = (id: number, h: number) =>
      !!this.d.db
        .prepare('SELECT 1 FROM velocity_checks WHERE post_target_id = ? AND hour = ?')
        .get(id, h)
    const byPost = new Map<number, TargetRow[]>()
    for (const r of this.posted(this.now() - 5 * HOUR)) {
      const list = byPost.get(r.post_id) ?? []
      list.push(r)
      byPost.set(r.post_id, list)
    }
    for (const [postId, targets] of byPost) {
      const due = targets.flatMap((r) =>
        [1, 2, 4]
          .filter((h) => this.ageHours(r) >= h && !done(r.target_id, h))
          .map((h) => ({ r, h })),
      )
      if (!due.length) continue
      await this.d.refreshStats(postId).catch(() => undefined)
      for (const { r, h } of due) {
        const row = this.d.db
          .prepare(
            'SELECT views FROM post_stats WHERE post_target_id = ? ORDER BY fetched_at_utc DESC LIMIT 1',
          )
          .get(r.target_id) as { views: number | null } | undefined
        const views = row?.views ?? null
        const past = (
          this.d.db
            .prepare(
              `SELECT v.views FROM velocity_checks v JOIN post_targets t ON t.id = v.post_target_id JOIN posts p ON p.id = t.post_id
               WHERE p.brand_id = ? AND t.platform = ? AND v.hour = ? AND v.post_target_id != ? AND v.views IS NOT NULL
               ORDER BY v.id DESC LIMIT 12`,
            )
            .all(r.brand_id, r.platform, h, r.target_id) as Array<{ views: number }>
        ).map((x) => x.views)
        const slow = views !== null && h >= 2 && slowStart(views, past)
        let note: string | null = slow
          ? `${views} views at hour ${h} is well under the usual for this channel.`
          : null
        let problem: string | null = null
        if (r.platform === 'youtube' && r.account_id !== null) {
          const st = await this.d.youtube.videoStatus(r.account_id, r.external_id).catch(() => null)
          if (
            st &&
            (st.rejectionReason ||
              ['rejected', 'failed', 'deleted'].includes(st.uploadStatus ?? ''))
          )
            problem = `YouTube says this video was ${st.uploadStatus ?? 'rejected'}${st.rejectionReason ? ` (${st.rejectionReason})` : ''}.`
          else if (st && st.privacyStatus !== 'public' && st.privacyStatus !== 'unknown')
            problem = `YouTube shows this video as ${st.privacyStatus}, not public.`
        }
        if (problem) note = problem
        this.d.db
          .prepare(
            `INSERT OR IGNORE INTO velocity_checks (post_target_id, hour, views, baseline_mean, flagged, note, checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            r.target_id,
            h,
            views,
            past.length ? past.reduce((a, b) => a + b, 0) / past.length : null,
            note ? 1 : 0,
            note,
            new Date(this.now()).toISOString(),
          )
        if (note) {
          flagged++
          const ep = r.episode_ref ?? r.title
          this.d.notify(
            problem ? `Check ${r.brand_name}: ${ep}` : `Slow start: ${r.brand_name} ${ep}`,
            `${platformName(r.platform)}: ${note}${
              problem ? '' : ' Consider tweaking the title or thumbnail.'
            }${this.link(r) ? ` ${this.link(r)}` : ''}`,
          )
        }
      }
    }
    return flagged
  }

  // ---------------------------------------------------------------- pinned first comment

  async pinnedComments(): Promise<number> {
    let n = 0
    for (const r of this.posted(this.now() - 3 * 24 * HOUR, 'youtube')) {
      if (!r.pinned_comment?.trim() || this.state(r).commentPosted) continue
      if (r.account_id === null) continue
      try {
        const id = await this.d.youtube.postComment(
          r.account_id,
          r.external_id,
          r.pinned_comment.trim(),
        )
        this.setState(r.target_id, { commentPosted: true, commentId: id })
        n++
        this.d.log.log('info', `First comment posted on YouTube for ${r.episode_ref ?? r.title}.`, {
          postId: r.post_id,
          platform: 'youtube',
        })
        this.d.notify(
          `Pin the comment: ${r.brand_name} ${r.episode_ref ?? ''}`.trim(),
          `ELO posted the first comment on YouTube. YouTube's API cannot pin it, so open the video in YouTube Studio and choose Pin on your comment.${
            this.link(r) ? ` ${this.link(r)}` : ''
          } On Instagram, Facebook and TikTok paste it yourself: ${r.pinned_comment.trim()}`,
        )
      } catch (e) {
        this.setState(r.target_id, { commentPosted: true, commentError: (e as Error).message })
        this.d.log.log(
          'warn',
          `Could not post the first comment on YouTube for ${r.episode_ref ?? r.title}: ${(e as Error).message}`,
          { postId: r.post_id, platform: 'youtube' },
        )
        this.d.notify(
          `First comment not posted: ${r.brand_name}`,
          `${(e as Error).message} Post it by hand: ${r.pinned_comment.trim()}`,
        )
      }
    }
    return n
  }

  // ---------------------------------------------------------------- companion poll reminder

  async pollReminders(): Promise<number> {
    let n = 0
    for (const r of this.posted(this.now() - 24 * HOUR, 'youtube')) {
      if (!r.community_poll?.trim() || this.state(r).pollReminded) continue
      if (this.ageHours(r) < 0.5) continue
      this.setState(r.target_id, { pollReminded: true })
      n++
      this.d.notify(
        `Post the poll: ${r.brand_name} ${r.episode_ref ?? ''}`.trim(),
        `YouTube has no way for apps to post to the Community tab, so post this poll yourself: open YouTube Studio, then Create, then Create post, then Poll. ${r.community_poll.trim()}`,
      )
    }
    return n
  }

  // ---------------------------------------------------------------- what viewers watched

  /** One lesson per video, 48 hours after it went live. Writes Shared/learnings.md for the next script. */
  async learnings(): Promise<number> {
    let n = 0
    for (const r of this.posted(this.now() - 14 * 24 * HOUR, 'youtube')) {
      if (this.ageHours(r) < 48 || r.account_id === null) continue
      const have = this.d.db
        .prepare("SELECT 1 FROM learnings WHERE post_id = ? AND kind = 'retention'")
        .get(r.post_id)
      if (have) continue
      const duration =
        Number(json<{ durationSeconds?: number }>(r.video_meta_json, {}).durationSeconds) || 0
      if (!duration) continue
      const from = r.posted_at_utc.slice(0, 10)
      const to = new Date(this.now()).toISOString().slice(0, 10)
      const data = await this.d.readRetention(r.account_id, r.external_id, from, to)
      const drop = steepestDrop(data.curve, duration)
      const ep = r.episode_ref ?? r.title
      const text = drop
        ? learningLine(r.brand_name, ep, drop)
        : `${r.brand_name} ${ep}: no sharp drop. Viewers stayed through the video${
            data.avgViewPercent !== null
              ? ` (average ${Math.round(data.avgViewPercent)} percent watched)`
              : ''
          }.`
      this.d.db
        .prepare(
          `INSERT OR IGNORE INTO learnings (brand_id, post_id, episode_ref, kind, text, data_json, created_at)
           VALUES (?, ?, ?, 'retention', ?, ?, ?)`,
        )
        .run(
          r.brand_id,
          r.post_id,
          r.episode_ref,
          text,
          JSON.stringify({ drop, avgViewPercent: data.avgViewPercent }),
          new Date(this.now()).toISOString(),
        )
      n++
    }
    if (n) this.writeLearningsFile()
    return n
  }

  /** The lessons as a plain file that a script writer reads first. */
  learningsMarkdown(): string {
    const rows = this.d.db
      .prepare(
        `SELECT l.text, l.created_at, b.name AS brand_name FROM learnings l LEFT JOIN brands b ON b.id = l.brand_id
         ORDER BY l.id DESC LIMIT 200`,
      )
      .all() as Array<{ text: string; created_at: string; brand_name: string | null }>
    const by = new Map<string, string[]>()
    for (const r of rows) {
      const key = r.brand_name ?? 'All channels'
      const list = by.get(key) ?? []
      if (list.length < 12) list.push(`- ${r.created_at.slice(0, 10)}: ${r.text}`)
      by.set(key, list)
    }
    const out = [
      '# What viewers watched',
      '',
      'Written by ELO from the audience curve of each YouTube video, 48 hours after it went live. Read it before you write the next episode and use it for pacing. Newest first.',
      '',
    ]
    for (const [name, lines] of by) out.push(`## ${name}`, '', ...lines, '')
    if (!by.size)
      out.push(
        'Nothing yet. The first lesson appears 48 hours after the first YouTube video goes live.',
        '',
      )
    return out.join('\n')
  }

  /** The lessons as rows. */
  lessons(): Array<{
    channel: string | null
    episode_id: string | null
    text: string
    at: string
  }> {
    const rows = this.d.db
      .prepare(
        `SELECT b.name AS channel, l.episode_ref, l.text, l.created_at FROM learnings l LEFT JOIN brands b ON b.id = l.brand_id
         ORDER BY l.id DESC LIMIT 50`,
      )
      .all() as Array<{
      channel: string | null
      episode_ref: string | null
      text: string
      created_at: string
    }>
    return rows.map((r) => ({
      channel: r.channel,
      episode_id: r.episode_ref,
      text: r.text,
      at: r.created_at,
    }))
  }

  private writeLearningsFile(): void {
    const dest = join(this.d.sharedDir(), 'learnings.md')
    mkdirSync(dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp`
    writeFileSync(tmp, this.learningsMarkdown())
    renameSync(tmp, dest)
  }

  // ---------------------------------------------------------------- thumbnail rescue

  /**
   * A video with a low click rate after 24 hours gets its next prepared thumbnail. After another 24 hours the new rate
   * is written to the log so the swap can be judged. One swap per video.
   */
  async thumbRescue(): Promise<number> {
    const threshold = this.d.settings.get().thumbRescueCtr / 100
    let n = 0
    for (const r of this.posted(this.now() - 5 * 24 * HOUR, 'youtube')) {
      if (r.account_id === null) continue
      const variants = json<string[]>(r.thumb_variants_json, [])
      const st = this.state(r)
      const ep = r.episode_ref ?? r.title
      if (st.rescue?.swappedAt) {
        if (st.rescue.followUp || this.now() - new Date(st.rescue.swappedAt).getTime() < 24 * HOUR)
          continue
        const after = await this.d.readCtr(
          r.account_id,
          r.external_id,
          st.rescue.swappedAt,
          new Date(this.now()).toISOString(),
        )
        this.setState(r.target_id, { rescue: { ...st.rescue, followUp: true, ctrAfter: after } })
        this.d.notify(
          `Thumbnail swap result: ${r.brand_name} ${ep}`,
          after === null
            ? 'YouTube has no click rate for the new thumbnail yet.'
            : `Click rate was ${((st.rescue.ctrBefore ?? 0) * 100).toFixed(1)} percent and is now ${(after * 100).toFixed(1)} percent.`,
        )
        continue
      }
      if (variants.length < 2 || this.ageHours(r) < 24) continue
      const ctr = await this.d.readCtr(
        r.account_id,
        r.external_id,
        r.posted_at_utc,
        new Date(this.now()).toISOString(),
      )
      if (ctr === null || ctr >= threshold) {
        if (ctr !== null)
          this.setState(r.target_id, {
            rescue: { checkedAt: new Date(this.now()).toISOString(), ctrBefore: ctr },
          })
        continue
      }
      const next = variants[1] as string
      await this.d.setThumbnail(r.account_id, r.external_id, this.d.resolve(next))
      this.setState(r.target_id, {
        rescue: { swappedAt: new Date(this.now()).toISOString(), ctrBefore: ctr, variant: 1 },
      })
      n++
      this.d.log.log(
        'info',
        `Thumbnail swapped on YouTube for ${ep} (click rate ${(ctr * 100).toFixed(1)} percent).`,
        {
          postId: r.post_id,
          platform: 'youtube',
        },
      )
      this.d.notify(
        `Thumbnail swapped: ${r.brand_name} ${ep}`,
        `The click rate was ${(ctr * 100).toFixed(1)} percent after 24 hours, under your ${(threshold * 100).toFixed(1)} percent line, so ELO put on thumbnail 2. It checks again in 24 hours.`,
      )
    }
    return n
  }

  // ---------------------------------------------------------------- viewer questions

  /** Real viewer questions on recent YouTube videos become idea cards in Upcoming. At most 3 new ones per channel per scan. */
  async fanQuestions(): Promise<number> {
    if (this.now() - this.lastFanScan < 6 * HOUR) return 0
    this.lastFanScan = this.now()
    let added = 0
    const perBrand = new Map<number, number>()
    for (const r of this.posted(this.now() - 14 * 24 * HOUR, 'youtube')) {
      if (r.account_id === null || !r.brand_slug) continue
      if ((perBrand.get(r.brand_id) ?? 0) >= 3) continue
      const comments = await this.d.youtube
        .listComments(r.account_id, r.external_id)
        .catch(() => [])
      for (const c of comments) {
        if ((perBrand.get(r.brand_id) ?? 0) >= 3) break
        if (!c.id || !isViewerQuestion(c.text)) continue
        const seen = this.d.db.prepare('SELECT 1 FROM fan_ideas WHERE comment_id = ?').get(c.id)
        if (seen) continue
        const question = c.text.replace(/\s+/g, ' ').trim()
        const id = await this.d
          .addIdea({
            channel: r.brand_slug,
            title: `Viewer question: ${question.slice(0, 80)}`,
            premise: `Open with the question from ${c.author || 'a viewer'}: "${question}" (from ${r.episode_ref ?? r.title}).`,
            extra: {
              community_request: true,
              question_author: c.author,
              question_comment_id: c.id,
              question_text: question,
            },
          })
          .catch(() => null)
        this.d.db
          .prepare(
            `INSERT OR IGNORE INTO fan_ideas (comment_id, brand_id, post_id, author, text, upcoming_episode_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            c.id,
            r.brand_id,
            r.post_id,
            c.author,
            question,
            id,
            new Date(this.now()).toISOString(),
          )
        if (id) {
          added++
          perBrand.set(r.brand_id, (perBrand.get(r.brand_id) ?? 0) + 1)
        }
      }
    }
    if (added)
      this.d.notify(
        'New ideas from viewers',
        `${added} viewer question${added === 1 ? '' : 's'} added to Upcoming as ideas.`,
      )
    return added
  }

  // ---------------------------------------------------------------- retract

  /**
   * Takes an episode down as far as the platforms allow. YouTube is set to private. Facebook, Instagram and TikTok have no
   * way for apps to hide a video, so those are listed with their links to take down by hand. Anything not posted yet is
   * stopped from posting.
   */
  async retract(
    episodeRef: string,
    who: string,
  ): Promise<{ postIds: number[]; results: RetractOutcome[] }> {
    const posts = this.d.db
      .prepare("SELECT id FROM posts WHERE episode_ref = ? AND status != 'canceled'")
      .all(episodeRef) as Array<{ id: number }>
    if (!posts.length) throw new Error(`No post for ${episodeRef}.`)
    const results: RetractOutcome[] = []
    for (const { id } of posts) {
      const targets = this.d.db
        .prepare(
          `SELECT t.id, t.platform, t.status, t.account_id, t.external_id, t.external_url, a.mode
           FROM post_targets t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ?`,
        )
        .all(id) as Array<{
        id: number
        platform: string
        status: string
        account_id: number | null
        external_id: string | null
        external_url: string | null
        mode: string | null
      }>
      for (const t of targets) {
        if (
          t.status === 'posted' ||
          t.status === 'handed_off' ||
          t.status === 'processing' ||
          t.status === 'needs_action'
        ) {
          if (
            t.platform === 'youtube' &&
            t.external_id &&
            t.account_id !== null &&
            t.mode !== 'dry_run'
          ) {
            try {
              await this.d.youtube.setPrivacy(t.account_id, t.external_id, 'private')
              results.push({
                platform: 'youtube',
                outcome: 'hidden',
                detail: 'Set to private.',
                url: t.external_url,
              })
            } catch (e) {
              results.push({
                platform: 'youtube',
                outcome: 'failed',
                detail: (e as Error).message,
                url: t.external_url,
              })
            }
          } else {
            results.push({
              platform: t.platform,
              outcome: 'manual',
              detail: `${platformName(t.platform)} does not let apps hide or delete a video. Take it down in the ${platformName(t.platform)} app.`,
              url: t.external_url,
            })
          }
        } else if (t.status === 'pending' || t.status === 'uploading') {
          this.d.db
            .prepare(
              "UPDATE post_targets SET status = 'skipped' WHERE id = ? AND status IN ('pending','uploading')",
            )
            .run(t.id)
          results.push({
            platform: t.platform,
            outcome: 'skipped',
            detail: 'Stopped before it posted.',
            url: null,
          })
        }
      }
    }
    this.d.log.log('warn', `Retract: ${episodeRef} taken down by ${who}.`, { postId: posts[0]?.id })
    return { postIds: posts.map((p) => p.id), results }
  }

  // ---------------------------------------------------------------- Monday brief

  private mondayOf(ms: number): string {
    return DateTime.fromMillis(ms, { zone: ZONE }).startOf('week').toISODate() as string
  }

  async briefIfDue(): Promise<boolean> {
    const s = this.d.settings.get()
    const now = DateTime.fromMillis(this.now(), { zone: ZONE })
    if (now.weekday !== 1) return false
    const [h, m] = s.briefTime.split(':').map(Number)
    if (now.hour < (h ?? 8) || (now.hour === (h ?? 8) && now.minute < (m ?? 0))) return false
    const monday = this.mondayOf(this.now())
    if (s.briefLastWeek === monday) return false
    await this.sendBrief()
    return true
  }

  /** The brief as text. */
  briefText(): string {
    const nowMs = this.now()
    const since = new Date(nowMs - 7 * 24 * HOUR).toISOString()
    const posted = this.d.db
      .prepare(
        `SELECT t.id AS target_id, t.platform, p.id AS post_id, p.title, p.episode_ref, b.name AS brand_name,
           (SELECT views FROM post_stats s WHERE s.post_target_id = t.id ORDER BY s.fetched_at_utc DESC LIMIT 1) AS views
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id
         WHERE t.status = 'posted' AND t.posted_at_utc >= ?`,
      )
      .all(since) as Array<{
      target_id: number
      platform: string
      post_id: number
      title: string
      episode_ref: string | null
      brand_name: string
      views: number | null
    }>
    const total = posted.reduce((a, r) => a + (r.views ?? 0), 0)
    const byBrand = new Map<string, { posts: Set<number>; views: number }>()
    for (const r of posted) {
      const b = byBrand.get(r.brand_name) ?? { posts: new Set<number>(), views: 0 }
      b.posts.add(r.post_id)
      b.views += r.views ?? 0
      byBrand.set(r.brand_name, b)
    }
    const perPost = new Map<
      number,
      { title: string; ep: string | null; brand: string; views: number }
    >()
    for (const r of posted) {
      const p = perPost.get(r.post_id) ?? {
        title: r.title,
        ep: r.episode_ref,
        brand: r.brand_name,
        views: 0,
      }
      p.views += r.views ?? 0
      perPost.set(r.post_id, p)
    }
    const champ = [...perPost.entries()].sort((a, b) => b[1].views - a[1].views)[0]
    const retention = champ
      ? (this.d.db
          .prepare(
            "SELECT avg_view_percent FROM video_retention WHERE post_id = ? AND platform = 'youtube'",
          )
          .get(champ[0]) as { avg_view_percent: number | null } | undefined)
      : undefined
    const failed = (
      this.d.db
        .prepare(
          "SELECT COUNT(*) AS n FROM post_targets WHERE status = 'failed' AND (posted_at_utc IS NULL OR posted_at_utc >= ?)",
        )
        .get(since) as { n: number }
    ).n
    const waiting = (
      this.d.db
        .prepare(
          "SELECT COUNT(*) AS n FROM posts WHERE origin = 'inbox' AND status = 'draft' AND hold_reason IS NULL",
        )
        .get() as { n: number }
    ).n
    const scheduled = (
      this.d.db
        .prepare(
          "SELECT COUNT(*) AS n FROM posts WHERE status = 'scheduled' AND scheduled_at_utc >= ? AND scheduled_at_utc < ?",
        )
        .get(new Date(nowMs).toISOString(), new Date(nowMs + 7 * 24 * HOUR).toISOString()) as {
        n: number
      }
    ).n
    const flags = (
      this.d.db
        .prepare('SELECT COUNT(*) AS n FROM velocity_checks WHERE flagged = 1 AND checked_at >= ?')
        .get(since) as { n: number }
    ).n
    const lessons = (
      this.d.db.prepare('SELECT COUNT(*) AS n FROM learnings WHERE created_at >= ?').get(since) as {
        n: number
      }
    ).n
    const up = this.d.upcomingCounts()
    const empty = this.d.emptySlotCount(7)
    const fmt = (n: number) => n.toLocaleString('en-US')
    const lines: string[] = [
      `# Studio brief, week of ${DateTime.fromMillis(nowMs, { zone: ZONE }).minus({ days: 7 }).toFormat('LLL d')}`,
      '',
      '## Reach',
      `- ${fmt(total)} views across ${perPost.size} post${perPost.size === 1 ? '' : 's'} that went out in the last 7 days (latest numbers ELO has).`,
      ...[...byBrand.entries()].map(
        ([n, b]) =>
          `- ${n}: ${b.posts.size} post${b.posts.size === 1 ? '' : 's'}, ${fmt(b.views)} views`,
      ),
      '- Subscriber counts are not collected by ELO, so growth is not shown here.',
      '',
      '## Champion',
      champ && champ[1].views > 0
        ? `- ${champ[1].brand}: "${champ[1].title}"${champ[1].ep ? ` (${champ[1].ep})` : ''} with ${fmt(champ[1].views)} views${
            retention?.avg_view_percent != null
              ? ` and ${Math.round(retention.avg_view_percent)} percent average watched`
              : ''
          }.`
        : '- No numbers yet.',
      '',
      '## Pipeline',
      `- Ideas ${up['idea'] ?? 0}, scripted ${up['scripted'] ?? 0}, queued ${up['queued'] ?? 0}, rendering ${up['rendering'] ?? 0}, needs review ${up['needs-review'] ?? 0}, Muse passed ${up['muse-passed'] ?? 0}`,
      `- ${waiting} finished video${waiting === 1 ? '' : 's'} waiting for a slot, ${scheduled} scheduled for the next 7 days, ${empty} empty slot${empty === 1 ? '' : 's'} in the next 7 days`,
      '',
      '## Watch list',
      `- Failed posts this week: ${failed}`,
      `- Slow starts flagged: ${flags}`,
      `- New lessons for the scripts: ${lessons}`,
    ]
    const best = this.d.bestTimeLines()
    if (best.length) lines.push('', '## Better times', ...best.map((b) => `- ${b}`))
    return lines.join('\n')
  }

  async sendBrief(): Promise<string> {
    const text = this.briefText()
    const day = this.mondayOf(this.now())
    const file = join(this.d.sharedDir(), 'Briefs', `brief-${day}.md`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text + '\n')
    this.d.settings.set({ briefLastWeek: day })
    await this.d.send(text.replace(/^#+ /gm, ''))
    return file
  }
}

function platformName(p: string): string {
  return p === 'youtube'
    ? 'YouTube'
    : p === 'facebook'
      ? 'Facebook'
      : p === 'instagram'
        ? 'Instagram'
        : 'TikTok'
}
