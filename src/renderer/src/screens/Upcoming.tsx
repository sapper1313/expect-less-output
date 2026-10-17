import { useMemo, useState } from 'react'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import { UPCOMING_STATUSES, type UpcomingRow } from '@shared/upcoming'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import {
  Button,
  Card,
  Dialog,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useBusy,
} from '../ui'

const LABEL: Record<string, string> = {
  idea: 'Idea',
  scripted: 'Scripted',
  queued: 'Queued',
  rendering: 'Rendering',
  'needs-review': 'Needs review',
  dropped: 'Dropped',
}

const sourceOf = (r: UpcomingRow) => (r.source_bot === 'josh' ? 'You' : r.source_bot)
/** The next step forward Josh can take. Dropped is set by ELO when the video arrives. */
const nextStatus = (s: string) => {
  const i = UPCOMING_STATUSES.indexOf(s as (typeof UPCOMING_STATUSES)[number])
  return i >= 0 && i < UPCOMING_STATUSES.length - 2 ? UPCOMING_STATUSES[i + 1] : null
}

export function Upcoming({ openQueue }: { openQueue?: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: view, reload } = useLoad(() => api.upcoming.view())
  const { data: brands } = useLoad(() => api.brands.list())
  const [mode, setMode] = useState<'board' | 'table'>('board')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [bot, setBot] = useState('')
  const [text, setText] = useState('')
  const [group, setGroup] = useState<'none' | 'channel' | 'status'>('none')
  const [sort, setSort] = useState<'updated' | 'id'>('updated')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<UpcomingRow | null>(null)

  const rows = view?.rows ?? []
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source_bot))], [rows])
  const shown = rows
    .filter(
      (r) =>
        (!channel || r.channel === channel) &&
        (!status || r.status === status) &&
        (!bot || r.source_bot === bot),
    )
    .filter(
      (r) =>
        !text.trim() ||
        `${r.working_title} ${r.premise} ${r.episode_id}`
          .toLowerCase()
          .includes(text.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'id'
        ? a.episode_id.localeCompare(b.episode_id)
        : b.updated_at.localeCompare(a.updated_at),
    )
  const pinned = shown.filter((r) => r.readOnly)

  const done = (r: unknown, msg: string) => {
    if (r !== undefined) toast({ kind: 'success', headline: COPY.success, detail: msg })
    reload()
  }

  const Card1 = ({ r }: { r: UpcomingRow }) => (
    <button
      onClick={() => setEditing(r)}
      className="block w-full rounded-lg border border-line bg-surface p-3 text-left hover:bg-surface2"
      style={{ borderLeft: `4px solid ${r.channelColor}` }}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <b className="text-ink">{r.channelName}</b>
        {r.paused && (
          <span className="rounded border border-warn px-1 font-bold uppercase text-warn">
            paused
          </span>
        )}
        {r.conflict && (
          <span className="rounded border border-bad px-1 font-bold uppercase text-bad">
            conflict
          </span>
        )}
      </div>
      <div className="mt-1 text-[14px] font-semibold">{r.working_title}</div>
      {r.premise && <div className="mt-1 line-clamp-2 text-[12px] text-muted">{r.premise}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{sourceOf(r)}</span>
        <span>updated {formatEastern(r.updated_at, false)}</span>
        {r.drop_id && (
          <span className="rounded bg-surface2 px-1 font-semibold text-ink">drop linked</span>
        )}
      </div>
    </button>
  )

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title="Upcoming">
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add idea
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            const n = await run(() => api.upcoming.moveStudioIdeas())
            if (n !== undefined)
              done(
                n,
                n
                  ? `Moved ${n} Studio idea(s) into Upcoming.`
                  : 'There were no new Studio ideas to move.',
              )
          }}
        >
          Move my Studio ideas into Upcoming
        </Button>
      </PageHeader>
      <div className="space-y-4 px-8">
        <p className="max-w-3xl text-[13px] text-muted">
          Every episode in flight, before any script or video exists. Bots add and move their own
          entries here, you add your own ideas, and ELO marks an entry dropped when its finished
          video arrives with the exact same episode id.
        </p>
        {view?.invalidReason && (
          <Card>
            <div className="text-[13px] font-semibold text-bad">
              upcoming.json is invalid, keeping the last good copy.
            </div>
            <div className="text-[12px] text-muted">{view.invalidReason}</div>
          </Card>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {(['board', 'table'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${mode === m ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
              >
                {m === 'board' ? 'Board' : 'Table'}
              </button>
            ))}
          </div>
          <Input
            className="w-56"
            aria-label="Search"
            placeholder="Search"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Select
            className="w-52"
            aria-label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">All channels</option>
            {brands
              ?.filter((b) => b.slug)
              .map((b) => (
                <option key={b.id} value={b.slug!}>
                  {b.name}
                </option>
              ))}
          </Select>
          <Select
            className="w-40"
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {UPCOMING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            className="w-40"
            aria-label="Source"
            value={bot}
            onChange={(e) => setBot(e.target.value)}
          >
            <option value="">Any source</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s === 'josh' ? 'You (josh)' : s}
              </option>
            ))}
          </Select>
          {mode === 'table' && (
            <>
              <Select
                className="w-40"
                aria-label="Group"
                value={group}
                onChange={(e) => setGroup(e.target.value as typeof group)}
              >
                <option value="none">No grouping</option>
                <option value="channel">Group by channel</option>
                <option value="status">Group by status</option>
              </Select>
              <Select
                className="w-40"
                aria-label="Sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="updated">Sort by updated</option>
                <option value="id">Sort by episode id</option>
              </Select>
            </>
          )}
        </div>

        {pinned.length > 0 && (
          <div className="space-y-2 rounded-lg border border-bad p-3">
            <div className="text-[12px] font-bold uppercase text-bad">
              Needs a look (read only until fixed)
            </div>
            {pinned.map((r) => (
              <div key={`${r.channel}/${r.episode_id}`} className="text-[13px]">
                <b>{r.channelName}</b> {r.episode_id}: {r.working_title}
                {r.conflict_detail && (
                  <div className="text-[12px] text-muted">{r.conflict_detail}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {view?.rows.length === 0 && <Empty>Nothing is planned yet. Click Add idea to start.</Empty>}

        {mode === 'board' && rows.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {UPCOMING_STATUSES.map((s) => (
              <div key={s} className="min-w-0 space-y-2">
                <div className="flex items-center justify-between text-[12px] font-bold uppercase tracking-wider text-muted">
                  {LABEL[s]}
                  <span>{shown.filter((r) => r.status === s).length}</span>
                </div>
                {shown
                  .filter((r) => r.status === s)
                  .map((r) => (
                    <Card1 key={`${r.channel}/${r.episode_id}`} r={r} />
                  ))}
              </div>
            ))}
          </div>
        )}

        {mode === 'table' && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-surface2 text-[11px] uppercase text-muted">
                <tr>
                  {[
                    'Channel',
                    'Episode id',
                    'Working title',
                    'Premise',
                    'Status',
                    'Source',
                    'Created',
                    'Updated',
                    'Age',
                    'Drop',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(group === 'none' ? [['', shown] as const] : groups(shown, group)).flatMap(
                  ([label, list]) => [
                    label ? (
                      <tr key={`g-${label}`} className="bg-surface2">
                        <td colSpan={10} className="px-3 py-1 font-bold">
                          {label}
                        </td>
                      </tr>
                    ) : null,
                    ...list.map((r) => (
                      <tr
                        key={`${r.channel}/${r.episode_id}`}
                        className="cursor-pointer border-t border-line align-top hover:bg-surface2"
                        onClick={() => setEditing(r)}
                      >
                        <td className="px-3 py-2">{r.channelName}</td>
                        <td className="px-3 py-2">{r.episode_id}</td>
                        <td className="px-3 py-2 font-semibold">{r.working_title}</td>
                        <td className="max-w-xs px-3 py-2 text-muted">{r.premise}</td>
                        <td className="px-3 py-2">{LABEL[r.status]}</td>
                        <td className="px-3 py-2">{sourceOf(r)}</td>
                        <td className="px-3 py-2">{formatEastern(r.created_at, false)}</td>
                        <td className="px-3 py-2">{formatEastern(r.updated_at, false)}</td>
                        <td className="px-3 py-2">{r.staleDays}d</td>
                        <td className="px-3 py-2">{r.drop_id ? 'linked' : ''}</td>
                      </tr>
                    )),
                  ],
                )}
              </tbody>
            </table>
          </div>
        )}

        <Card title="The shared file">
          <div className="text-[12px] text-muted">
            {view?.filePath}. Revision {view?.revision ?? 0}. If a bot changed an entry it should
            not have, ELO flags it and you can put the file back.
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={async () => {
                const ok = await run(async () => (await api.upcoming.restorePrevious(), true))
                if (ok) done(ok, 'The file was put back to the copy before the last change.')
              }}
            >
              Restore previous
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await run(() => api.upcoming.dismiss())
                reload()
              }}
            >
              Dismiss the flags
            </Button>
          </div>
        </Card>
      </div>

      {adding && (
        <AddDialog
          brands={(brands ?? [])
            .filter((b) => b.slug && !b.archived)
            .map((b) => ({ slug: b.slug as string, name: b.name }))}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
      {editing && (
        <EditDialog
          key={`${editing.channel}/${editing.episode_id}`}
          row={editing}
          live={
            rows.find(
              (r) => r.channel === editing.channel && r.episode_id === editing.episode_id,
            ) ?? editing
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
          openQueue={openQueue}
        />
      )}
    </div>
  )
}

function groups(
  list: UpcomingRow[],
  by: 'channel' | 'status',
): Array<readonly [string, UpcomingRow[]]> {
  const m = new Map<string, UpcomingRow[]>()
  for (const r of list) {
    const k = by === 'channel' ? r.channelName : LABEL[r.status]
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m.entries()]
}

function AddDialog({
  brands,
  onClose,
  onSaved,
}: {
  brands: Array<{ slug: string; name: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [channel, setChannel] = useState(brands[0]?.slug ?? '')
  const [title, setTitle] = useState('')
  const [premise, setPremise] = useState('')
  return (
    <Dialog title="Add an idea" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Channel">
          <Select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Working title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Premise" hint="A sentence or two about the episode.">
          <Textarea value={premise} onChange={(e) => setPremise(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !channel}
            onClick={async () => {
              const r = await run(() =>
                api.upcoming.add({ channel, working_title: title, premise }),
              )
              if (r) {
                toast({ kind: 'success', headline: COPY.success, detail: `Added ${r.episode_id}.` })
                onSaved()
              }
            }}
          >
            Add idea
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function EditDialog({
  row,
  live,
  onClose,
  onSaved,
  openQueue,
}: {
  row: UpcomingRow
  live: UpcomingRow
  onClose: () => void
  onSaved: () => void
  openQueue?: () => void
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [title, setTitle] = useState(row.working_title)
  const [premise, setPremise] = useState(row.premise)
  const [notes, setNotes] = useState(row.notes)
  const [base, setBase] = useState(row.entry_revision)
  const changedUnderUs = live.entry_revision !== base
  const next = nextStatus(live.status)
  const save = async (extra: Parameters<typeof api.upcoming.patch>[2] = {}) => {
    const r = await run(() =>
      api.upcoming.patch(
        row.channel,
        row.episode_id,
        { working_title: title, premise, notes, ...extra },
        { entry_revision: base },
      ),
    )
    if (!r) return
    if (r.conflict)
      toast({
        kind: 'error',
        headline: 'Two edits clashed.',
        detail: 'Both versions are kept on the entry. Resolve it on the card.',
      })
    else toast({ kind: 'success', headline: COPY.success, detail: 'Saved.' })
    onSaved()
  }
  return (
    <Dialog title={row.working_title} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="text-[12px] text-muted">
          {row.channelName}, {row.episode_id}. {LABEL[live.status]}. From {sourceOf(row)}.
        </div>
        {changedUnderUs && (
          <div className="rounded-md border border-warn p-2 text-[12px]">
            Updated by {live.updated_by} while you were editing.{' '}
            <button
              className="font-semibold text-accent"
              onClick={() => {
                setTitle(live.working_title)
                setPremise(live.premise)
                setNotes(live.notes)
                setBase(live.entry_revision)
              }}
            >
              Reload
            </button>{' '}
            to see their version, or save to keep yours as a conflict note.
          </div>
        )}
        {live.conflict && (
          <div className="rounded-md border border-bad p-2 text-[12px]">
            <b>Conflict.</b> {live.conflict_detail}
            <div className="mt-2">
              <Button disabled={busy} onClick={() => save({ clear_conflict: true })}>
                Resolve (keep what is shown)
              </Button>
            </div>
          </div>
        )}
        <Field label="Working title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={live.status === 'dropped'}
          />
        </Field>
        <Field label="Premise">
          <Textarea
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            disabled={live.status === 'dropped'}
          />
        </Field>
        <Field label="Notes" hint="Say why when you move an entry back.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(row.episode_id)
              toast({ kind: 'success', headline: 'Copied.', detail: row.episode_id })
            }}
          >
            Copy episode id
          </Button>
          {live.script_path && (
            <Button onClick={() => void api.upcoming.openScript(live.script_path as string)}>
              Open script
            </Button>
          )}
          {live.postId && openQueue && <Button onClick={openQueue}>Open in Queue</Button>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          {live.status !== 'dropped' && next && (
            <Button disabled={busy} onClick={() => save({ status: next })}>
              Move to {LABEL[next]}
            </Button>
          )}
          {live.status !== 'dropped' && live.status !== 'idea' && (
            <Button
              disabled={busy || !notes.trim() || notes === live.notes}
              title="Add a note first saying why"
              onClick={() =>
                save({
                  status:
                    UPCOMING_STATUSES[Math.max(0, UPCOMING_STATUSES.indexOf(live.status) - 1)],
                })
              }
            >
              Move back
            </Button>
          )}
          {live.status !== 'dropped' && (
            <Button variant="primary" disabled={busy} onClick={() => save()}>
              Save
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
