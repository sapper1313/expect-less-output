import { useEffect, useMemo, useRef, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS, captionCounters, type Platform } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { applyCaptionTemplate, titleFromFilename } from '@shared/text'
import { formatEastern } from '@shared/time'
import type { MediaInspection } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PlatformPicker, SchedulePicker } from '../components/pickers'
import {
  Button,
  Card,
  Check,
  Counter,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useBusy,
} from '../ui'

export const isVideo = (p: string) => /\.(mp4|mov)$/i.test(p)

export function NewPost({ onDone }: { onDone: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: settings } = useLoad(() => api.settings.get())
  const { data: brands } = useLoad(() => api.brands.list())
  const [source, setSource] = useState<MediaInspection | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [captionTouched, setCaptionTouched] = useState(false)
  const [setId, setSetId] = useState<number | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [overrides, setOverrides] = useState<Partial<Record<Platform, string>>>({})
  const [showOverrides, setShowOverrides] = useState(false)
  const [ai, setAi] = useState<Record<Platform, boolean>>({
    youtube: false,
    facebook: false,
    instagram: false,
    tiktok: false,
  })
  const [when, setWhen] = useState<string | null>(null)
  const { data: defaults } = useLoad(
    () => (brandId ? api.brands.getDefaults(brandId) : Promise.resolve(null)),
    [brandId],
  )
  const { data: sets } = useLoad(
    () => (brandId ? api.hashtags.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const brand = brands?.find((b) => b.id === brandId)
  const picked = useRef(false)

  useEffect(() => {
    if (brands?.length && brandId === null) setBrandId(brands[0].id)
  }, [brands, brandId])

  // When the brand changes: reset the things that come from brand defaults.
  useEffect(() => {
    if (!defaults) return
    setSetId(defaults.defaultHashtagSetId)
    setAi(defaults.aiFlag)
    setCaptionTouched(false)
    if (!picked.current) {
      picked.current = true
      void api.accounts
        .list(defaults.brandId)
        .then((a) => setPlatforms(a.filter((x) => x.status === 'connected').map((x) => x.platform)))
    }
  }, [defaults])

  useEffect(() => {
    if (brandId)
      void api.accounts
        .list(brandId)
        .then((a) =>
          setPlatforms((cur) =>
            cur.filter((p) => a.some((x) => x.platform === p && x.status === 'connected')),
          ),
        )
  }, [brandId])

  const tags = sets?.find((s) => s.id === setId)?.tagsText ?? ''
  useEffect(() => {
    if (!defaults || !brand || captionTouched) return
    setCaption(
      applyCaptionTemplate(defaults.captionTemplate, { title, hashtags: tags, brand: brand.name }),
    )
  }, [defaults, brand, title, tags, captionTouched])

  async function load(path: string) {
    if (!isVideo(path)) {
      toast({ kind: 'error', headline: 'That file is not an MP4 or MOV.', detail: path })
      return
    }
    await run(async () => {
      const info = await api.media.inspect(path)
      setSource(info)
      setTitle((t) => t || titleFromFilename(info.fileName))
    })
  }

  async function pick() {
    const [p] = await api.media.pickVideos(false)
    if (p) await load(p)
  }

  const counters = useMemo(() => captionCounters(title, caption), [title, caption])
  const mode = settings?.schedulingMode ?? 'both'
  const labels = platforms.map((p) => PLATFORM_LABELS[p])
  const canSchedule =
    !!source && !!brandId && platforms.length > 0 && !!when && title.trim().length > 0

  async function save(status: 'draft' | 'scheduled') {
    if (!source || !brandId) return
    const created = await run(() =>
      api.posts.create({
        brandId,
        sourcePath: source.sourcePath,
        title: title.trim(),
        caption,
        scheduledAtUtc: when,
        status,
        targets: platforms.map((p) => ({
          platform: p,
          aiFlag: ai[p],
          captionOverride: overrides[p] ?? null,
        })),
      }),
    )
    if (created) {
      toast(
        status === 'scheduled'
          ? {
              kind: 'success',
              headline: COPY.success,
              detail: `${brand?.name}: "${created.title}" at ${formatEastern(created.scheduledAtUtc)}`,
            }
          : { kind: 'info', headline: 'Draft saved.', detail: created.title },
      )
      onDone()
    }
  }

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.newPost} />
      <div className="grid gap-5 px-8 lg:grid-cols-[320px_1fr]">
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) void load(window.elo.pathForFile(f))
            }}
            className={`flex min-h-[320px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center ${dragOver ? 'border-accent bg-accent/10' : 'border-line'}`}
          >
            {source?.posterUrl ? (
              <img
                src={source.posterUrl}
                alt="Poster frame"
                className="mb-3 max-h-[380px] rounded-md"
              />
            ) : (
              <p className="mb-3 text-muted">Drop a vertical video here</p>
            )}
            <Button onClick={pick} disabled={busy}>
              {source ? 'Choose a different video' : 'Choose a video'}
            </Button>
            {source && (
              <div className="mt-3 text-[12px] text-muted">
                {source.fileName}
                <br />
                {source.meta.width}x{source.meta.height}, {source.meta.durationSeconds.toFixed(1)}{' '}
                s, {source.meta.videoCodec}
              </div>
            )}
          </div>
          {source && source.warnings.length > 0 && (
            <div className="mt-3 rounded-md border border-warn p-3 text-[12px] text-warn">
              {source.warnings.map((w, i) => (
                <div key={i}>
                  {w.platform !== 'all' && <b>{PLATFORM_LABELS[w.platform]}: </b>}
                  {w.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Brand">
                <Select
                  value={brandId ?? ''}
                  onChange={(e) => {
                    setBrandId(Number(e.target.value))
                    setWhen(null)
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
                  onChange={(e) => setSetId(e.target.value ? Number(e.target.value) : null)}
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
                <PlatformPicker brandId={brandId} value={platforms} onChange={setPlatforms} />
              </Field>
            </div>
          </Card>

          <Card>
            <Field label="Title" hint="YouTube uses this as the video title.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            </Field>
            <div className="mt-4">
              <Field label="Caption">
                <Textarea
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value)
                    setCaptionTouched(true)
                  }}
                  rows={5}
                />
              </Field>
              <div className="mt-1 flex flex-wrap gap-x-4">
                {platforms.flatMap((p) =>
                  counters[p].map((c) => (
                    <Counter
                      key={p + c.label}
                      c={{ ...c, label: `${PLATFORM_LABELS[p]} ${c.label.toLowerCase()}` }}
                    />
                  )),
                )}
              </div>
            </div>
            <button
              className="mt-3 text-[12px] font-semibold text-accent"
              onClick={() => setShowOverrides((s) => !s)}
            >
              {showOverrides ? 'Hide' : 'Show'} per-platform captions
            </button>
            {showOverrides && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {PLATFORMS.filter((p) => platforms.includes(p)).map((p) => (
                  <Field
                    key={p}
                    label={`${PLATFORM_LABELS[p]} caption`}
                    hint="Leave empty to use the shared caption."
                  >
                    <Textarea
                      rows={3}
                      value={overrides[p] ?? ''}
                      onChange={(e) => setOverrides({ ...overrides, [p]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <Button disabled title="Coming in a later update">
                {COPY.textAssistPlaceholder}
              </Button>
            </div>
          </Card>

          <Card>
            <Field label="Made with AI (disclosure flag per platform)">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {platforms.map((p) => (
                  <Check key={p} checked={ai[p]} onChange={(v) => setAi({ ...ai, [p]: v })}>
                    {PLATFORM_LABELS[p]}
                  </Check>
                ))}
                {platforms.length === 0 && (
                  <span className="text-muted">Pick a platform first.</span>
                )}
              </div>
            </Field>
          </Card>

          <Card>
            <Field label="When (Eastern time)">
              <SchedulePicker
                key={brandId ?? 0}
                brandId={brandId}
                value={when}
                onChange={setWhen}
                mode={mode}
              />
            </Field>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button disabled={!source || busy || !brandId} onClick={() => save('draft')}>
              {COPY.draftButton}
            </Button>
            <Button
              variant="fine"
              disabled={!canSchedule || busy}
              onClick={() => save('scheduled')}
              aria-label={COPY.scheduleTooltip(labels, formatEastern(when))}
              title={COPY.scheduleTooltip(labels, formatEastern(when))}
            >
              {COPY.publishButton}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
