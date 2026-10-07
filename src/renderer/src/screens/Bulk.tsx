import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS, captionCounters, type Platform } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { applyCaptionTemplate, naturalCompare, titleFromFilename } from '@shared/text'
import { formatEastern, isoToLocalInput, localInputToIso } from '@shared/time'
import type { MediaInspection } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PlatformPicker } from '../components/pickers'
import { TikTokSection, useCreator } from '../components/TikTokSection'
import { emptyTikTokSettings, tiktokSettingsProblem } from '@shared/tiktok'
import type { TikTokPostSettings } from '@shared/types'
import {
  Button,
  Card,
  Check,
  Counter,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useBusy,
} from '../ui'
import { isVideo } from './NewPost'

interface Row {
  key: string
  info: MediaInspection
  title: string
  caption: string
  when: string | null
  platforms: Platform[]
  ai: Record<Platform, boolean>
}

export function Bulk({ onDone }: { onDone: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | null>(null)
  const { data: sets } = useLoad(
    () => (brandId ? api.hashtags.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const { data: defaults } = useLoad(
    () => (brandId ? api.brands.getDefaults(brandId) : Promise.resolve(null)),
    [brandId],
  )
  const [setId, setSetId] = useState<number | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [paths, setPaths] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [bulkCaption, setBulkCaption] = useState('')
  const brand = brands?.find((b) => b.id === brandId)
  const { data: accounts } = useLoad(
    () => (brandId ? api.accounts.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const ttAccount = accounts?.find((a) => a.platform === 'tiktok')
  const ttDirect =
    platforms.includes('tiktok') &&
    ttAccount?.mode === 'direct' &&
    ttAccount.status === 'connected' &&
    rows.some((r) => r.platforms.includes('tiktok'))
  const [tt, setTt] = useState<TikTokPostSettings>(emptyTikTokSettings())
  const creator = useCreator(brandId, ttDirect)
  const ttProblem = ttDirect
    ? tiktokSettingsProblem(
        tt,
        creator.info,
        Math.max(0, ...rows.map((r) => r.info.meta.durationSeconds)),
      )
    : null

  useEffect(() => {
    if (brands?.length && brandId === null) setBrandId(brands[0].id)
  }, [brands, brandId])
  useEffect(() => {
    if (!defaults) return
    setSetId(defaults.defaultHashtagSetId)
    setBulkCaption(defaults.captionTemplate)
    void api.accounts
      .list(defaults.brandId)
      .then((a) => setPlatforms(a.filter((x) => x.status === 'connected').map((x) => x.platform)))
  }, [defaults])

  const tags = sets?.find((s) => s.id === setId)?.tagsText ?? ''
  const fill = (template: string, title: string) =>
    applyCaptionTemplate(template, { title, hashtags: tags, brand: brand?.name ?? '' })

  function addPaths(list: string[]) {
    const vids = list.filter(isVideo)
    if (vids.length < list.length)
      toast({
        kind: 'info',
        headline: 'Skipped some files.',
        detail: 'Only MP4 and MOV files are accepted.',
      })
    setPaths((cur) => [...new Set([...cur, ...vids])])
    setRows([])
  }

  async function prepare() {
    if (!brandId || !defaults || !brand) return
    await run(async () => {
      const sorted = [...paths].sort((a, b) =>
        naturalCompare(a.split('/').pop()!, b.split('/').pop()!),
      )
      const infos: MediaInspection[] = []
      for (const p of sorted) infos.push(await api.media.inspect(p))
      const slots = await api.slots.next(brandId, infos.length)
      setRows(
        infos.map((info, i) => {
          const title = titleFromFilename(info.fileName)
          return {
            key: info.sourcePath,
            info,
            title,
            caption: fill(defaults.captionTemplate, title),
            when: slots[i] ?? null,
            platforms,
            ai: { ...defaults.aiFlag },
          }
        }),
      )
    })
  }

  const patch = (i: number, p: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)))

  const dup = new Set(rows.map((r) => r.when).filter((w, i, a) => w && a.indexOf(w) !== i))
  const ready =
    rows.length > 0 &&
    rows.every((r) => r.when && r.platforms.length > 0 && r.title.trim()) &&
    !ttProblem

  async function confirm() {
    if (!brandId) return
    const created = await run(() =>
      api.posts.createMany(
        rows.map((r) => ({
          brandId,
          sourcePath: r.info.sourcePath,
          title: r.title.trim(),
          caption: r.caption,
          scheduledAtUtc: r.when,
          status: 'scheduled' as const,
          targets: r.platforms.map((p) => ({
            platform: p,
            aiFlag: r.ai[p],
            settings: p === 'tiktok' && ttDirect ? { tiktok: tt } : undefined,
          })),
        })),
      ),
    )
    if (created) {
      toast({
        kind: 'success',
        headline: COPY.success,
        detail: `${created.length} posts scheduled for ${brand?.name}.`,
      })
      onDone()
    }
  }

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.bulk} />
      <div className="space-y-4 px-8">
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Brand">
              <Select
                value={brandId ?? ''}
                onChange={(e) => {
                  setBrandId(Number(e.target.value))
                  setRows([])
                }}
              >
                {brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hashtag set">
              <Select
                value={setId ?? ''}
                onChange={(e) => {
                  setSetId(e.target.value ? Number(e.target.value) : null)
                  setRows([])
                }}
              >
                <option value="">None</option>
                {sets?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Platforms">
              <PlatformPicker
                brandId={brandId}
                value={platforms}
                onChange={(v) => {
                  setPlatforms(v)
                  setRows([])
                }}
              />
            </Field>
          </div>
        </Card>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            addPaths([...e.dataTransfer.files].map((f) => window.elo.pathForFile(f)))
          }}
          className={`rounded-lg border-2 border-dashed p-8 text-center ${dragOver ? 'border-accent bg-accent/10' : 'border-line'}`}
        >
          <p className="mb-3 text-muted">
            {paths.length
              ? `${paths.length} video${paths.length === 1 ? '' : 's'} ready`
              : 'Drop many videos here'}
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={async () => addPaths(await api.media.pickVideos(true))}>
              Choose videos
            </Button>
            {paths.length > 0 && (
              <>
                <Button variant="primary" disabled={busy || !platforms.length} onClick={prepare}>
                  {busy ? 'Reading videos...' : 'Assign slots'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPaths([])
                    setRows([])
                  }}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>

        {rows.length === 0 && paths.length === 0 && (
          <Empty>
            Pick a brand, drop some videos, then press Assign slots. You can edit everything before
            confirming.
          </Empty>
        )}

        {rows.length > 0 && (
          <>
            {ttDirect && (
              <Card title="TikTok settings for every row">
                <p className="mb-3 text-[12px] text-muted">
                  TikTok needs these choices for every post and does not allow defaults, so choose
                  them once here and they apply to all rows.
                </p>
                <TikTokSection
                  info={creator.info}
                  loading={creator.loading}
                  error={creator.error}
                  value={tt}
                  onChange={setTt}
                  durationSeconds={Math.max(0, ...rows.map((r) => r.info.meta.durationSeconds))}
                  aiFlag={rows.some((r) => r.ai.tiktok)}
                />
              </Card>
            )}
            <Card title="Apply to all">
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <Field
                  label="Caption for all rows"
                  hint="Tokens {title}, {hashtags}, {brand} are filled in per row."
                >
                  <Textarea
                    rows={3}
                    value={bulkCaption}
                    onChange={(e) => setBulkCaption(e.target.value)}
                  />
                </Field>
                <div className="flex flex-col justify-end gap-2">
                  <Button
                    onClick={() =>
                      setRows((r) => r.map((x) => ({ ...x, caption: fill(bulkCaption, x.title) })))
                    }
                  >
                    Apply caption and hashtags
                  </Button>
                  <Button onClick={() => setRows((r) => r.map((x) => ({ ...x, platforms })))}>
                    Apply platforms
                  </Button>
                  <Button
                    onClick={() =>
                      defaults &&
                      setRows((r) => r.map((x) => ({ ...x, ai: { ...defaults.aiFlag } })))
                    }
                  >
                    Apply AI flags from brand
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                {PLATFORMS.map((p) => (
                  <Check
                    key={p}
                    checked={rows.every((r) => r.ai[p])}
                    onChange={(v) =>
                      setRows((r) => r.map((x) => ({ ...x, ai: { ...x.ai, [p]: v } })))
                    }
                  >
                    AI flag all: {PLATFORM_LABELS[p]}
                  </Check>
                ))}
              </div>
            </Card>

            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-surface2 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="p-3">Video</th>
                    <th className="p-3">Title</th>
                    <th className="p-3">Caption</th>
                    <th className="p-3">When (ET)</th>
                    <th className="p-3">Platforms and AI</th>
                    <th className="w-10 p-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const counters = captionCounters(r.title, r.caption)
                    const over = r.platforms.flatMap((p) => counters[p]).some((c) => c.over)
                    return (
                      <tr key={r.key} className="border-t border-line align-top">
                        <td className="w-40 p-3">
                          {r.info.posterUrl && (
                            <img src={r.info.posterUrl} alt="" className="mb-1 h-24 rounded" />
                          )}
                          <div className="break-all text-[11px] text-muted">{r.info.fileName}</div>
                          {r.info.warnings.length > 0 && (
                            <div
                              className="mt-1 text-[11px] text-warn"
                              title={r.info.warnings.map((w) => w.message).join('\n')}
                            >
                              {r.info.warnings.length} warning(s)
                            </div>
                          )}
                        </td>
                        <td className="w-52 p-3">
                          <Input
                            value={r.title}
                            onChange={(e) => patch(i, { title: e.target.value })}
                            aria-label="Title"
                          />
                        </td>
                        <td className="min-w-[240px] p-3">
                          <Textarea
                            rows={4}
                            value={r.caption}
                            onChange={(e) => patch(i, { caption: e.target.value })}
                            aria-label="Caption"
                          />
                          {over && (
                            <div className="mt-1 text-[11px] font-bold text-bad">
                              Over a platform limit
                            </div>
                          )}
                          <div className="flex gap-3">
                            {r.platforms.length > 0 &&
                              counters[r.platforms[0]].map((c) => <Counter key={c.label} c={c} />)}
                          </div>
                        </td>
                        <td className="w-52 p-3">
                          <Input
                            type="datetime-local"
                            value={isoToLocalInput(r.when)}
                            onChange={(e) => patch(i, { when: localInputToIso(e.target.value) })}
                            aria-label="Time"
                          />
                          <div className="mt-1 text-[11px] text-muted">{formatEastern(r.when)}</div>
                          {r.when && dup.has(r.when) && (
                            <div className="text-[11px] font-bold text-warn">
                              Same time as another row
                            </div>
                          )}
                        </td>
                        <td className="w-44 p-3">
                          <div className="space-y-1">
                            {PLATFORMS.map((p) => (
                              <div key={p} className="flex items-center justify-between gap-2">
                                <Check
                                  checked={r.platforms.includes(p)}
                                  disabled={!platforms.includes(p)}
                                  onChange={(v) =>
                                    patch(i, {
                                      platforms: v
                                        ? [...r.platforms, p]
                                        : r.platforms.filter((x) => x !== p),
                                    })
                                  }
                                >
                                  {PLATFORM_LABELS[p]}
                                </Check>
                                <label className="flex items-center gap-1 text-[10px] text-muted">
                                  AI
                                  <input
                                    type="checkbox"
                                    aria-label={`AI flag ${PLATFORM_LABELS[p]}`}
                                    checked={r.ai[p]}
                                    onChange={(e) =>
                                      patch(i, { ai: { ...r.ai, [p]: e.target.checked } })
                                    }
                                  />
                                </label>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <button
                            className="text-muted hover:text-bad"
                            aria-label="Remove this row"
                            onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                          >
                            x
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button
                variant="fine"
                disabled={!ready || busy}
                onClick={confirm}
                title={`Schedule ${rows.length} posts for ${brand?.name ?? ''} to ${platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}`}
                aria-label={`Schedule ${rows.length} posts for ${brand?.name ?? ''} to ${platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}`}
              >
                {COPY.publishButton}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
