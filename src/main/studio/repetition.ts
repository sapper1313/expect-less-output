import { z } from 'zod'
import type { Db } from '../db'
import type { StudioConfigService } from './configService'
import type { LlmGateway } from './agents/llm'
import { ctxLine } from './agents/prompts'
import type { LocalAi, Via } from './localAi'

export interface Candidate {
  title: string
  idea: string
  hook?: string
  summary: string
  keyLines: string[]
}

export interface RepetitionResult {
  ok: boolean
  similarTo?: string
  reason?: string
  via: Via | 'keyword+agent'
  score: number
  /** The candidate's embedding, to store with the episode. Null when the embedding model was unreachable. */
  embedding: number[] | null
  /** The lowercase text kept in the episode index. */
  keyText: string
}

const STOP = new Set(
  'a an and are as at be by for from has have he her his i if in into is it its of on or our she so that the their them then there they this to was we were what when where which who will with you your about just not but can do does how more most one out up very'.split(
    ' ',
  ),
)

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function tokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  )
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const KEYWORD_LIMIT = 0.6

const AgentAnswer = z.object({
  similar: z.boolean(),
  to: z.string().optional(),
  reason: z.string().default(''),
})

/**
 * Before a script is accepted it is compared with every earlier episode of the brand: embeddings from the local
 * model plus a keyword check. If the local model is unreachable the keyword check plus a text agent comparison
 * against recent summaries is used instead.
 */
export class RepetitionGuard {
  constructor(
    private d: { db: Db; cfg: StudioConfigService; localAi: LocalAi; gateway: LlmGateway },
  ) {}

  keyTextOf(c: Candidate): string {
    return normalize([c.title, c.hook ?? '', c.idea, ...c.keyLines].join(' '))
  }

  async check(
    brandId: number,
    c: Candidate,
    ctx: { episodeId?: string; taskId?: number } = {},
  ): Promise<RepetitionResult> {
    const rows = this.d.db
      .prepare(
        "SELECT id, title, summary, key_text, embedding_json FROM episodes WHERE brand_id = ? AND status NOT IN ('Failed') AND id != ? ORDER BY created_utc DESC",
      )
      .all(brandId, ctx.episodeId ?? '') as Array<{
      id: string
      title: string
      summary: string
      key_text: string
      embedding_json: string | null
    }>
    const keyText = this.keyTextOf(c)
    const candTokens = tokens(keyText)
    const done = (r: Partial<RepetitionResult>): RepetitionResult => ({
      ok: true,
      via: 'keyword',
      score: 0,
      embedding: null,
      keyText,
      ...r,
    })

    // 1. exact title and keyword overlap
    let best = { id: '', score: 0 }
    for (const r of rows) {
      if (normalize(r.title) === normalize(c.title) && r.title)
        return done({
          ok: false,
          similarTo: r.id,
          reason: `Too similar to episode ${r.id}: the title is the same.`,
          score: 1,
        })
      const sc = jaccard(candTokens, tokens(r.key_text || `${r.title} ${r.summary}`))
      if (sc > best.score) best = { id: r.id, score: sc }
    }
    if (best.score >= KEYWORD_LIMIT)
      return done({
        ok: false,
        similarTo: best.id,
        reason: `Too similar to episode ${best.id}: about the same words and topic.`,
        score: best.score,
      })
    if (c.keyLines.length) {
      const mine = new Set(c.keyLines.map(normalize).filter((l) => l.length > 12))
      for (const r of rows)
        for (const l of mine)
          if (r.key_text.includes(l))
            return done({
              ok: false,
              similarTo: r.id,
              reason: `Too similar to episode ${r.id}: it reuses the line "${l.slice(0, 40)}".`,
              score: 0.9,
            })
    }

    // 2. embeddings (local model)
    const threshold = this.d.cfg.get().repetitionThreshold
    const texts = [`${c.title}. ${c.idea}. ${c.summary}`]
    const missing = rows.filter((r) => !r.embedding_json).slice(0, 40)
    const embedded = await this.d.localAi.embed([
      ...texts,
      ...missing.map((r) => `${r.title}. ${r.summary}`),
    ])
    if (embedded.vectors) {
      const [mine, ...rest] = embedded.vectors
      const insert = this.d.db.prepare('UPDATE episodes SET embedding_json = ? WHERE id = ?')
      missing.forEach((r, i) => {
        r.embedding_json = JSON.stringify(rest[i])
        insert.run(r.embedding_json, r.id)
      })
      let top = { id: '', score: 0 }
      for (const r of rows) {
        if (!r.embedding_json) continue
        const sc = cosine(mine, JSON.parse(r.embedding_json) as number[])
        if (sc > top.score) top = { id: r.id, score: sc }
      }
      if (top.score >= threshold)
        return done({
          ok: false,
          similarTo: top.id,
          reason: `Too similar to episode ${top.id} (meaning matches ${Math.round(top.score * 100)} percent).`,
          via: 'ollama',
          score: top.score,
          embedding: mine,
        })
      return done({ via: 'ollama', score: Math.max(top.score, best.score), embedding: mine })
    }

    // 3. no local model: ask a text agent to compare with recent summaries
    const recent = rows.slice(0, 15)
    if (!recent.length) return done({ via: 'keyword' })
    const ans = await this.d.gateway.json(
      {
        agent: 'Repetition Guard',
        brandId,
        episodeId: ctx.episodeId,
        taskId: ctx.taskId,
        system:
          'You compare a new episode idea with earlier episodes of the same show and say whether it repeats one. Answer only with JSON: {"similar": boolean, "to": "episode id or empty", "reason": "short reason"}.',
        user: `${ctxLine({ task: 'repetition', title: c.title })}\nNew idea: ${c.title}. ${c.idea}. ${c.summary}\nEarlier episodes:\n${recent.map((r) => `${r.id}: ${r.title}. ${r.summary}`).join('\n')}`,
        maxTokens: 2500,
      },
      AgentAnswer,
    )
    if (ans.similar)
      return done({
        ok: false,
        similarTo: ans.to || recent[0].id,
        reason: `Too similar to episode ${ans.to || recent[0].id}: ${ans.reason}`,
        via: 'keyword+agent',
        score: best.score,
      })
    return done({ via: 'keyword+agent', score: best.score })
  }
}
