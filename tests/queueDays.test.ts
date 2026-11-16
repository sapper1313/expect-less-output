import { describe, it, expect } from 'vitest'
import { entryDays, firstOn } from '../src/renderer/src/components/queueDays'

const t = (platform: string, at: string | null, status = 'pending') => ({ id: 1, platform, status, scheduledAtUtc: at }) as any
const post = (targets: any[], at = '2026-11-17T22:30:00Z') => ({ id: 167, scheduledAtUtc: at, targets }) as any

describe('Queue day grouping', () => {
  // Math Ep121: Facebook, Instagram, Bluesky Tuesday; YouTube Wednesday 7 PM ET
  const math = post([
    t('facebook', '2026-11-17T22:30:00Z'),
    t('instagram', '2026-11-18T00:30:00Z'),
    t('bluesky', '2026-11-18T00:45:00Z'),
    t('youtube', '2026-11-19T00:00:00Z')
  ])
  it('files a post under every Eastern day it has an entry on', () => {
    expect(entryDays(math)).toEqual(['2026-11-17', '2026-11-18'])
  })
  it('ignores skipped entries', () => {
    expect(entryDays(post([t('facebook', '2026-11-17T22:30:00Z'), t('youtube', '2026-11-19T00:00:00Z', 'skipped')]))).toEqual(['2026-11-17'])
  })
  it('falls back to the post time when no entry has a time', () => {
    expect(entryDays(post([t('facebook', null)]))).toEqual(['2026-11-17'])
  })
  it('sorts inside a day by that day\'s first entry', () => {
    expect(firstOn(math, '2026-11-18')).toBe('2026-11-19T00:00:00Z')
  })
})
