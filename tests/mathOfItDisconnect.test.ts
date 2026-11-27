import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeEnv } from './helpers'

describe('migration 049 disconnects The Math of It', () => {
  it('turns that channel into dry run placeholders and leaves other channels alone', () => {
    const env = makeEnv()
    const db = env.db
    const mk = (name: string, slug: string) =>
      Number(
        db
          .prepare("INSERT INTO brands (name, color, slug, created_at) VALUES (?, '#000', ?, 'x')")
          .run(name, slug).lastInsertRowid,
      )
    const existing = db.prepare("SELECT id FROM brands WHERE slug = 'math-of-it'").get() as { id: number } | undefined
    const math = existing ? existing.id : mk('Test Math', 'math-of-it')
    const other = mk('Test Other', 'other-channel')
    const live = db.prepare(
      "INSERT INTO accounts (brand_id, platform, external_id, display_name, token_ref, status, mode) VALUES (?, ?, 'ext', '@x', 'tok', 'connected', 'live')",
    )
    db.prepare('DELETE FROM accounts WHERE brand_id IN (?, ?)').run(math, other)
    for (const b of [math, other]) for (const p of ['facebook', 'instagram', 'youtube']) live.run(b, p)
    db.exec(readFileSync(join(__dirname, '../src/main/db/migrations/049_math_of_it_disconnect.sql'), 'utf8'))
    const rows = (b: number) => db.prepare('SELECT * FROM accounts WHERE brand_id = ?').all(b) as any[]
    for (const r of rows(math)) {
      expect(r.mode).toBe('dry_run')
      expect(r.external_id).toBeNull()
      expect(r.token_ref).toBeNull()
    }
    for (const r of rows(other)) expect(r.mode).toBe('live')
  })
})
