import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

describe('amazon tracking ids', () => {
  it('are filled in per channel by the migration, and the switch stays off', () => {
    const env = makeEnv()
    const tags = env.db
      .prepare(
        "SELECT b.slug, r.amazon_tag FROM channel_rules r JOIN brands b ON b.id = r.brand_id WHERE r.amazon_tag != ''",
      )
      .all() as Array<{ slug: string; amazon_tag: string }>
    for (const t of tags) expect(t.amazon_tag).toMatch(/^expectless-[a-z]+-20$/)
    expect(env.settings.get().amazonListsLive).toBe(false)
  })
})
