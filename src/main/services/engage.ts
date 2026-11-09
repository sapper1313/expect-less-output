import type { Db } from '../db'
import type { ActivityLog } from './activity'
import type { UploadPostService } from './uploadPost'
import { uploadPostOn } from './uploadPost'
import { UploadPostError, type UploadPostClient } from '../uploadpost/client'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import type { Platform } from '@shared/types'
import type {
  CommentFilter,
  CommentStatus,
  CommentSyncResult,
  DmChannel,
  DmConversation,
  InboxComment,
} from '@shared/engage'

const DAY = 86_400_000
/** Platforms Upload-Post can list comments for. */
const CAN_LIST = ['instagram', 'facebook', 'youtube', 'linkedin', 'tiktok']
const MAX_PER_RUN = 12
const GAP_MS = 700

type Client = Pick<UploadPostClient, 'listComments' | 'createComment' | 'dmConversations' | 'sendDm'>

export interface EngageDeps {
  db: Db
  uploadPost: UploadPostService
  client: Client
  log: ActivityLog
  emit?: () => void
  now?: () => number
  /** Asks the local AI for reply ideas. Throws a plain message when it is not set up. */
  suggest?: (ctx: { kind: 'comment' | 'dm'; brand: string; video: string; text: string }) => Promise<string[]>
  sleep?: (ms: number) => Promise<void>
}

/** How to point Upload-Post at one posted video. Null when ELO does not have what it needs. */
export function commentRef(
  platform: string,
  externalId: string | null,
  externalUrl: string | null,
): { postId?: string; postUrl?: string } | null {
  if (platform === 'tiktok') {
    const id = externalId && /^\d+$/.test(externalId) ? externalId : externalUrl?.match(/\/video\/(\d+)/)?.[1]
    return id ? { postId: id } : null
  }
  if (platform === 'facebook') {
    if (externalUrl) return { postUrl: externalUrl }
    return externalId ? { postId: externalId } : null
  }
  return externalId ? { postId: externalId } : null
}

/** Turns an Upload-Post problem into a sentence a person can act on. */
export function explainProblem(err: unknown, label: string): string {
  const e = err as UploadPostError
  if (e.code === 'tiktok_reconnect_required')
    return 'TikTok only gives comment permission when the account is connected. Disconnect TikTok on Upload-Post, connect it again, then try again.'
  if (e.status === 403)
    return `Upload-Post says the ${label} login does not have permission for comments. Reconnect ${label} on their site, then try again.`
  if (e.status === 401) return 'Upload-Post does not accept the key. Copy it again in AI Settings.'
  if (e.status === 429) return `${label} says to slow down. Try again in a little while.`
  return e.message || 'Something went wrong.'
}

/** Reads comments and Instagram messages through Upload-Post, and sends replies. Nothing is sent without a click. */
export class EngageService {
  private running = false
  private dmCache = new Map<number, { at: number; channel: DmChannel }>()
  constructor(private d: EngageDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  // ---------------------------------------------------------------- comments

  /** Checks recent posted videos for new comments. Newer videos are checked more often than old ones. */
  async sync(opts: { force?: boolean } = {}): Promise<CommentSyncResult> {
    const result: CommentSyncResult = { checked: 0, added: 0, problems: [] }
    if (this.running) return result
    const key = this.d.uploadPost.apiKey()
    if (!key) return result
    this.running = true
    try {
      const now = this.now()
      const rows = this.d.db
        .prepare(
          `SELECT t.id AS target_id, t.post_id, t.platform, t.external_id, t.external_url, t.posted_at_utc,
                  p.brand_id, p.title, p.first_comment, t.settings_json, s.last_at_utc
           FROM post_targets t JOIN posts p ON p.id = t.post_id
           LEFT JOIN inbox_sync s ON s.target_id = t.id
           WHERE t.status = 'posted' AND t.platform IN (${CAN_LIST.map(() => '?').join(',')})
             AND t.posted_at_utc >= ?`,
        )
        .all(...CAN_LIST, new Date(now - 30 * DAY).toISOString()) as Array<{
        target_id: number
        post_id: number
        platform: string
        external_id: string | null
        external_url: string | null
        posted_at_utc: string
        brand_id: number
        title: string
        first_comment: string | null
        settings_json: string | null
        last_at_utc: string | null
      }>
      const due = rows
        .filter((r) => uploadPostOn(this.d.db, r.brand_id, r.platform) && this.d.uploadPost.profileFor(r.brand_id))
        .filter((r) => {
          if (opts.force || !r.last_at_utc) return true
          const age = now - Date.parse(r.posted_at_utc)
          const every = age < 2 * DAY ? 15 * 60_000 : age < 7 * DAY ? 60 * 60_000 : 6 * 3_600_000
          return now - Date.parse(r.last_at_utc) >= every
        })
        .sort((a, b) => (a.last_at_utc ?? '').localeCompare(b.last_at_utc ?? ''))
        .slice(0, MAX_PER_RUN)
      for (const r of due) {
        const label = PLATFORM_LABELS[r.platform as Platform] ?? r.platform
        const ref = commentRef(r.platform, r.external_id, r.external_url)
        const mark = this.d.db.prepare(
          'INSERT INTO inbox_sync (target_id, last_at_utc, last_error) VALUES (?, ?, ?) ON CONFLICT(target_id) DO UPDATE SET last_at_utc = excluded.last_at_utc, last_error = excluded.last_error',
        )
        if (!ref) {
          mark.run(r.target_id, new Date(now).toISOString(), 'No video id or link.')
          continue
        }
        result.checked++
        try {
          const list = await this.d.client.listComments(key, {
            platform: r.platform,
            user: this.d.uploadPost.profileFor(r.brand_id),
            ...ref,
          })
          let own = ''
          try {
            own = String((JSON.parse(r.settings_json ?? '{}') as { firstComment?: string }).firstComment ?? '')
          } catch {
            own = ''
          }
          const mine = (own.trim() || r.first_comment || '').trim()
          const ins = this.d.db.prepare(
            `INSERT OR IGNORE INTO inbox_comments
               (brand_id, post_id, target_id, platform, comment_id, author, author_id, text, commented_at_utc, status, fetched_at_utc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          for (const c of list) {
            const status: CommentStatus = mine && c.text.trim() === mine ? 'mine' : 'new'
            const info = ins.run(
              r.brand_id, r.post_id, r.target_id, r.platform, c.id, c.username, c.userId, c.text, c.at, status,
              new Date(now).toISOString(),
            )
            if (info.changes) result.added++
          }
          mark.run(r.target_id, new Date(now).toISOString(), null)
        } catch (err) {
          const why = explainProblem(err, label)
          mark.run(r.target_id, new Date(now).toISOString(), why)
          const text = `${label}: ${why}`
          if (!result.problems.includes(text)) result.problems.push(text)
        }
        await (this.d.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms))))(GAP_MS)
      }
      if (result.added) {
        this.d.log.log('info', `${result.added} new comment${result.added === 1 ? '' : 's'} found.`)
        this.d.emit?.()
      }
      return result
    } finally {
      this.running = false
    }
  }

  list(filter: CommentFilter = {}): InboxComment[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.brandId) {
      where.push('c.brand_id = ?')
      args.push(filter.brandId)
    }
    if (filter.platform) {
      where.push('c.platform = ?')
      args.push(filter.platform)
    }
    where.push('b.archived = 0')
    if ((filter.show ?? 'open') === 'open') where.push("c.status = 'new'")
    else where.push("c.status != 'mine'")
    const rows = this.d.db
      .prepare(
        `SELECT c.*, b.name AS brand_name, b.color AS brand_color, COALESCE(p.title, '') AS post_title
         FROM inbox_comments c JOIN brands b ON b.id = c.brand_id LEFT JOIN posts p ON p.id = c.post_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY COALESCE(c.commented_at_utc, c.fetched_at_utc) DESC, c.id DESC LIMIT 500`,
      )
      .all(...args) as any[]
    return rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      brandColor: r.brand_color,
      platform: r.platform,
      postId: r.post_id,
      postTitle: r.post_title,
      commentId: r.comment_id,
      author: r.author,
      text: r.text,
      atUtc: r.commented_at_utc,
      status: r.status,
      replyText: r.reply_text,
      repliedAtUtc: r.replied_at_utc,
    }))
  }

  /** How many comments are waiting for a reply. */
  newCount(): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM inbox_comments c JOIN brands b ON b.id = c.brand_id WHERE c.status = 'new' AND b.archived = 0").get() as { n: number }).n
  }

  setStatus(id: number, status: 'new' | 'done'): void {
    this.d.db.prepare("UPDATE inbox_comments SET status = ? WHERE id = ? AND status != 'mine'").run(status, id)
    this.d.emit?.()
  }

  private row(id: number) {
    const r = this.d.db
      .prepare(
        `SELECT c.*, b.name AS brand_name, COALESCE(p.title, '') AS post_title, t.external_id, t.external_url
         FROM inbox_comments c JOIN brands b ON b.id = c.brand_id
         LEFT JOIN posts p ON p.id = c.post_id LEFT JOIN post_targets t ON t.id = c.target_id WHERE c.id = ?`,
      )
      .get(id) as any
    if (!r) throw new Error('That comment was not found.')
    return r
  }

  async reply(id: number, text: string): Promise<void> {
    const msg = text.trim()
    if (!msg) throw new Error('Type the reply first.')
    const r = this.row(id)
    const key = this.d.uploadPost.apiKey()
    if (!key) throw new Error('The Upload-Post key is missing. Add it in AI Settings.')
    const label = PLATFORM_LABELS[r.platform as Platform] ?? r.platform
    try {
      await this.d.client.createComment(key, {
        platform: r.platform,
        user: this.d.uploadPost.profileFor(r.brand_id),
        message: msg,
        commentId: r.comment_id,
        // TikTok wants the video too.
        postId: r.platform === 'tiktok' ? commentRef('tiktok', r.external_id, r.external_url)?.postId : undefined,
      })
    } catch (err) {
      throw new Error(explainProblem(err, label), { cause: err })
    }
    this.d.db
      .prepare("UPDATE inbox_comments SET status = 'replied', reply_text = ?, replied_at_utc = ? WHERE id = ?")
      .run(msg, new Date(this.now()).toISOString(), id)
    this.d.log.log('info', `Replied to a ${label} comment on "${r.post_title}".`, { postId: r.post_id ?? undefined, platform: r.platform as Platform })
    this.d.emit?.()
  }

  async draft(id: number): Promise<string[]> {
    if (!this.d.suggest) throw new Error('Turn on the local AI in AI Settings first.')
    const r = this.row(id)
    return this.d.suggest({ kind: 'comment', brand: r.brand_name, video: r.post_title, text: r.text })
  }

  // ---------------------------------------------------------------- Instagram messages

  /** Instagram conversations for every channel that has Instagram ticked on the Upload-Post card. */
  async dms(force = false): Promise<DmChannel[]> {
    const key = this.d.uploadPost.apiKey()
    const brands = this.d.db.prepare('SELECT id, name FROM brands WHERE archived = 0 ORDER BY id').all() as Array<{ id: number; name: string }>
    const out: DmChannel[] = []
    for (const b of brands) {
      if (!uploadPostOn(this.d.db, b.id, 'instagram')) continue
      const user = this.d.uploadPost.profileFor(b.id)
      if (!key || !user) {
        out.push({ brandId: b.id, brandName: b.name, conversations: [], problem: 'The Upload-Post key or profile name is missing.' })
        continue
      }
      const cached = this.dmCache.get(b.id)
      if (!force && cached && this.now() - cached.at < 60_000) {
        out.push(cached.channel)
        continue
      }
      let channel: DmChannel
      try {
        const raw = await this.d.client.dmConversations(key, user)
        channel = { brandId: b.id, brandName: b.name, conversations: this.normalizeDms(b.id, raw), problem: null }
      } catch (err) {
        channel = { brandId: b.id, brandName: b.name, conversations: [], problem: explainProblem(err, 'Instagram') }
      }
      this.dmCache.set(b.id, { at: this.now(), channel })
      out.push(channel)
    }
    return out
  }

  private normalizeDms(brandId: number, raw: any[]): DmConversation[] {
    const acct = this.d.db
      .prepare("SELECT display_name FROM accounts WHERE brand_id = ? AND platform = 'instagram'")
      .get(brandId) as { display_name: string | null } | undefined
    const handle = (acct?.display_name ?? '').replace(/^@/, '').toLowerCase()
    const people = raw.map((c) => (c.participants?.data ?? []) as Array<{ id: string; username?: string }>)
    // Our own id is the participant named like the Instagram account, or the one in every conversation.
    let ourId = people.flat().find((p) => handle && (p.username ?? '').toLowerCase() === handle)?.id ?? null
    if (!ourId && raw.length > 1) {
      const counts = new Map<string, number>()
      for (const list of people) for (const p of list) counts.set(p.id, (counts.get(p.id) ?? 0) + 1)
      ourId = [...counts.entries()].find(([, n]) => n === raw.length)?.[0] ?? null
    }
    const now = this.now()
    return raw
      .map((c, i): DmConversation | null => {
        const other = people[i]!.find((p) => p.id !== ourId) ?? people[i]![0]
        if (!other) return null
        const messages = ((c.messages?.data ?? []) as any[])
          .map((m) => ({
            id: String(m.id),
            atUtc: String(m.created_time ?? ''),
            fromName: String(m.from?.username ?? ''),
            mine: !!ourId && m.from?.id === ourId,
            text: String(m.message ?? ''),
          }))
          .sort((a, b) => a.atUtc.localeCompare(b.atUtc))
        const theirLast = [...messages].reverse().find((m) => !m.mine)
        return {
          id: String(c.id),
          withName: other.username ?? other.id,
          withId: other.id,
          lastAtUtc: messages[messages.length - 1]?.atUtc ?? '',
          messages,
          canReply: !!theirLast && now - Date.parse(theirLast.atUtc) < DAY,
        }
      })
      .filter((x): x is DmConversation => !!x)
      .sort((a, b) => b.lastAtUtc.localeCompare(a.lastAtUtc))
  }

  async dmSend(brandId: number, recipientId: string, text: string): Promise<void> {
    const msg = text.trim()
    if (!msg) throw new Error('Type the message first.')
    const key = this.d.uploadPost.apiKey()
    if (!key) throw new Error('The Upload-Post key is missing. Add it in AI Settings.')
    const channel = this.dmCache.get(brandId)?.channel
    const convo = channel?.conversations.find((c) => c.withId === recipientId)
    if (convo && !convo.canReply)
      throw new Error('Instagram only allows a reply within 24 hours of their last message. That time has passed.')
    try {
      await this.d.client.sendDm(key, { user: this.d.uploadPost.profileFor(brandId), recipientId, message: msg })
    } catch (err) {
      throw new Error(explainProblem(err, 'Instagram'), { cause: err })
    }
    this.dmCache.delete(brandId)
    this.d.log.log('info', 'Sent an Instagram message.')
    this.d.emit?.()
  }

  async dmDraft(brandId: number, recipientId: string): Promise<string[]> {
    if (!this.d.suggest) throw new Error('Turn on the local AI in AI Settings first.')
    const channel = this.dmCache.get(brandId)?.channel
    const convo = channel?.conversations.find((c) => c.withId === recipientId)
    const last = [...(convo?.messages ?? [])].reverse().find((m) => !m.mine)
    if (!last) throw new Error('There is no message to answer.')
    return this.d.suggest({ kind: 'dm', brand: channel?.brandName ?? '', video: '', text: last.text })
  }
}
