import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import type { Brand, BrandDefaults, BrandSlot, HashtagSet } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
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
        <div className="mt-3">
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
  const [slots, setSlots] = useState<SlotDraft[]>([])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (data) {
      setSlots(data.map(({ dayType, timeLocal, enabled }) => ({ dayType, timeLocal, enabled })))
      setDirty(false)
    }
  }, [data])
  const update = (next: SlotDraft[]) => {
    setSlots(next)
    setDirty(true)
  }

  const list = (type: 'weekday' | 'weekend', label: string) => (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="space-y-2">
        {slots.map((s, i) =>
          s.dayType !== type ? null : (
            <div key={i} className="flex items-center gap-2">
              <Input
                type="time"
                className="w-36"
                value={s.timeLocal}
                onChange={(e) =>
                  update(slots.map((x, j) => (j === i ? { ...x, timeLocal: e.target.value } : x)))
                }
                aria-label={`${label} time`}
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
              setDirty(false)
              toast({ kind: 'success', headline: COPY.success, detail: 'Slots saved.' })
            }
          }}
        >
          Save slots
        </Button>
      }
    >
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
  const [d, setD] = useState<BrandDefaults | null>(null)
  useEffect(() => {
    if (data) setD(data)
  }, [data])
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
            {YT_CATEGORIES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2">
          <Check checked={d.youtubeMadeForKids} onChange={(v) => set('youtubeMadeForKids', v)}>
            YouTube: made for kids
          </Check>
          <div className="text-[11px] text-muted">
            Leave this off unless the videos are made for kids.
          </div>
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
        <Field label="TikTok defaults" className="md:col-span-2">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Check checked={d.tiktokAllowComments} onChange={(v) => set('tiktokAllowComments', v)}>
              Allow comments
            </Check>
            <Check checked={d.tiktokAllowDuet} onChange={(v) => set('tiktokAllowDuet', v)}>
              Allow duet
            </Check>
            <Check checked={d.tiktokAllowStitch} onChange={(v) => set('tiktokAllowStitch', v)}>
              Allow stitch
            </Check>
          </div>
        </Field>
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
