import { useEffect, useMemo, useRef, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS, captionCounters, type Platform } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { applyCaptionTemplate, titleFromFilename } from '@shared/text'
import { formatEastern } from '@shared/time'
import type { MediaInspection } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PlatformPicker, PlatformTimes } from '../components/pickers'
import { slotKindFor } from '@shared/slots'
import { PostingAs, TikTokSection, useCreator } from '../components/TikTokSection'
import { Suggest } from '../components/Suggest'
import { emptyTikTokSettings, tiktokSettingsProblem } from '@shared/tiktok'
import type { TikTokPostSettings } from '@shared/types'
import {
  Button,
  Card,
  Check,
  Confirm,
  Counter,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useBusy,
} from '../ui'

export const isVideo = (p: string) => /\.(mp4|mov)$/i.test(p)

export function NewPost({
  onDone,
  initialWhen = null,
}: {
  onDone: () => void
  initialWhen?: string | null
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.brands.list())
  const [source, setSource] = useState<MediaInspection | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [firstComment, setFirstComment] = useState('')
  const [captionTouched, setCaptionTouched] = useState(false)
  const [setId, setSetId] = useState<number | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [overrides, setOverrides] = useState<Partial<Record<Platform, string>>>({})
  const [showOverrides, setShowOverrides] = useState(false)
  const [coverMs, setCoverMs] = useState('')
  const [tt, setTt] = useState<TikTokPostSettings>(emptyTikTokSettings())
  const [ai, setAi] = useState<Record<Platform, boolean>>({
    youtube: false,
    facebook: false,
    instagram: false,
    tiktok: false,
    bluesky: false,
    x: false,
    linkedin: false,
    pinterest: false,
  })
  /** One time for each platform. Each starts on its own next open slot, and any of them can be any time at all. */
  const [times, setTimes] = useState<Partial<Record<Platform, string | null>>>({})
  const timeList = platforms.map((p) => times[p]).filter((x): x is string => !!x)
  const when = timeList.length ? timeList.reduce((a, b) => (a < b ? a : b)) : null
  const allTimed = platforms.length > 0 && timeList.length === platforms.length
  const [heads, setHeads] = useState<string[] | null>(null)
  const { data: defaults } = useLoad(
    () => (brandId ? api.brands.getDefaults(brandId) : Promise.resolve(null)),
    [brandId],
  )
  const { data: sets } = useLoad(
    () => (brandId ? api.hashtags.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const brand = brands?.find((b) => b.id === brandId)
  const { data: accounts } = useLoad(
    () => (brandId ? api.accounts.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const ttAccount = accounts?.find((a) => a.platform === 'tiktok')
  const ttLive =
    platforms.includes('tiktok') &&
    !!ttAccount &&
    ttAccount.mode !== 'dry_run' &&
    ttAccount.status === 'connected'
  const ttDirect = ttLive && ttAccount?.mode === 'direct'
  const creator = useCreator(brandId, ttLive)
  const picked = useRef(false)

  useEffect(() => {
    if (brands?.length && brandId === null) setBrandId(brands[0].id)
  }, [brands, brandId])

  // When the brand changes: reset the things that come from brand defaults.
  // Only when a different brand's defaults arrive. A background reload of the same brand must not wipe what you chose.
  const defaultsFor = useRef<number | null>(null)
  useEffect(() => {
    if (!defaults || defaultsFor.current === defaults.brandId) return
    defaultsFor.current = defaults.brandId
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
  const labels = platforms.map((p) => PLATFORM_LABELS[p])
  const ttProblem = ttDirect
    ? tiktokSettingsProblem(tt, creator.info, source?.meta.durationSeconds ?? 0)
    : null
  const canSchedule =
    !!source && !!brandId && platforms.length > 0 && allTimed && title.trim().length > 0 && !ttProblem

  /** A hand picked time that breaks a rule shows a plain warning first. Josh can still go ahead. */
  async function trySchedule() {
    if (!brandId || !when) return
    // Every distinct time is checked. Slots pass quietly, a time that breaks a rule gets a plain warning first.
    const heads: string[] = []
    for (const t of [...new Set(timeList)]) {
      const warnings = await run(() => api.slots.checkTime(brandId, t))
      for (const w of warnings ?? []) if (!heads.includes(w)) heads.push(w)
    }
    if (heads.length) return setHeads(heads)
    await save('scheduled')
  }

  async function save(status: 'draft' | 'scheduled') {
    if (!source || !brandId) return
    const created = await run(() =>
      api.posts.create({
        brandId,
        sourcePath: source.sourcePath,
        title: title.trim(),
        caption,
        firstComment: firstComment.trim() || null,
        scheduledAtUtc: when,
        status,
        targets: platforms.map((p) => ({
          platform: p,
          scheduledAtUtc: times[p] ?? null,
          aiFlag: ai[p],
          captionOverride: overrides[p] ?? null,
          settings:
            p === 'instagram' && coverMs !== ''
              ? { thumbOffsetMs: Number(coverMs) }
              : p === 'tiktok' && ttDirect
                ? { tiktok: tt }
                : undefined,
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
      <PageHeader title={COPY.nav.schedule} />
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
                    setTimes({})
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
            <div className="mt-4">
              <Field label="First comment" hint="Optional. A question or call to action that ELO posts as the first comment as soon as the video is live. It goes through Upload-Post, on the platforms ticked for this channel in AI Settings. Instagram cannot take one.">
                <Textarea
                  value={firstComment}
                  onChange={(e) => setFirstComment(e.target.value)}
                  rows={2}
                  placeholder="Which one would you try first?"
                />
              </Field>
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
            {platforms.includes('instagram') && (
              <div className="mt-4 max-w-sm">
                <Field label="Instagram cover frame (milliseconds from the start, optional)">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Example: 1500"
                    value={coverMs}
                    onChange={(e) => setCoverMs(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex flex-wrap items-start gap-2">
                <Suggest
                  kind="title"
                  brandId={brandId}
                  title={title}
                  caption={caption}
                  onPick={(t) => setTitle(t)}
                />
                <Suggest
                  kind="caption"
                  brandId={brandId}
                  title={title}
                  caption={caption}
                  onPick={(t) => {
                    setCaption(t)
                    setCaptionTouched(true)
                  }}
                />
                <Suggest
                  kind="hashtags"
                  brandId={brandId}
                  title={title}
                  caption={caption}
                  onPick={(t) => {
                    setCaption((c) => `${c.trim()}${c.trim() ? '\n\n' : ''}${t}`)
                    setCaptionTouched(true)
                  }}
                />
              </div>
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

          {ttLive && (
            <Card title="TikTok">
              {ttDirect ? (
                <TikTokSection
                  info={creator.info}
                  loading={creator.loading}
                  error={creator.error}
                  value={tt}
                  onChange={setTt}
                  durationSeconds={source?.meta.durationSeconds ?? 0}
                  aiFlag={ai.tiktok}
                />
              ) : (
                <div className="space-y-2 text-[13px]">
                  <PostingAs info={creator.info} />
                  <p className="text-muted">
                    Drafts mode: the video goes to the TikTok inbox. You choose privacy, comments,
                    Duet, Stitch and the AI label in the TikTok app before you post.
                  </p>
                </div>
              )}
            </Card>
          )}

          <Card>
            <Field label="When (Eastern time)">
              <div className="mb-2 text-[12px] text-muted">
                Each platform has its own time. It starts on that platform's next open slot. Change any of them to
                another open slot, or choose Pick a different time to use any date and time you like.
              </div>
              <PlatformTimes
                key={brandId ?? 0}
                brandId={brandId}
                platforms={platforms}
                kind={slotKindFor(source?.meta)}
                value={times}
                onChange={setTimes}
                initialAll={initialWhen}
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
              onClick={() => void trySchedule()}
              aria-label={COPY.scheduleTooltip(labels, formatEastern(when))}
              title={COPY.scheduleTooltip(labels, formatEastern(when))}
            >
              {COPY.publishButton}
            </Button>
          </div>
          {heads && (
            <Confirm
              title="Check this time"
              message={`${heads.join(' ')} Do you want to schedule it anyway?`}
              confirmLabel="Schedule anyway"
              onCancel={() => setHeads(null)}
              onConfirm={() => {
                setHeads(null)
                void save('scheduled')
              }}
            />
          )}
          {ttLive && creator.info && (
            <div className="flex justify-end">
              <PostingAs info={creator.info} />
            </div>
          )}
          {ttProblem && (
            <div className="text-right text-[12px] font-semibold text-warn">
              TikTok: {ttProblem}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
