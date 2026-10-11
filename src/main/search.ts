import type { Db } from './db'
import { PAGES, type SearchHit } from '@shared/search'

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`
const snip = (text: string, q: string, span = 70) => {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text.slice(0, span * 2)
  const a = Math.max(0, i - span)
  return (
    (a > 0 ? '...' : '') +
    text.slice(a, i + q.length + span).replace(/\s+/g, ' ') +
    (i + q.length + span < text.length ? '...' : '')
  )
}

/** One search box over everything: episodes, posts, ideas, comments, bibles, the log and the pages of the app. */
export function searchAll(db: Db, raw: string): SearchHit[] {
  const q = raw.trim()
  if (q.length < 2) return []
  const l = like(q)
  const out: SearchHit[] = []

  for (const r of db
    .prepare(
      "SELECT e.id, e.title, e.summary, e.status, b.name AS brand FROM episodes e JOIN brands b ON b.id = e.brand_id WHERE e.title LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\' OR e.id LIKE ? ESCAPE '\\' ORDER BY e.updated_utc DESC LIMIT 8",
    )
    .all(l, l, l, l) as any[])
    out.push({
      kind: 'episode',
      title: r.title || r.id,
      subtitle: `${r.brand} · ${r.status}`,
      target: { screen: 'studio', studioTab: 'library', episodeId: r.id },
    })

  for (const r of db
    .prepare(
      "SELECT p.id, p.title, p.caption, p.status, p.scheduled_at_utc, b.name AS brand FROM posts p JOIN brands b ON b.id = p.brand_id WHERE p.title LIKE ? ESCAPE '\\' OR p.caption LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT 8",
    )
    .all(l, l) as any[])
    out.push({
      kind: 'post',
      title: r.title || '(no title)',
      subtitle: `${r.brand} · ${r.status}${r.scheduled_at_utc ? ' · ' + r.scheduled_at_utc.slice(0, 10) : ''}`,
      target: { screen: 'calendar', postId: r.id },
    })

  for (const r of db
    .prepare(
      "SELECT i.text, b.name AS brand FROM ideas i JOIN brands b ON b.id = i.brand_id WHERE i.text LIKE ? ESCAPE '\\' LIMIT 5",
    )
    .all(l) as any[])
    out.push({
      kind: 'idea',
      title: r.text.slice(0, 90),
      subtitle: `${r.brand} · idea bank`,
      target: { screen: 'studio', studioTab: 'bible' },
    })

  for (const r of db
    .prepare(
      "SELECT c.text, c.author, c.status, b.name AS brand FROM comment_items c JOIN brands b ON b.id = c.brand_id WHERE c.text LIKE ? ESCAPE '\\' OR c.author LIKE ? ESCAPE '\\' ORDER BY c.id DESC LIMIT 5",
    )
    .all(l, l) as any[])
    out.push({
      kind: 'comment',
      title: snip(r.text, q),
      subtitle: `${r.brand} · ${r.author || 'someone'} · ${r.status}`,
      target: { screen: 'studio', studioTab: 'comments' },
    })

  for (const r of db
    .prepare(
      "SELECT s.bible_json, b.name AS brand FROM series_bible s JOIN brands b ON b.id = s.brand_id WHERE s.bible_json LIKE ? ESCAPE '\\' LIMIT 4",
    )
    .all(l) as any[])
    out.push({
      kind: 'bible',
      title: snip(r.bible_json.replace(/[{}"[\]]/g, ' '), q),
      subtitle: `${r.brand} · series bible`,
      target: { screen: 'studio', studioTab: 'bible' },
    })

  for (const r of db
    .prepare(
      "SELECT agent, action, ts_utc, detail_json FROM audit_log WHERE agent LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR detail_json LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 4",
    )
    .all(l, l, l) as any[])
    out.push({
      kind: 'log',
      title: `${r.agent}: ${r.action}`,
      subtitle: `${r.ts_utc.slice(0, 16).replace('T', ' ')} UTC · ${snip(r.detail_json ?? '', q, 40)}`,
      target: { screen: 'studio', studioTab: 'log' },
    })

  const lq = q.toLowerCase()
  for (const p of PAGES)
    if ((p.title + ' ' + p.words).toLowerCase().includes(lq))
      out.push({ kind: 'page', title: p.title, subtitle: 'Go to this page', target: p.target })

  // Pages first, then the rest in the order found.
  return [...out.filter((h) => h.kind === 'page'), ...out.filter((h) => h.kind !== 'page')].slice(
    0,
    40,
  )
}
