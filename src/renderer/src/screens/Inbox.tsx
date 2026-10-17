import { useState } from 'react'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { DropRow, InboxItem } from '@shared/pipeline'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Dialog, Empty, Select, Textarea, PageHeader, useBusy } from '../ui'

type Tab = 'waiting' | 'held' | 'rejected' | 'log' | 'issues'
const TABS: Array<[Tab, string]> = [
  ['waiting', 'Waiting'],
  ['held', 'Held'],
  ['rejected', 'Rejected'],
  ['log', 'Log'],
  ['issues', 'Issues'],
]

const mins = (s: number | null) =>
  s === null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function Inbox() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [tab, setTab] = useState<Tab>('waiting')
  const [channel, setChannel] = useState('')
  const [bot, setBot] = useState('')
  const [status, setStatus] = useState('')
  const { data: counts, reload: reloadCounts } = useLoad(() => api.pipeline.counts())
  const { data: waiting, reload: reloadWaiting } = useLoad(() => api.pipeline.waiting())
  const { data: held, reload: reloadHeld } = useLoad(() => api.pipeline.held())
  const { data: rejected } = useLoad(() => api.pipeline.rejected())
  const { data: log } = useLoad(
    () =>
      api.pipeline.log({
        channel: channel || undefined,
        bot: bot || undefined,
        result: (status || undefined) as DropRow['result'] | undefined,
      }),
    [channel, bot, status],
  )
  const { data: issues, reload: reloadIssues } = useLoad(() => api.pipeline.issues())
  const [picking, setPicking] = useState<InboxItem | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [rejecting, setRejecting] = useState<InboxItem | null>(null)
  const [note, setNote] = useState('')
  const [holding, setHolding] = useState<InboxItem | null>(null)

  const reloadAll = () => {
    reloadCounts()
    reloadWaiting()
    reloadHeld()
    reloadIssues()
  }
  const say = (r: { ok: boolean; message: string }) =>
    toast({
      kind: r.ok ? 'success' : 'error',
      headline: r.ok ? COPY.success : 'Not done.',
      detail: r.message,
    })

  const rows = (tab === 'waiting' ? waiting : held) ?? []
  const filtered = rows.filter(
    (r) => (!channel || r.channel === channel) && (!bot || r.sourceBot === bot),
  )
  const channels = [
    ...new Set([...(waiting ?? []), ...(held ?? [])].map((r) => r.channel).filter(Boolean)),
  ] as string[]
  const bots = [
    ...new Set([...(waiting ?? []), ...(held ?? [])].map((r) => r.sourceBot).filter(Boolean)),
  ] as string[]

  const tabLabel = (id: Tab, label: string) => {
    const n =
      id === 'waiting'
        ? counts?.waiting
        : id === 'held'
          ? counts?.held
          : id === 'issues'
            ? counts?.issues
            : 0
    return (
      <>
        {label}
        {!!n && (
          <span className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {n}
          </span>
        )}
      </>
    )
  }

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.inbox}>
        {tab === 'log' && (
          <Button
            onClick={async () => {
              const text = await api.pipeline.logCsv({
                channel: channel || undefined,
                bot: bot || undefined,
              })
              const path = await api.media.saveCsv(
                `ELO drop log ${new Date().toISOString().slice(0, 10)}.csv`,
                text,
              )
              if (path) toast({ kind: 'success', headline: 'Saved.', detail: path })
            }}
          >
            Export CSV
          </Button>
        )}
        {tab === 'issues' && (
          <Button
            disabled={busy}
            onClick={async () => {
              await run(() => api.pipeline.reconcileNow())
              reloadAll()
            }}
          >
            Reconcile now
          </Button>
        )}
      </PageHeader>
      <div className="space-y-4 px-8">
        <p className="max-w-3xl text-[13px] text-muted">
          Videos that bots drop in a channel's Inbox folder land here. The schedule is the one you
          set in the app. A video waits when the channel is paused, has no connected account, or has
          automatic scheduling off.
        </p>
        <div className="flex flex-wrap gap-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
            >
              {tabLabel(id, label)}
            </button>
          ))}
        </div>

        {(tab === 'waiting' || tab === 'held' || tab === 'log') && (
          <div className="flex flex-wrap items-end gap-3">
            <Select
              className="w-52"
              aria-label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">All channels</option>
              {(tab === 'log'
                ? [
                    'trash-panda',
                    'clock-out-early',
                    'teach-your-parents-tech',
                    'math-of-it',
                    'wonder-hollow',
                    'backup-heroes',
                    'complaint-department',
                  ]
                : channels
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select
              className="w-44"
              aria-label="Bot"
              value={bot}
              onChange={(e) => setBot(e.target.value)}
            >
              <option value="">All bots</option>
              {(tab === 'log' ? ['grok-bot', 'kids-comedy', 'beth'] : bots).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {tab === 'log' && (
              <Select
                className="w-44"
                aria-label="Result"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Any result</option>
                {['accepted', 'held', 'rejected', 'duplicate'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        {(tab === 'waiting' || tab === 'held') && (
          <>
            {filtered.length === 0 ? (
              <Empty>
                {tab === 'waiting'
                  ? 'Nothing is waiting. Videos that are scheduled automatically skip this list.'
                  : 'Nothing is held.'}
              </Empty>
            ) : (
              <div className="space-y-2">
                {filtered.map((r) => (
                  <Card key={r.postId}>
                    <div className="flex gap-4">
                      {r.posterUrl ? (
                        <img
                          src={r.posterUrl}
                          alt={`Frame from ${r.title}`}
                          className="h-24 w-16 rounded object-cover"
                        />
                      ) : (
                        <div className="h-24 w-16 rounded bg-surface2" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ background: r.brandColor }}
                            aria-hidden
                          />
                          <b>{r.brandName}</b>
                          {r.paused && (
                            <span className="rounded border border-warn px-1 text-[10px] font-bold uppercase text-warn">
                              paused
                            </span>
                          )}
                          <span className="text-muted">{r.episodeId}</span>
                        </div>
                        <div className="truncate text-[15px] font-semibold">{r.title}</div>
                        <div className="text-[12px] text-muted">
                          From {r.sourceBot ?? 'unknown'}. Dropped {formatEastern(r.droppedAt)}.
                          {r.durationSeconds !== null && ` Length ${mins(r.durationSeconds)}.`}
                        </div>
                        {r.reason && <div className="text-[12px] text-warn">{r.reason}</div>}
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-1">
                        {tab === 'waiting' ? (
                          <>
                            <Button
                              variant="primary"
                              disabled={busy}
                              onClick={async () => {
                                const out = await run(() => api.pipeline.schedule(r.postId))
                                if (out) say(out)
                                reloadAll()
                              }}
                            >
                              Schedule (next slot)
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={async () => {
                                setSlots(await api.pipeline.openSlots(r.postId, 14))
                                setPicking(r)
                              }}
                            >
                              Pick slot
                            </Button>
                            <Button disabled={busy} onClick={() => setHolding(r)}>
                              Hold
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="primary"
                              disabled={busy}
                              onClick={async () => {
                                const out = await run(() => api.pipeline.release(r.postId, false))
                                if (out) say(out)
                                reloadAll()
                              }}
                            >
                              Release
                            </Button>
                            <Button
                              disabled={busy}
                              title="Use the file and title exactly as they are now"
                              onClick={async () => {
                                const out = await run(() => api.pipeline.release(r.postId, true))
                                if (out) say(out)
                                reloadAll()
                              }}
                            >
                              Accept as it is
                            </Button>
                          </>
                        )}
                        <Button variant="danger" disabled={busy} onClick={() => setRejecting(r)}>
                          Reject
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => void api.pipeline.openFile(r.postId)}
                        >
                          Open file
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'rejected' &&
          (rejected?.length ? (
            <DropTable rows={rejected} />
          ) : (
            <Empty>Nothing has been rejected.</Empty>
          ))}
        {tab === 'log' &&
          (log?.length ? <DropTable rows={log} showResult /> : <Empty>No drops yet.</Empty>)}
        {tab === 'issues' &&
          (issues?.length ? (
            <div className="space-y-2">
              {issues.map((i) => (
                <Card key={i.id}>
                  <div className="text-[11px] font-bold uppercase text-muted">
                    {i.kind.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[14px]">{i.detail}</div>
                  <div className="text-[11px] text-muted">
                    First seen {formatEastern(i.firstSeen)}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>Everything adds up. Nothing needs a look.</Empty>
          ))}
      </div>

      {picking && (
        <Dialog title="Pick a slot" onClose={() => setPicking(null)}>
          <p className="mb-3 text-[13px] text-muted">
            These are the open slots for {picking.brandName}. They follow the channel's days, daily
            limit and blackout dates.
          </p>
          <div className="grid max-h-80 gap-1 overflow-auto">
            {slots.map((s) => (
              <Button
                key={s}
                disabled={busy}
                onClick={async () => {
                  const p = picking
                  setPicking(null)
                  const out = await run(() => api.pipeline.pickSlot(p.postId, s))
                  if (out) say(out)
                  reloadAll()
                }}
              >
                {formatEastern(s)}
              </Button>
            ))}
            {!slots.length && (
              <Empty>This channel has no open slots. Add slot times on Channel setup.</Empty>
            )}
          </div>
        </Dialog>
      )}
      {holding && (
        <Dialog title="Hold this video" onClose={() => setHolding(null)}>
          <p className="mb-3 text-[13px] text-muted">
            A held video is never posted until you release it.
          </p>
          <Textarea
            aria-label="Why"
            placeholder="Why are you holding it? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setHolding(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const h = holding
                setHolding(null)
                await run(() => api.pipeline.hold(h.postId, note))
                setNote('')
                reloadAll()
              }}
            >
              Hold it
            </Button>
          </div>
        </Dialog>
      )}
      {rejecting && (
        <Dialog title="Reject this video" onClose={() => setRejecting(null)}>
          <p className="mb-3 text-[13px] text-muted">
            The video is taken out of the queue. The file stays in the channel's Queue folder, and
            your note goes in the drop log.
          </p>
          <Textarea
            aria-label="Note"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const r = rejecting
                setRejecting(null)
                await run(() => api.pipeline.reject(r.postId, note))
                setNote('')
                reloadAll()
              }}
            >
              Reject
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function DropTable({ rows, showResult }: { rows: DropRow[]; showResult?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-surface2 text-[11px] uppercase text-muted">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Channel</th>
            <th className="px-3 py-2">Episode</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Bot</th>
            {showResult && <th className="px-3 py-2">Result</th>}
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2">Slot</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dropId} className="border-t border-line align-top">
              <td className="px-3 py-2">{formatEastern(r.receivedAt)}</td>
              <td className="px-3 py-2">{r.channel}</td>
              <td className="px-3 py-2">{r.episodeId}</td>
              <td className="px-3 py-2">{r.title ?? r.fileName}</td>
              <td className="px-3 py-2">{r.sourceBot}</td>
              {showResult && <td className="px-3 py-2 font-semibold">{r.result}</td>}
              <td className="max-w-xs px-3 py-2 text-muted">{r.reason}</td>
              <td className="px-3 py-2">{r.scheduledSlot ? formatEastern(r.scheduledSlot) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
