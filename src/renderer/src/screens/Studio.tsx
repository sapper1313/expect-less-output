import { useState } from 'react'
import { formatEastern } from '@shared/time'
import { describeFlag } from '@shared/studio/flagText'
import type { DirectorActionView } from '../../../main/studio/directorChat'
import { api } from '../api'
import { useApp, useLoad, useWritingOff } from '../hooks'
import { Button, Card, Check, Empty, PageHeader, PlatformLogo, Select, Textarea, useBusy } from '../ui'
import { StudioBible } from './StudioBible'
import { StudioPublishing } from './StudioPublishing'
import { StudioLibrary } from './StudioLibrary'
import { StudioResearch } from './StudioResearch'

export type Tab =
  | 'overview'
  | 'bible'
  | 'library'
  | 'publishing'
  | 'research'
  | 'log'
  | 'flagged'
/** In the order the work happens: look, plan, make, check, publish, then the record. */
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['research', 'Research'],
  ['bible', 'Bible'],
  ['library', 'Library'],
  ['flagged', 'Flagged'],
  ['publishing', 'Publishing'],
  ['log', "Director's Log"],
]

export function Studio({ initialTab = 'overview' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { data: ov, reload } = useLoad(() => api.studio.overview())
  const writingOff = useWritingOff()
  const [switching, setSwitching] = useState(false)
  const on = ov?.enabled !== false
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="AI Studio">
        {ov && (
          <Check
            checked={on}
            disabled={switching}
            onChange={async (v) => {
              setSwitching(true)
              try {
                await api.studio.setEnabled(v)
                reload()
              } finally {
                setSwitching(false)
              }
            }}
          >
            {on ? 'AI Studio is on' : 'AI Studio is off'}
          </Check>
        )}
        {ov?.mockMode && (
          <span className="rounded-md border border-warn px-2 py-1 text-[11px] font-bold uppercase text-warn">
            Mock mode: nothing real is spent
          </span>
        )}
      </PageHeader>
      {!on && (
        <div className="mx-8 mb-3 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-muted">
          AI Studio is off. It sends no flag alerts and shows no flag counts. Posting and your
          schedule keep working. Switch it on when the studio is running again.
        </div>
      )}
      {writingOff && (
        <div className="mx-8 mb-3 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-muted">
          Writing and production are off. Bots write and render the episodes and drop them in the
          Inbox. The Library and the Director's Log still work.
        </div>
      )}
      <div className="flex gap-1 px-8 pb-3">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
          >
            {label}
            {id === 'flagged' && ov && ov.openFlags > 0 && (
              <span className="dot-pulse ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {ov.openFlags}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {tab === 'overview' && <Overview />}
        {tab === 'bible' && <StudioBible />}
        {tab === 'library' && <StudioLibrary />}
        {tab === 'publishing' && <StudioPublishing />}
        {tab === 'research' && <StudioResearch />}
        {tab === 'log' && <DirectorLog />}
        {tab === 'flagged' && <Flagged />}
      </div>
    </div>
  )
}

function Overview() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: ov, reload } = useLoad(() => api.studio.overview())
  const [report, setReport] = useState<string[] | null>(null)
  if (!ov) return null
  return (
    <div className="space-y-4">
      <Card
        title="Director"
        actions={
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.studio.directorTick()
                  toast({
                    kind: 'info',
                    headline: 'Director checked in.',
                    detail: r.notes.slice(0, 3).join(' ') || `${r.created} new task(s).`,
                  })
                  reload()
                })
              }
            >
              Run a pass now
            </Button>
            <Button
              disabled={busy}
              onClick={() => run(async () => setReport(await api.studio.dryRunDay()))}
            >
              Dry run day
            </Button>
          </div>
        }
      >
        {ov.paused && (
          <div className="mb-2 rounded-md border border-warn p-2 text-[13px]">
            The studio starts paused so nothing happens until you are ready. Check Settings (keys,
            caps, brands), then press Resume everything. Mock mode is on, so the first runs spend
            nothing.
          </div>
        )}
        <div className="text-[13px] text-muted">
          {ov.paused
            ? 'Everything is paused. Nothing new will start. Resume with the button at the bottom of the left menu.'
            : `${ov.queued} waiting, ${ov.running} running, ${ov.openFlags} need you.`}{' '}
          Library: {ov.libraryEpisodes} episodes, {(ov.libraryBytes / 1024 / 1024).toFixed(1)} MB.
        </div>
        {report && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-bg p-3 text-[12px] leading-relaxed">
            {report.join('\n')}
          </pre>
        )}
      </Card>
      <DirectorChat onChanged={reload} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ov.brands.map((b) => {
          const on = Object.entries(b.config.platforms).filter(([, on]) => on)
          const covered = b.runwayCovered >= b.config.runwayDays
          return (
            <section key={b.brandId} className="rounded-lg border border-line bg-surface p-4">
              <header className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-[17px]">Channel runway</h2>
                <span
                  className="rounded-full px-3 py-0.5 text-[12px] font-bold text-[#111]"
                  style={{ background: b.color }}
                >
                  {b.config.format === 'long' ? 'Long 16:9' : 'Short 9:16'}
                </span>
              </header>
              <div className="text-[18px] font-bold">{b.name}</div>
              <div className={`text-[14px] font-semibold ${covered ? 'text-ok' : 'text-warn'}`}>
                {b.runwayCovered} of {b.config.runwayDays} days covered{b.config.paused ? ' (paused)' : ''}
              </div>
              <div className="my-3 flex items-center gap-2">
                {on.length === 0 ? (
                  <span className="text-[12px] text-muted">Posts nowhere yet.</span>
                ) : (
                  on.map(([p]) => <PlatformLogo key={p} platform={p} size={30} />)
                )}
              </div>
              <div className="mb-3 text-[12px] text-muted">
                {b.config.cadenceMode === 'every_n' ? `Every ${b.config.everyN} day(s)` : 'Weekly schedule'}. Next due:{' '}
                {b.nextDue ?? 'none'}.
              </div>
              <div className="space-y-2">
                <Button className="w-full justify-start" onClick={() => void api.studio.openBrandFolder(b.brandId, 'scripts')}>
                  📁 Open scripts folder
                </Button>
                <Button className="w-full justify-start" onClick={() => void api.studio.openBrandFolder(b.brandId, 'videos')}>
                  📁 Open videos folder
                </Button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DirectorLog() {
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const [agent, setAgent] = useState('')
  const { data: rows } = useLoad(
    () =>
      api.studio.auditLog({
        brandId: brandId === 'all' ? null : brandId,
        agent: agent || undefined,
      }),
    [brandId, agent],
  )
  const { data: agents } = useLoad(async () => [
    ...new Set((await api.studio.auditLog({})).map((r) => r.agent)),
  ])
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Select
          className="w-56"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">All brands</option>
          {brands?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select className="w-56" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All agents</option>
          {agents?.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
      </div>
      {!rows?.length ? (
        <Empty>Nothing yet. The Director has not done anything.</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface2 text-muted">
              <tr>
                <th className="p-2">When</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap p-2">{formatEastern(r.tsUtc)}</td>
                  <td>{r.agent}</td>
                  <td>{r.action}</td>
                  <td
                    className="max-w-[420px] truncate text-muted"
                    title={JSON.stringify(r.detail)}
                  >
                    {r.detail ? JSON.stringify(r.detail) : ''}
                    {r.episodeId ? ` ${r.episodeId}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Flagged() {
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.flagged())
  const { data: brands } = useLoad(() => api.studio.brands())
  if (!data) return null
  if (!data.length) return <Empty>Nothing is flagged. Everything is going fine.</Empty>
  return (
    <div className="space-y-3">
      {data.length > 1 && (
        <Button
          onClick={() =>
            run(async () => {
              for (const { task } of data) await api.studio.resolveFlag(task.id, 'retry')
              reload()
            })
          }
        >
          Retry all ({data.length})
        </Button>
      )}
      {data.map(({ task, episode }) => {
        const brandId = task.brandId ?? episode?.brandId ?? null
        const brand = brands?.find((b) => b.brandId === brandId)
        const f = describeFlag(task, episode, brand?.name ?? null)
        return (
          <Card key={task.id} title={`${f.channel ? f.channel + ': ' : ''}${f.doing}`}>
            <div className="space-y-1 text-[13px]">
              {f.episode && <div className="text-muted">{f.episode}</div>}
              <div>
                <b>{task.status === 'stopped' ? 'Stopped.' : 'Needs a look.'}</b> {f.why}
              </div>
              <div className="text-muted">{f.next}</div>
            </div>
            {task.type === 'produce_episode' && episode ? (
              <ClipActions episodeId={episode.id} onDone={reload} />
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() =>
                    run(async () => {
                      await api.studio.resolveFlag(task.id, 'retry')
                      reload()
                    })
                  }
                >
                  Retry
                </Button>
                <Button
                  onClick={() =>
                    run(async () => {
                      await api.studio.resolveFlag(task.id, 'approve')
                      reload()
                    })
                  }
                >
                  Approve as is
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    run(async () => {
                      await api.studio.resolveFlag(task.id, 'discard')
                      reload()
                    })
                  }
                >
                  Discard
                </Button>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/** A small chat with the Director. It proposes actions and the owner presses a button to run one. */
function DirectorChat({ onChanged }: { onChanged: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [text, setText] = useState('')
  const [log, setLog] = useState<
    Array<{ who: 'you' | 'director'; text: string; actions?: DirectorActionView[] }>
  >([])
  const send = () => {
    const message = text.trim()
    if (!message || busy) return
    setText('')
    setLog((l) => [...l, { who: 'you', text: message }])
    void run(async () => {
      const r = await api.studio.directorChat(
        message,
        log.map((m) => ({ who: m.who, text: m.text })),
      )
      setLog((l) => [...l, { who: 'director', text: r.reply, actions: r.actions }])
    })
  }
  return (
    <Card title="Talk to the Director">
      <div className="max-h-72 space-y-2 overflow-y-auto text-[13px]">
        {!log.length && (
          <div className="text-muted">
            Ask what is going on, or say what you want. For example: "I updated the bible for Trash
            Panda, make the changes", "rebuild Clock Out Early episode 3, make the hook shorter",
            "pause Trash Panda", or "add an idea about spam texts". I suggest buttons. Nothing runs
            until you press one. Episodes that already have a video are never rebuilt.
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} className={m.who === 'you' ? 'text-right' : ''}>
            <div
              className={
                m.who === 'you'
                  ? 'inline-block rounded-md bg-surface-2 px-3 py-2'
                  : 'inline-block px-1 py-1'
              }
            >
              {m.text}
            </div>
            {m.actions?.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {m.actions.map((a, j) => (
                  <Button
                    key={j}
                    onClick={() =>
                      run(async () => {
                        const done = await api.studio.directorApply(a)
                        toast({ kind: 'info', headline: done })
                        setLog((l) => [...l, { who: 'director', text: done }])
                        onChanged()
                      })
                    }
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy && <div className="text-muted">Thinking...</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-[13px]"
          value={text}
          placeholder="Tell the Director something, like: I updated the bible for Trash Panda, rebuild the waiting episodes"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
        />
        <Button disabled={busy || !text.trim()} onClick={send}>
          Send
        </Button>
      </div>
    </Card>
  )
}

/** The clips of one episode, with the Flagged actions: approve as is, edit the prompt and retry, regenerate, discard. */
export function ClipActions({ episodeId, onDone }: { episodeId: string; onDone: () => void }) {
  const [, run] = useBusy()
  const { data } = useLoad(() => api.studio.clipLog(episodeId), [episodeId])
  const [edit, setEdit] = useState<Record<number, string>>({})
  if (!data) return null
  const latest = new Map<number, (typeof data)[number]>()
  for (const j of data) latest.set(j.clipN, j)
  return (
    <div className="mt-3 space-y-3">
      {[...latest.values()].map((j) => {
        const qc = j.qc as {
          reasons?: string[]
          steps?: Array<{ name: string; ok: boolean; note: string; via: string }>
        } | null
        const bad = j.status === 'flagged' || j.status === 'failed' || j.status === 'expired'
        return (
          <div key={j.clipN} className="rounded-md border border-line p-3 text-[13px]">
            <div className="flex items-center justify-between">
              <b>
                Clip {j.clipN}, take {j.take}
              </b>
              <span className={bad ? 'font-bold text-bad' : 'text-muted'}>{j.status}</span>
            </div>
            {j.error && <div className="mt-1 text-bad">{j.error}</div>}
            {qc?.steps && (
              <div className="mt-1 text-[12px] text-muted">
                {qc.steps
                  .map((s) => `${s.name}: ${s.ok ? 'ok' : 'FAIL'} (${s.via}) ${s.note}`)
                  .join(' | ')}
              </div>
            )}
            {bad && (
              <>
                <Textarea
                  className="mt-2 min-h-[56px]"
                  value={edit[j.clipN] ?? j.prompt}
                  onChange={(e) => setEdit({ ...edit, [j.clipN]: e.target.value })}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    disabled={!j.filePath}
                    onClick={() =>
                      run(async () => {
                        await api.studio.resolveClip(episodeId, j.clipN, 'approve')
                        onDone()
                      })
                    }
                  >
                    Approve as is
                  </Button>
                  <Button
                    onClick={() =>
                      run(async () => {
                        await api.studio.resolveClip(
                          episodeId,
                          j.clipN,
                          'edit',
                          edit[j.clipN] ?? j.prompt,
                        )
                        onDone()
                      })
                    }
                  >
                    Edit prompt and retry
                  </Button>
                  <Button
                    onClick={() =>
                      run(async () => {
                        await api.studio.resolveClip(episodeId, j.clipN, 'regenerate')
                        onDone()
                      })
                    }
                  >
                    Regenerate clip
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      run(async () => {
                        await api.studio.resolveClip(episodeId, j.clipN, 'discard')
                        onDone()
                      })
                    }
                  >
                    Discard
                  </Button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
