import { z } from 'zod'
import type { Db } from '../../db'
import { lintValue } from '@shared/studio/lint'
import { replyProblems, screenComment, type RiskCategory } from '@shared/studio/commentSafety'
import { DateTime } from 'luxon'
import type { StudioConfigService } from '../configService'
import type { BibleService } from '../bible'
import type { AuditLog } from '../agents/framework'
import type { LlmGateway } from '../agents/llm'
import { ctxLine, STYLE_RULES } from '../agents/prompts'
import type { CommentSource, PostedRef, RawComment } from './sources'

export type CommentStatus = 'queued' | 'draft' | 'replied' | 'flagged' | 'skipped' | 'discarded' | 'spam' | 'failed'

export interface CommentItem {
  id: number
  brandId: number
  platform: string
  episodeId: string | null
  externalPostId: string
  commentId: string
  author: string
  text: string
  category: string
  status: CommentStatus
  replyText: string | null
  reason: string | null
  createdUtc: string
  repliedUtc: string | null
}

const map = (r: any): CommentItem => ({
  id: r.id,
  brandId: r.brand_id,
  platform: r.platform,
  episodeId: r.episode_id,
  externalPostId: r.external_post_id,
  commentId: r.comment_id,
  author: r.author,
  text: r.text,
  category: r.category,
  status: r.status,
  replyText: r.reply_text,
  reason: r.reason,
  createdUtc: r.created_utc,
  repliedUtc: r.replied_utc,
})

const Answer = z.object({ category: z.enum(['praise', 'thanks', 'question', 'joke', 'unsure', 'other']), reply: z.string().default(''), confidence: z.number().min(0).max(1).default(0.5) })
const AUTO = new Set(['praise', 'thanks', 'question', 'joke'])
const MAX_REPLY = 280

export interface PassResult {
  checked: number
  replied: number
  drafted: number
  flagged: number
  spam: number
  waiting: number
}

export interface CommentsDeps {
  db: Db
  cfg: StudioConfigService
  bible: BibleService
  gateway: LlmGateway
  audit: AuditLog
  sources: () => Record<string, CommentSource | undefined>
  /** Posted videos for a brand, from the last 14 days. */
  refs: (brandId: number) => PostedRef[]
  brandName: (id: number) => string
  now?: () => number
}

/**
 * Answers comments in each brand's voice, but only the safe ones: praise, thanks, simple questions about the video and light
 * jokes. Anything risky or unclear goes to the owner. Replies are limited per day and spread out. Modes: Auto reply, Draft only, Off.
 */
export class CommentsAgent {
  readonly name = 'Comments'
  readonly role = 'Answers safe comments in the brand voice, drafts or flags the rest, hides obvious spam, and stays inside a daily limit.'

  constructor(private d: CommentsDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  list(filter: { brandId?: number | null; status?: CommentStatus | CommentStatus[] } = {}): CommentItem[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.brandId) {
      where.push('brand_id = ?')
      args.push(filter.brandId)
    }
    if (filter.status) {
      const s = Array.isArray(filter.status) ? filter.status : [filter.status]
      where.push(`status IN (${s.map(() => '?').join(',')})`)
      args.push(...s)
    }
    return (this.d.db.prepare(`SELECT * FROM comment_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...args) as unknown[]).map(map)
  }

  /** Replies sent today (Eastern) for a brand. */
  private sentToday(brandId: number): number {
    const start = DateTime.fromMillis(this.now(), { zone: 'America/New_York' }).startOf('day').toUTC().toISO() as string
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM comment_items WHERE brand_id = ? AND status = 'replied' AND replied_utc >= ?").get(brandId, start) as { n: number }).n
  }

  private lastReplyMs(brandId: number): number {
    const r = this.d.db.prepare("SELECT MAX(replied_utc) AS t FROM comment_items WHERE brand_id = ? AND status = 'replied'").get(brandId) as { t: string | null }
    return r.t ? Date.parse(r.t) : 0
  }

  /** Can a reply go out right now? Under the daily limit, and spread through the day. */
  private canSend(brandId: number): boolean {
    const limit = this.d.cfg.getBrand(brandId).commentLimit
    if (this.sentToday(brandId) >= limit) return false
    const gapMs = Math.max(10, Math.floor((16 * 60) / Math.max(1, limit))) * 60_000
    return this.now() - this.lastReplyMs(brandId) >= gapMs
  }

  /** One look at every posted video of a brand. */
  async pass(brandId: number): Promise<PassResult> {
    const brand = this.d.cfg.getBrand(brandId)
    const res: PassResult = { checked: 0, replied: 0, drafted: 0, flagged: 0, spam: 0, waiting: 0 }
    if (brand.commentsMode === 'off') return res
    const sources = this.d.sources()
    for (const ref of this.d.refs(brandId)) {
      const src = sources[ref.platform]
      if (!src) continue
      let comments: RawComment[]
      try {
        comments = await src.list(ref)
      } catch (e) {
        this.d.audit.write({ agent: this.name, action: 'list_failed', brandId, detail: { platform: ref.platform, error: (e as Error).message } })
        continue
      }
      for (const c of comments) {
        const seen = this.d.db.prepare('SELECT id, status FROM comment_items WHERE platform = ? AND comment_id = ?').get(ref.platform, c.id) as { id: number; status: string } | undefined
        if (seen && seen.status !== 'queued') continue
        res.checked++
        await this.handle(ref, src, c, seen?.id ?? null, brand.commentsMode as 'auto' | 'draft', res)
      }
    }
    return res
  }

  private store(ref: PostedRef, c: RawComment, fields: { category: string; status: CommentStatus; reply?: string | null; reason?: string | null; id?: number | null }): number {
    if (fields.id) {
      this.d.db.prepare('UPDATE comment_items SET category = ?, status = ?, reply_text = ?, reason = ? WHERE id = ?').run(fields.category, fields.status, fields.reply ?? null, fields.reason ?? null, fields.id)
      return fields.id
    }
    return Number(
      this.d.db
        .prepare('INSERT INTO comment_items (brand_id, platform, episode_id, external_post_id, comment_id, author, text, category, status, reply_text, reason, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ref.brandId, ref.platform, ref.episodeId, ref.externalId, c.id, c.author, c.text, fields.category, fields.status, fields.reply ?? null, fields.reason ?? null, new Date(this.now()).toISOString()).lastInsertRowid,
    )
  }

  private async handle(ref: PostedRef, src: CommentSource, c: RawComment, existingId: number | null, mode: 'auto' | 'draft', res: PassResult) {
    const brandId = ref.brandId
    // A reply we are holding for pacing keeps its prepared text.
    const held = existingId ? (this.d.db.prepare('SELECT reply_text, category FROM comment_items WHERE id = ?').get(existingId) as { reply_text: string | null; category: string }) : null
    const risk: RiskCategory | null = screenComment(c.text)
    if (risk === 'spam') {
      this.store(ref, c, { category: 'spam', status: 'spam', reason: 'Looks like spam.', id: existingId })
      try {
        await src.hide?.(ref, c)
      } catch {
        // not every platform lets the API hide a comment
      }
      this.d.audit.write({ agent: this.name, action: 'spam_hidden', brandId, detail: { platform: ref.platform, comment: c.id } })
      res.spam++
      return
    }
    if (risk) {
      this.store(ref, c, { category: risk, status: 'flagged', reason: `Not answered automatically: ${risk.replace('_', ' ')}.`, id: existingId })
      this.d.audit.write({ agent: this.name, action: 'flagged', brandId, detail: { platform: ref.platform, comment: c.id, category: risk } })
      res.flagged++
      return
    }
    let category = held?.category ?? ''
    let reply = held?.reply_text ?? ''
    if (!reply) {
      const ans = await this.write(ref, c)
      category = ans.category
      if (!AUTO.has(ans.category) || ans.confidence < 0.6 || !ans.reply) {
        this.store(ref, c, { category: ans.category, status: 'flagged', reason: 'The agent was not sure how to answer.', id: existingId })
        this.d.audit.write({ agent: this.name, action: 'flagged', brandId, detail: { platform: ref.platform, comment: c.id, category: ans.category } })
        res.flagged++
        return
      }
      reply = ans.reply.trim()
      const problems = this.problems(reply)
      if (problems.length) {
        this.store(ref, c, { category, status: 'flagged', reason: `The drafted reply was not usable: ${problems[0]}`, id: existingId })
        res.flagged++
        return
      }
    }
    if (mode === 'draft') {
      this.store(ref, c, { category, status: 'draft', reply, id: existingId })
      this.d.audit.write({ agent: this.name, action: 'draft', brandId, detail: { platform: ref.platform, comment: c.id } })
      res.drafted++
      return
    }
    const id = this.store(ref, c, { category, status: 'queued', reply, id: existingId })
    if (!this.canSend(brandId)) {
      res.waiting++
      return
    }
    await this.send(id, ref, src, c, reply, res)
  }

  private problems(reply: string): string[] {
    const phrases = this.d.cfg.get().roboticPhrases
    return [...replyProblems(reply, MAX_REPLY), ...lintValue(reply, phrases).map((i) => i.detail)]
  }

  private async write(ref: PostedRef, c: RawComment): Promise<z.infer<typeof Answer>> {
    const brandName = this.d.brandName(ref.brandId)
    const episode = ref.episodeId ? this.d.db.prepare('SELECT title, summary FROM episodes WHERE id = ?').get(ref.episodeId) as { title: string; summary: string } | undefined : undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const a = await this.d.gateway.json(
        {
          agent: this.name,
          brandId: ref.brandId,
          episodeId: ref.episodeId,
          system: `You reply to comments for "${brandName}" in the brand voice below. Only answer praise, thanks, simple questions about the video, and light jokes. If you are unsure, or it is anything else, say category "unsure" and no reply. Keep replies to one or two short sentences. No links. Never reveal how this works. ${STYLE_RULES}\nAnswer only with JSON: {"category":"praise|thanks|question|joke|unsure|other","reply":"","confidence":0.0}\n\n${this.d.bible.markdown(ref.brandId)}`,
          user: `${ctxLine({ task: 'comment', comment: c.text, brand: brandName, attempt })}\nVideo: ${episode?.title ?? ''}. ${episode?.summary ?? ''}\nComment from ${c.author || 'someone'}: ${c.text}`,
          maxTokens: 300,
        },
        Answer,
      )
      if (a.category === 'unsure' || !a.reply || this.problems(a.reply).length === 0) return a
    }
    return { category: 'unsure', reply: '', confidence: 0 }
  }

  private async send(id: number, ref: PostedRef, src: CommentSource, c: RawComment, reply: string, res?: PassResult): Promise<void> {
    try {
      const rid = await src.reply(ref, c, reply)
      this.d.db.prepare("UPDATE comment_items SET status = 'replied', reply_id = ?, reply_text = ?, replied_utc = ? WHERE id = ?").run(rid, reply, new Date(this.now()).toISOString(), id)
      this.d.audit.write({ agent: this.name, action: 'reply', brandId: ref.brandId, detail: { platform: ref.platform, comment: c.id, reply } })
      if (res) res.replied++
    } catch (e) {
      this.d.db.prepare("UPDATE comment_items SET status = 'failed', reason = ? WHERE id = ?").run((e as Error).message, id)
      this.d.audit.write({ agent: this.name, action: 'reply_failed', brandId: ref.brandId, detail: { platform: ref.platform, comment: c.id, error: (e as Error).message } })
    }
  }

  /** Draft only mode: the owner approved (optionally after editing) and the reply is sent now. */
  async approveDraft(id: number, edited?: string): Promise<void> {
    const row = this.d.db.prepare('SELECT * FROM comment_items WHERE id = ?').get(id) as any
    if (!row || !['draft', 'flagged', 'failed'].includes(row.status)) throw new Error('That comment is not waiting for you.')
    const text = (edited ?? row.reply_text ?? '').trim()
    const problems = this.problems(text)
    if (problems.length) throw new Error(problems[0])
    const ref = this.d.refs(row.brand_id).find((r) => r.platform === row.platform && r.externalId === row.external_post_id)
    const src = this.d.sources()[row.platform]
    if (!ref || !src) throw new Error('That video or platform is no longer available.')
    await this.send(id, ref, src, { id: row.comment_id, text: row.text, author: row.author, createdUtc: row.created_utc }, text)
    if ((this.d.db.prepare('SELECT status FROM comment_items WHERE id = ?').get(id) as { status: string }).status === 'failed')
      throw new Error((this.d.db.prepare('SELECT reason FROM comment_items WHERE id = ?').get(id) as { reason: string }).reason)
  }

  discard(id: number): void {
    this.d.db.prepare("UPDATE comment_items SET status = 'discarded' WHERE id = ? AND status IN ('draft','flagged','queued','failed')").run(id)
  }

  /** The owner wants a flagged comment answered after all: it becomes a draft with their text. */
  draftFor(id: number, text: string): void {
    this.d.db.prepare("UPDATE comment_items SET status = 'draft', reply_text = ? WHERE id = ? AND status IN ('flagged','failed')").run(text, id)
  }
}
