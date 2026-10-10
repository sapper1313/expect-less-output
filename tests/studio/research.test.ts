import { describe, expect, it, vi } from 'vitest'
import { Research, type ResearchYoutube } from '../../src/main/studio/research'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

describe('mock mode research', () => {
  it('finds titles, watches a competitor, and turns research into ideas without any network', async () => {
    const e = makeStudioEnv()
    const b = (await e.studio.brands())[0].brandId
    const lab = await e.studio.titleLab(b, 'clean up your desktop', true)
    expect(lab.titles.length).toBeGreaterThan(0)
    expect(lab.suggestions[0]).toContain('clean up your desktop')
    expect(lab.topVideos.length).toBe(1)
    await expect(e.studio.titleLab(b, 'x', false)).rejects.toThrow(/at least 3/)
    const list = await e.studio.addCompetitor(b, 'https://www.youtube.com/@somechannel/videos')
    expect(list[0].handle).toBe('@somechannel')
    expect(list[0].averageViews).toBeGreaterThan(0)
    await e.studio.refreshTrends(b)
    const before = (await e.studio.ideas(b)).length
    const ideas = await e.studio.ideasFromResearch(b)
    expect(ideas.length).toBe(2)
    expect((await e.studio.ideas(b)).length).toBeGreaterThan(before)
    expect((await e.studio.removeCompetitor(b, list[0].id)).length).toBe(0)
    await expect(e.studio.ideasFromResearch(b)).resolves.toBeTruthy()
  })
})

describe('real mode research with fakes', () => {
  it('uses the connected YouTube account, and asks you to connect when there is none', async () => {
    const e = makeStudioEnv()
    await e.studio.setMockMode(false)
    const b = (await e.studio.brands())[0].brandId
    const yt: ResearchYoutube = {
      searchVideos: vi.fn(async () => [{ id: 'v', title: 'Big video', channel: 'C', publishedAt: null, views: 5000 }]),
      channelWithRecent: vi.fn(async () => ({ id: 'UC1', title: 'Rival', subscribers: 10, videos: [{ id: 'a', title: 'A', publishedAt: null, views: 100 }] })),
      trending: vi.fn(async () => [{ id: 't', title: 'Hot', channel: 'H', views: 9 }]),
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(['q', ['one', 'two']]))) as unknown as typeof fetch
    let account: number | null = null
    const r = new Research({ db: e.db, gateway: e.studio.gateway, youtube: () => yt, accountFor: () => account, categoryFor: () => '22', mock: () => false, brandName: () => 'B', bibleText: () => 'bible', addIdeas: () => undefined, fetchImpl })
    expect(await r.suggestions('desk')).toEqual(['one', 'two'])
    await expect(r.refreshTrends(b)).rejects.toThrow(/Connect YouTube/)
    account = 7
    const t = await r.refreshTrends(b)
    expect(yt.trending).toHaveBeenCalledWith(7, '22', 12)
    expect(t.videos[0].title).toBe('Hot')
    await r.addCompetitor(b, '@rival')
    expect(yt.channelWithRecent).toHaveBeenCalledWith(7, '@rival', 10)
    expect(r.competitors(b)[0].subscribers).toBe(10)
  })
})
