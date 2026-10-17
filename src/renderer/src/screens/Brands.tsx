import { useMemo, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import type { Brand, BrandDefaults, BrandSlot, HashtagSet } from '@shared/types'
import { api } from '../api'
import { useApp, useDraft, useLoad } from '../hooks'
import { DateList } from './PipelineSettings'
import {
  Button,
  Card,
  Check,
  Confirm,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useBusy,
  TimeSelect,
} from '../ui'

const YT_CATEGORIES: Array<[string, string]> = [
  ['1', 'Film and Animation'],
  ['10', 'Music'],
  ['20', 'Gaming'],
  ['22', 'People and Blogs'],
  ['23', 'Comedy'],
  ['24', 'Entertainment'],
  ['25', 'News and Politics'],
  ['26', 'Howto and Style'],
  ['27', 'Education'],
  ['28', 'Science and Technology'],
]
type SlotDraft = Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'>

export function Brands() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [showArchived, setShowArchived] = useState(false)
  const { data: brands } = useLoad(() => api.brands.list(showArchived), [showArchived])
  const [selId, setSelId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#D9734E')
  const sel = brands?.find((b) => b.id === selId) ?? brands?.[0] ?? null

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.brands}>
        <Check checked={showArchived} onChange={setShowArchived}>
          Show archived
        </Check>
      </PageHeader>
      <div className="grid gap-5 px-8 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="space-y-1">
            {brands?.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelId(b.id)}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${sel?.id === b.id ? 'border-accent bg-surface' : 'border-line hover:bg-surface'} ${b.archived ? 'opacity-50' : ''}`}
              >
                <span
                  className="h-4 w-4 rounded-full border border-black/30"
                  style={{ background: b.color }}
                />
                <span className="font-semibold">{b.name}</span>
                {b.archived && (
                  <span className="ml-auto text-[10px] uppercase text-muted">archived</span>
                )}
              </button>
            ))}
          </div>
          <Card title="Add a brand">
            <div className="space-y-3">
              <Input
                placeholder="Brand name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Brand color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-9 w-14 rounded border border-line bg-bg"
                />
                <Button
                  variant="primary"
                  disabled={!newName.trim() || busy}
                  onClick={async () => {
                    const b = await run(() => api.brands.create(newName, newColor))
                    if (b) {
                      setSelId(b.id)
                      setNewName('')
                      toast({ kind: 'success', headline: COPY.success, detail: `Added ${b.name}.` })
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </Card>
        </div>
        {sel && <BrandEditor key={sel.id} brand={sel} />}
      </div>
    </div>
  )
}

function BrandEditor({ brand }: { brand: Brand }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [name, setName] = useState(brand.name)
  const [color, setColor] = useState(brand.color)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const { data: settings } = useLoad(() => api.settings.get())
  const paused = !!settings?.pausedBrandIds.includes(brand.id)
  const inboxOn = !!settings?.inboxBrandIds.includes(brand.id)
  const autoOn = !!settings?.inboxAutoScheduleBrandIds.includes(brand.id)

  return (
    <div className="space-y-4">
      <Card title="Brand">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Color">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 rounded border border-line bg-bg"
            />
          </Field>
          <Button
            variant="primary"
            disabled={busy || (name === brand.name && color === brand.color)}
            onClick={async () => {
              if (await run(() => api.brands.update(brand.id, { name, color })))
                toast({ kind: 'success', headline: COPY.success, detail: 'Brand saved.' })
            }}
          >
            Save
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <Check
              checked={paused}
              onChange={(v) => run(() => api.studio.setBrand(brand.id, { paused: v }))}
            >
              Pause this brand
            </Check>
            <div className="ml-6 text-[12px] text-muted">
              The one place to pause or resume this channel. Posts stay scheduled but nothing goes
              out, and the Studio stops writing and making episodes for it. When you resume, a post
              that is less than your grace time late goes out; older ones are held as missed.
            </div>
          </div>
          <div>
            <Check
              checked={inboxOn}
              onChange={(v) =>
                run(() =>
                  api.settings.set({
                    inboxBrandIds: v
                      ? [...(settings?.inboxBrandIds ?? []), brand.id]
                      : (settings?.inboxBrandIds ?? []).filter((id) => id !== brand.id),
                  }),
                )
              }
            >
              Watch this brand's Inbox folder
            </Check>
            <div className="ml-6 text-[12px] text-muted">
              Drop a video (and an optional .json file with the same name) into the brand's Inbox
              folder inside the Media Root and a post is made for you. See the guide.
            </div>
            <div className="ml-6 mt-2">
              <Check
                checked={autoOn}
                onChange={(v) =>
                  run(() =>
                    api.settings.set({
                      inboxAutoScheduleBrandIds: v
                        ? [...(settings?.inboxAutoScheduleBrandIds ?? []), brand.id]
                        : (settings?.inboxAutoScheduleBrandIds ?? []).filter(
                            (id) => id !== brand.id,
                          ),
                    }),
                  )
                }
              >
                Schedule Inbox videos automatically (next open slot)
              </Check>
              <div className="ml-6 text-[12px] text-muted">
                A video dropped in the Inbox goes live at the next open slot with no review. Leave
                this off to get drafts you check first. This applies to every Inbox video, including
                finished videos from the bot pipeline.
                {autoOn && !settings?.agentMaySchedule && (
                  <span className="text-warn">
                    {' '}
                    This does nothing yet. Untick "Agents may create drafts only" in Settings.
                  </span>
                )}
              </div>
            </div>
          </div>
          {brand.archived ? (
            <Button onClick={() => run(() => api.brands.archive(brand.id, false))}>
              Restore brand
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmArchive(true)}>
              Archive brand
            </Button>
          )}
        </div>
      </Card>
      <PipelineRules brand={brand} />
      <SlotEditor brandId={brand.id} />
      <DefaultsEditor brandId={brand.id} />
      <HashtagEditor brandId={brand.id} />
      {confirmArchive && (
        <Confirm
          title="Archive this brand?"
          message={COPY.confirm.archiveBrand}
          confirmLabel="Archive"
          danger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            await run(() => api.brands.archive(brand.id, true))
            setConfirmArchive(false)
          }}
        />
      )}
    </div>
  )
}

function SlotEditor({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data } = useLoad(() => api.brands.getSlots(brandId), [brandId])
  const { data: rec } = useLoad(() => api.stats.recommendedSlots(brandId), [brandId])
  const fresh = useMemo<SlotDraft[] | null>(
    () =>
      data
        ? data.map(({ dayType, timeLocal, enabled }) => ({ dayType, timeLocal, enabled }))
        : null,
    [data],
  )
  const { draft, setDraft, dirty } = useDraft<SlotDraft[]>(fresh, brandId)
  const slots = draft ?? []
  const update = (next: SlotDraft[]) => {
    setDraft(next)
  }

  const suggestions = (type: 'weekday' | 'weekend') => {
    const picks = (type === 'weekday' ? rec?.weekday : rec?.weekend) ?? []
    if (picks.length === 0) return null
    return (
      <div className="mb-3 rounded-md border border-line p-2 text-[12px]">
        <div className="mb-1 font-semibold">Recommended</div>
        {picks.map((p) => {
          const have = slots.some((s) => s.dayType === type && s.timeLocal === p.timeLocal)
          return (
            <div key={p.timeLocal} className="flex items-center justify-between gap-2 py-0.5">
              <span>
                <b>{p.timeLocal}</b>{' '}
                <span className="text-muted">
                  {p.lift >= 1
                    ? `${Math.round((p.lift - 1) * 100)}% above typical`
                    : `${Math.round((1 - p.lift) * 100)}% below typical`}
                  , {p.count} videos
                </span>
              </span>
              <Button
                disabled={have}
                onClick={() =>
                  update([...slots, { dayType: type, timeLocal: p.timeLocal, enabled: true }])
                }
              >
                {have ? 'Added' : 'Add'}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  const list = (type: 'weekday' | 'weekend', label: string) => (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      {suggestions(type)}
      <div className="space-y-2">
        {slots.map((s, i) =>
          s.dayType !== type ? null : (
            <div key={i} className="flex items-center gap-2">
              <TimeSelect
                value={s.timeLocal}
                onChange={(v) =>
                  update(slots.map((x, j) => (j === i ? { ...x, timeLocal: v } : x)))
                }
                label={`${label} time`}
              />
              <Check
                checked={s.enabled}
                onChange={(v) => update(slots.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
              >
                On
              </Check>
              <button
                className="text-muted hover:text-bad"
                aria-label="Remove this time"
                onClick={() => update(slots.filter((_, j) => j !== i))}
              >
                x
              </button>
            </div>
          ),
        )}
        <Button
          onClick={() =>
            update([
              ...slots,
              { dayType: type, timeLocal: type === 'weekday' ? '12:00' : '12:00', enabled: true },
            ])
          }
        >
          Add time
        </Button>
      </div>
    </div>
  )

  return (
    <Card
      title="Posting slots (Eastern time)"
      actions={
        <Button
          variant="primary"
          disabled={!dirty || busy}
          onClick={async () => {
            if (await run(() => api.brands.setSlots(brandId, slots))) {
              toast({ kind: 'success', headline: COPY.success, detail: 'Slots saved.' })
            }
          }}
        >
          Save slots
        </Button>
      }
    >
      <div className="mb-3 text-[12px] text-muted">
        {rec && !rec.enough ? COPY.stats.slotNotEnough : COPY.stats.slotNote} A new post can take
        the next open time here, and the Studio posts its episodes at the first time of the day.
        Which days the Studio posts is set under Studio settings per channel.
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {list('weekday', 'Weekdays (Mon to Fri)')}
        {list('weekend', 'Weekends (Sat and Sun)')}
      </div>
    </Card>
  )
}

function DefaultsEditor({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data } = useLoad(() => api.brands.getDefaults(brandId), [brandId])
  const { data: sets } = useLoad(() => api.hashtags.list(brandId), [brandId])
  const { data: categories } = useLoad(() => api.youtube.categories())
  const { data: playlists } = useLoad(
    () => api.youtube.playlists(brandId).catch(() => []),
    [brandId],
  )
  const { draft: d, setDraft: setD } = useDraft<BrandDefaults>(data, brandId)
  if (!d) return null
  const set = <K extends keyof BrandDefaults>(k: K, v: BrandDefaults[K]) => setD({ ...d, [k]: v })
  return (
    <Card
      title="Defaults for new posts"
      actions={
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            if (await run(() => api.brands.setDefaults(d)))
              toast({ kind: 'success', headline: COPY.success, detail: 'Defaults saved.' })
          }}
        >
          Save defaults
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Caption template"
          hint="Tokens: {title} {hashtags} {brand}"
          className="md:col-span-2"
        >
          <Textarea
            rows={3}
            value={d.captionTemplate}
            onChange={(e) => set('captionTemplate', e.target.value)}
          />
        </Field>
        <Field label="Default hashtag set">
          <Select
            value={d.defaultHashtagSetId ?? ''}
            onChange={(e) =>
              set('defaultHashtagSetId', e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">None</option>
            {sets?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="YouTube category">
          <Select
            value={d.youtubeCategoryId}
            onChange={(e) => set('youtubeCategoryId', e.target.value)}
          >
            {(categories ?? YT_CATEGORIES.map(([id, title]) => ({ id, title }))).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            {categories && !categories.some((c) => c.id === d.youtubeCategoryId) && (
              <option value={d.youtubeCategoryId}>Category {d.youtubeCategoryId}</option>
            )}
          </Select>
        </Field>
        <Field
          label="YouTube playlist"
          hint={
            playlists?.length ? undefined : 'Connect YouTube for this brand to pick a playlist.'
          }
        >
          <Select
            value={d.youtubePlaylistId ?? ''}
            onChange={(e) => set('youtubePlaylistId', e.target.value || null)}
          >
            <option value="">No playlist</option>
            {playlists?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
            {d.youtubePlaylistId && !playlists?.some((p) => p.id === d.youtubePlaylistId) && (
              <option value={d.youtubePlaylistId}>{d.youtubePlaylistId}</option>
            )}
          </Select>
        </Field>
        <div className="space-y-2">
          <Check checked={d.youtubeMadeForKids} onChange={(v) => set('youtubeMadeForKids', v)}>
            YouTube: made for kids
          </Check>
          <div className="text-[11px] text-muted">
            Leave this off unless the videos are made for kids.
          </div>
          <Check checked={d.youtubeAppendShorts} onChange={(v) => set('youtubeAppendShorts', v)}>
            YouTube: append #Shorts to the description
          </Check>
        </div>
        <div className="space-y-2">
          <Check checked={d.instagramShareToFeed} onChange={(v) => set('instagramShareToFeed', v)}>
            Instagram: also share Reels to the main feed
          </Check>
        </div>
        <Field label="Made with AI by default">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PLATFORMS.map((p) => (
              <Check
                key={p}
                checked={d.aiFlag[p]}
                onChange={(v) => set('aiFlag', { ...d.aiFlag, [p]: v })}
              >
                {PLATFORM_LABELS[p]}
              </Check>
            ))}
          </div>
        </Field>
        <div className="text-[12px] text-muted md:col-span-2">
          TikTok has no brand defaults on purpose. TikTok's rules say privacy and comment, Duet and
          Stitch choices must be made on every post, with nothing pre-selected.
        </div>
      </div>
    </Card>
  )
}

function HashtagEditor({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.hashtags.list(brandId), [brandId])
  const [edit, setEdit] = useState<(Omit<HashtagSet, 'id'> & { id?: number }) | null>(null)
  const [del, setDel] = useState<HashtagSet | null>(null)
  return (
    <Card
      title="Hashtag sets"
      actions={
        <Button onClick={() => setEdit({ brandId, name: '', tagsText: '' })}>New set</Button>
      }
    >
      <div className="space-y-2">
        {data?.length === 0 && (
          <div className="text-muted">
            No sets yet. Make one so captions can fill in hashtags for you.
          </div>
        )}
        {data?.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-3 rounded-md border border-line p-3"
          >
            <div>
              <div className="font-semibold">
                {s.name}{' '}
                {s.brandId === null && (
                  <span className="text-[11px] font-normal text-muted">(all brands)</span>
                )}
              </div>
              <div className="text-[12px] text-muted">{s.tagsText || 'Empty'}</div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setEdit(s)}>Edit</Button>
              <Button variant="danger" onClick={() => setDel(s)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <div className="mt-4 space-y-3 rounded-md border border-accent p-3">
          <Field label="Set name">
            <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Hashtags" hint="Example: #trashpanda #shorts #funny">
            <Textarea
              rows={2}
              value={edit.tagsText}
              onChange={(e) => setEdit({ ...edit, tagsText: e.target.value })}
            />
          </Field>
          <Check
            checked={edit.brandId === null}
            onChange={(v) => setEdit({ ...edit, brandId: v ? null : brandId })}
          >
            Available to all brands
          </Check>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!edit.name.trim() || busy}
              onClick={async () => {
                if (await run(() => api.hashtags.save(edit))) {
                  setEdit(null)
                  reload()
                  toast({ kind: 'success', headline: COPY.success, detail: 'Hashtag set saved.' })
                }
              }}
            >
              Save set
            </Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {del && (
        <Confirm
          title="Delete this hashtag set?"
          message={`"${del.name}" will be removed. Brands that used it as their default will have no default set.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            await run(() => api.hashtags.remove(del.id))
            setDel(null)
            reload()
          }}
        />
      )}
    </Card>
  )
}

/** The limits that belong to one channel: its slug, how many posts a day, days it never posts, and how low the queue may run. */
function PipelineRules({ brand }: { brand: Brand }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: rules, reload } = useLoad(() => api.pipeline.channelRules(brand.id), [brand.id])
  const [slug, setSlug] = useState(brand.slug ?? '')
  if (!rules) return null
  const save = async (patch: Parameters<typeof api.pipeline.setChannelRules>[1]) => {
    if (await run(() => api.pipeline.setChannelRules(brand.id, patch))) reload()
  }
  return (
    <Card title="Pipeline rules">
      <p className="mb-3 text-[13px] text-muted">
        These control where the next open slot lands. A daily limit of 1 means only the first slot
        of each day is used, even if you have more times set below.
      </p>
      <div className="grid items-end gap-4 md:grid-cols-[1fr_auto]">
        <Field
          label="Slug"
          hint="The short name bots use in a sidecar, for example clock-out-early."
        >
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Button
          disabled={busy || slug === (brand.slug ?? '')}
          onClick={async () => {
            if (await run(() => api.brands.update(brand.id, { slug })))
              toast({ kind: 'success', headline: COPY.success, detail: 'Slug saved.' })
          }}
        >
          Save slug
        </Button>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <Field label="Most posts a day" hint="0 means no limit.">
          <Select
            aria-label="Most posts a day"
            value={rules.maxPerDay}
            onChange={(e) => void save({ maxPerDay: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No limit' : n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Low queue alert (days)" hint="Blank uses the setting for every channel.">
          <Select
            aria-label="Low queue alert"
            value={rules.lowQueueDays ?? ''}
            onChange={(e) =>
              void save({ lowQueueDays: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">Same as every channel</option>
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <DateList
          label="Days this channel never posts"
          dates={rules.blackoutDates}
          onChange={(d) => void save({ blackoutDates: d })}
        />
      </div>
    </Card>
  )
}
