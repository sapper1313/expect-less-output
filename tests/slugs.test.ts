import { describe, expect, it } from 'vitest'
import { ensureSlugs } from '../src/main/db/seed'
import { makeStudioEnv } from './studio/helpers'

describe('channel slugs', () => {
  it('seeded channels get the agreed slugs and new ones get a unique slug', () => {
    const e = makeStudioEnv()
    const slugs = (
      e.db.prepare('SELECT slug FROM brands ORDER BY id').all() as Array<{ slug: string }>
    ).map((r) => r.slug)
    expect(slugs).toEqual(
      expect.arrayContaining([
        'trash-panda',
        'clock-out-early',
        'teach-your-parents-tech',
        'math-of-it',
        'wonder-hollow',
      ]),
    )
    const a = e.brands.create('The Complaint Department', '#111111')
    expect(a.slug).toBe('complaint-department')
    const b = e.brands.create('Complaint Department', '#222222')
    expect(b.slug).toBe('complaint-department-2')
    expect(e.brands.bySlug('COMPLAINT-DEPARTMENT')?.id).toBe(a.id)
    ensureSlugs(e.db)
    expect(e.brands.bySlug('complaint-department')?.id).toBe(a.id)
  })
})
