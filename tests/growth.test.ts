import { describe, it, expect } from 'vitest'
import {
  staggerOffsets,
  morphCaption,
  isViewerQuestion,
  topicRuns,
  bestTimes,
  steepestDrop,
  slowStart,
  parseLoudnorm,
  loudnessProblem,
  parseSuggestions,
  mergeSearchTags,
  normalizeTopic,
} from '../src/shared/growth'

describe('staggerOffsets', () => {
  it('puts YouTube on the slot and spaces the rest', () => {
    const o = staggerOffsets(['tiktok', 'youtube', 'instagram', 'facebook'], 7, 2, 7)
    expect(o.youtube).toBe(0)
    expect(o.instagram).toBeGreaterThanOrEqual(2)
    expect(o.facebook! - o.instagram!).toBeGreaterThanOrEqual(2)
    expect(o.tiktok! - o.facebook!).toBeLessThanOrEqual(7)
  })
  it('is the same for the same seed and one platform stays on the slot', () => {
    expect(staggerOffsets(['youtube', 'tiktok'], 3, 2, 9)).toEqual(
      staggerOffsets(['youtube', 'tiktok'], 3, 2, 9),
    )
    expect(staggerOffsets(['tiktok'], 3, 2, 9)).toEqual({ tiktok: 0 })
  })
})

describe('morphCaption', () => {
  const d = 'Stop doing this on your Mac. It saves ten minutes a day. Try it now! #mac #tips'
  it('strips tags for Facebook', () => {
    expect(morphCaption('facebook', { description: d })).toBe(
      'Stop doing this on your Mac. It saves ten minutes a day. Try it now!',
    )
  })
  it('keeps TikTok to two sentences and five tags', () => {
    const t = morphCaption('tiktok', { description: d, tags: ['a', 'b', 'c', 'd'] })
    expect(t.startsWith('Stop doing this on your Mac. It saves ten minutes a day.')).toBe(true)
    expect(t).not.toContain('Try it now')
    expect(t.match(/#/g)!.length).toBe(5)
  })
  it('puts Instagram hashtags after a blank line', () => {
    const t = morphCaption('instagram', { description: d })
    expect(t.endsWith('\n\n#mac #tips')).toBe(true)
  })
  it('keeps the whole YouTube description', () => {
    expect(morphCaption('youtube', { description: d })).toContain('Try it now!')
  })
})

describe('questions', () => {
  it('keeps real questions and drops spam', () => {
    expect(isViewerQuestion('How do you do this on a Mac?')).toBe(true)
    expect(isViewerQuestion('Bandit, should I pay off debt or invest first')).toBe(true)
    expect(isViewerQuestion('check out my channel https://x.com ?')).toBe(false)
    expect(isViewerQuestion('Great video!')).toBe(false)
    expect(isViewerQuestion('?????????????????')).toBe(false)
  })
})

describe('topics', () => {
  it('finds back to back repeats in the last five', () => {
    expect(topicRuns(['a', 'b', 'b', 'c'])).toEqual([{ index: 1, topic: 'b', count: 2 }])
    expect(topicRuns(['a', 'b', 'a', 'b'])).toEqual([])
    expect(topicRuns([null, null])).toEqual([])
  })
  it('normalizes', () => expect(normalizeTopic(' Finance Debt! ')).toBe('finance_debt'))
})

describe('bestTimes', () => {
  it('needs two posts in the same slot', () => {
    const r = bestTimes([
      { postedAtUtc: '2026-10-05T23:00:00Z', views: 100 },
      { postedAtUtc: '2026-10-12T23:00:00Z', views: 300 },
      { postedAtUtc: '2026-10-06T14:00:00Z', views: 9999 },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ weekday: 1, hour: 19, averageViews: 200, samples: 2 })
  })
})

describe('retention', () => {
  it('finds the steepest fall after the opening', () => {
    const curve = [
      { t: 0, watch: 1 },
      { t: 0.2, watch: 0.9 },
      { t: 0.5, watch: 0.6 },
      { t: 0.7, watch: 0.55 },
    ]
    expect(steepestDrop(curve, 30)).toMatchObject({ atSeconds: 6, lostPct: 30 })
    expect(steepestDrop([{ t: 0, watch: 1 }, { t: 1, watch: 0.95 }], 30)).toBeNull()
  })
  it('flags a slow start', () => {
    expect(slowStart(10, [100, 120, 110, 90])).toBe(true)
    expect(slowStart(100, [100, 120, 110, 90])).toBe(false)
    expect(slowStart(0, [100])).toBe(false)
  })
})

describe('loudness', () => {
  it('parses loudnorm output and judges it', () => {
    const l = parseLoudnorm('blah\n{\n "input_i" : "-23.4",\n "input_tp" : "-3.0",\n "input_lra" : "5.1"\n}')
    expect(l).toEqual({ integratedLufs: -23.4, truePeakDb: -3, rangeLu: 5.1 })
    expect(loudnessProblem(l!)).toContain('quiet')
    expect(loudnessProblem({ integratedLufs: -14, truePeakDb: -1.5, rangeLu: 4 })).toBeNull()
    expect(loudnessProblem({ integratedLufs: -14, truePeakDb: 0, rangeLu: 4 })).toContain('clip')
    expect(parseLoudnorm('nothing')).toBeNull()
  })
})

describe('search tags', () => {
  it('parses suggestions and merges without repeats', () => {
    expect(parseSuggestions(['mac tips', ['Mac Tips 2026', 'mac tabs']])).toEqual([
      'mac tips 2026',
      'mac tabs',
    ])
    expect(mergeSearchTags(['mac'], ['Mac', 'mac tabs', 'x'], 2)).toEqual(['mac', 'mac tabs'])
  })
})

import { fetchSuggestions } from '../src/main/growth/seo'

describe('fetchSuggestions', () => {
  it('reads the answer and survives a failure', async () => {
    const ok = (async () =>
      new Response(JSON.stringify(['mac', ['mac tips', 'mac tabs']]))) as unknown as typeof fetch
    expect(await fetchSuggestions('mac', ok)).toEqual(['mac tips', 'mac tabs'])
    const bad = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await fetchSuggestions('mac', bad)).toEqual([])
    expect(await fetchSuggestions('  ', ok)).toEqual([])
  })
})
