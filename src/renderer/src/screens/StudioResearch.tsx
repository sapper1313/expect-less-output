import { useState } from 'react'
import type { CompetitorView, TitleLabResult } from '@shared/studio/research'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Empty, Input, Select, useBusy } from '../ui'

const k = (n: number | null) =>
  n === null
    ? 'n/a'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n)

export function StudioResearch() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.studio.brands())
  const [brandId, setBrandId] = useState<number | null>(null)
  const id = brandId ?? brands?.[0]?.brandId ?? null
  const { data: comps, reload: reloadComps } = useLoad(
    () => (id ? api.studio.competitors(id) : Promise.resolve([] as CompetitorView[])),
    [id],
  )
  const { data: trends, reload: reloadTrends } = useLoad(
    () => (id ? api.studio.trends(id) : Promise.resolve({ videos: [], fetchedUtc: null })),
    [id],
  )
  const [topic, setTopic] = useState('')
  const [includeTop, setIncludeTop] = useState(false)
  const [result, setResult] = useState<TitleLabResult | null>(null)
  const [handle, setHandle] = useState('')
  if (!brands || !id) return null
  const fail = (e: unknown) =>
    toast({ kind: 'error', headline: 'That did not work.', detail: (e as Error).message })
  const copy = (t: string) =>
    void navigator.clipboard
      .writeText(t)
      .then(() => toast({ kind: 'success', headline: 'Copied.' }))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-64"
          value={id}
          onChange={(e) => {
            setBrandId(Number(e.target.value))
            setResult(null)
          }}
        >
          {brands.map((b) => (
            <option key={b.brandId} value={b.brandId}>
              {b.name}
            </option>
          ))}
        </Select>
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              try {
                const n = await api.studio.ideasFromResearch(id)
                toast({
                  kind: 'success',
                  headline: `Added ${n.length} ideas to the idea bank.`,
                  detail: 'They are in the Bible tab, under Ideas.',
                })
              } catch (e) {
                fail(e)
              }
            })
          }
        >
          Make ideas from the competitors and trends below
        </Button>
      </div>

      <Card title="Title Lab">
        <p className="mb-3 text-[12px] text-muted">
          Type a topic. You get what people search for, and title and tag ideas in this channel's
          voice. It costs a fraction of a cent. Top videos use 100 of your 10,000 free daily YouTube
          points.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-md"
            value={topic}
            placeholder="For example: clean up your desktop"
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') document.getElementById('lab-go')?.click()
            }}
          />
          <Check checked={includeTop} onChange={setIncludeTop}>
            Also look at the top videos
          </Check>
          <Button
            id="lab-go"
            variant="primary"
            disabled={busy || topic.trim().length < 3}
            onClick={() =>
              run(async () => {
                try {
                  setResult(await api.studio.titleLab(id, topic, includeTop))
                } catch (e) {
                  fail(e)
                }
              })
            }
          >
            Find titles
          </Button>
        </div>
        {result && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[12px] font-bold uppercase text-muted">Title ideas</div>
              {result.titles.map((t, i) => (
                <div key={i} className="mb-2 rounded-md border border-line p-2">
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-[14px]">{t.title}</b>
                    <Button variant="ghost" onClick={() => copy(t.title)}>
                      Copy
                    </Button>
                  </div>
                  <div className="text-[12px] text-muted">{t.why}</div>
                </div>
              ))}
              {result.tags.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[12px] font-bold uppercase text-muted">
                    Tags{' '}
                    <Button variant="ghost" onClick={() => copy(result.tags.join(', '))}>
                      Copy all
                    </Button>
                  </div>
                  <div className="text-[12px]">{result.tags.join(', ')}</div>
                </div>
              )}
            </div>
            <div className="space-y-3 text-[12px]">
              <div>
                <div className="mb-1 font-bold uppercase text-muted">What people search for</div>
                {result.suggestions.length ? (
                  result.suggestions.map((s) => <div key={s}>{s}</div>)
                ) : (
                  <div className="text-muted">Nothing came back.</div>
                )}
              </div>
              {result.topVideos.length > 0 && (
                <div>
                  <div className="mb-1 font-bold uppercase text-muted">Top videos right now</div>
                  {result.topVideos.map((v, i) => (
                    <div key={i}>
                      {v.title}{' '}
                      <span className="text-muted">
                        ({k(v.views)} views, {v.channel})
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {result.note && <div className="text-warn">{result.note}</div>}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Competitors"
        actions={
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                try {
                  await api.studio.refreshCompetitors(id)
                  reloadComps()
                } catch (e) {
                  fail(e)
                }
              })
            }
          >
            Refresh
          </Button>
        }
      >
        <div className="mb-3 flex gap-2">
          <Input
            className="max-w-md"
            value={handle}
            placeholder="@somechannel or its youtube.com address"
            onChange={(e) => setHandle(e.target.value)}
          />
          <Button
            disabled={busy || !handle.trim()}
            onClick={() =>
              run(async () => {
                try {
                  await api.studio.addCompetitor(id, handle)
                  setHandle('')
                  reloadComps()
                } catch (e) {
                  fail(e)
                }
              })
            }
          >
            Watch this channel
          </Button>
        </div>
        {!comps?.length && (
          <Empty>
            No competitors yet. Add a channel you want to learn from. It costs about 2 YouTube
            points each time you refresh.
          </Empty>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {comps?.map((c) => (
            <div key={c.id} className="rounded-md border border-line p-3">
              <div className="flex items-center justify-between">
                <b>{c.title || c.handle}</b>
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      await api.studio.removeCompetitor(id, c.id)
                      reloadComps()
                    })
                  }
                >
                  Stop watching
                </Button>
              </div>
              <div className="mb-2 text-[12px] text-muted">
                {c.handle} · {k(c.subscribers)} subscribers · average {k(c.averageViews)} views per
                recent video
              </div>
              {c.videos.map((v) => {
                const hit = c.averageViews && v.views && v.views > c.averageViews * 2
                return (
                  <div
                    key={v.id}
                    className="flex justify-between gap-2 border-t border-line py-1 text-[12px]"
                  >
                    <span className={hit ? 'font-bold text-ok' : ''}>
                      {hit ? '★ ' : ''}
                      {v.title}
                    </span>
                    <span className="shrink-0 text-muted">{k(v.views)}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Trending in this channel's category"
        actions={
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                try {
                  await api.studio.refreshTrends(id)
                  reloadTrends()
                } catch (e) {
                  fail(e)
                }
              })
            }
          >
            Fetch trends
          </Button>
        }
      >
        {!trends?.videos.length ? (
          <Empty>
            Press Fetch trends to see what is popular right now. It costs 1 YouTube point.
          </Empty>
        ) : (
          <div className="space-y-1 text-[13px]">
            {trends.videos.map((v) => (
              <div key={v.id} className="flex justify-between gap-2 border-b border-line py-1">
                <span>
                  {v.title} <span className="text-muted">{v.channel}</span>
                </span>
                <span className="shrink-0 text-muted">{k(v.views)}</span>
              </div>
            ))}
            {trends.fetchedUtc && (
              <div className="pt-1 text-[11px] text-muted">
                Fetched {trends.fetchedUtc.slice(0, 16).replace('T', ' ')} UTC
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
