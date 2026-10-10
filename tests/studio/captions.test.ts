import { describe, expect, it, vi } from 'vitest'
import { buildCues, chapterGroups, chaptersText, toSrt } from '../../src/shared/studio/captions'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

const scene = (n: number, lines: string[], seconds = 10) => ({
  n, content_seconds: seconds, generate_seconds: seconds, setting: 's', characters: [], action: `Scene ${n} action`, dialogue: lines.map((line) => ({ speaker: 'Biscuit', line })), objects_in_frame: [], camera: '', transition_in: '', transition_out: '', grok_prompt: 'p', extension_note: '',
})
const pkg = { scenes: Array.from({ length: 18 }, (_, i) => scene(i + 1, i % 3 === 0 ? [] : ['One.', 'Two.'])) }

describe('chapters and cues', () => {
  it('builds timed cues and a valid SRT', () => {
    const cues = buildCues({ scenes: [scene(1, ['Hello there', 'Count with me']), scene(2, [])] })
    expect(cues).toHaveLength(2)
    expect(cues[0].start).toBe(0)
    expect(cues[1].start).toBe(5)
    const srt = toSrt(cues)
    expect(srt).toContain('1\n00:00:00,000 --> ')
    expect(srt).toContain('2\n00:00:05,000 --> ')
  })
  it('groups 18 scenes into 3 to 10 chapters starting at 0:00, each 20 seconds or more, and skips short videos', () => {
    const g = chapterGroups(pkg)
    expect(g.length).toBeGreaterThanOrEqual(3)
    expect(g.length).toBeLessThanOrEqual(10)
    expect(g[0].start).toBe(0)
    g.slice(0, -1).forEach((x, i) => expect(g[i + 1].start - x.start).toBeGreaterThanOrEqual(20))
    expect(chapterGroups({ scenes: [scene(1, ['x'], 15), scene(2, ['y'], 15)] })).toEqual([])
    expect(chaptersText([{ start: 0, title: 'Start' }, { start: 75, title: 'Middle' }])).toBe('0:00 Start\n1:15 Middle')
  })
})

describe('caption service in mock mode', () => {
  it('makes chapters and captions for an episode and exports files', async () => {
    const e = makeStudioEnv()
    const b = hollowId(e)
    const ep = e.studio.episodes.create(b, { ...minimalPackage('Counting acorns'), scenes: pkg.scenes } as never, { status: 'Ready for production' })
    const ch = await e.studio.makeChapters(ep.id)
    expect(ch.text.split('\n')[0]).toMatch(/^0:00 /)
    expect(ch.chapters.length).toBeGreaterThanOrEqual(3)
    expect(await e.studio.chaptersFor(ep.id)).toBe(ch.text)
    const caps = await e.studio.makeCaptions(ep.id, ['es', 'xx'])
    expect(caps.map((c) => c.lang)).toEqual(['en', 'es'])
    expect(caps[1].cues).toBe(caps[0].cues)
    const dir = await e.studio.exportCaptions(ep.id)
    const { readFileSync } = await import('fs')
    expect(readFileSync(`${dir}/${ep.id}.es.srt`, 'utf8')).toContain('[translated] One.')
    await expect(e.studio.makeChapters('nope')).rejects.toThrow(/not found/)
    expect((await e.studio.uploadCaptions(ep.id).catch((x) => x as Error)).message).toMatch(/not been posted/)
  })
})
