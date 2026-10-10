import { useState } from 'react'
import { formatEastern } from '@shared/time'
import { describeFlag } from '@shared/studio/flagText'
import type { DirectorActionView } from '../../../main/studio/directorChat'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { BrandDot, Button, Card, Empty, PageHeader, Select, Textarea, useBusy } from '../ui'
import { StudioBible } from './StudioBible'
import { StudioPublishing } from './StudioPublishing'
import { StudioComments, StudioInsights } from './StudioOperations'
import { StudioLibrary } from './StudioLibrary'
import { StudioSpend } from './StudioSpend'
import { StudioSettings } from './StudioSettings'
import { StudioLocalAi } from './StudioLocalAi'

type Tab = 'overview' | 'bible' | 'library' | 'publishing' | 'comments' | 'insights' | 'spend' | 'log' | 'flagged' | 'settings' | 'local'
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['bible', 'Bible'],
  ['library', 'Library'],
  ['publishing', 'Publishing'],
  ['comments', 'Comments'],
  ['insights', 'Insights'],
  ['spend', 'Spend'],
  ['log', "Director's Log"],
  ['flagged', 'Flagged'],
  ['settings', 'Settings'],
  ['local', 'Local AI'],
]

export function Studio({ initialTab = 'overview' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { data: ov } = useLoad(() => api.studio.overview())
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Studio">
        {ov?.mockMode && (
          <span className="rounded-md border border-warn px-2 py-1 text-[11px] font-bold uppercase text-warn">
            Mock mode: nothing real is spent
          </span>
        )}
      </PageHeader>
      <div className="flex gap-1 px-8 pb-3">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
          >
            {label}
            {id === 'flagged' && ov && ov.openFlags > 0 ? ` (${ov.openFlags})` : ''}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {tab === 'overview' && <Overview />}
        {tab === 'bible' && <StudioBible />}
        {tab === 'library' && <StudioLibrary />}
        {tab === 'publishing' && <StudioPublishing />}
        {tab === 'comments' && <StudioComments />}
        {tab === 'insights' && <StudioInsights />}
        {tab === 'spend' && <StudioSpend />}
        {tab === 'log' && <DirectorLog />}
        {tab === 'flagged' && <Flagged />}
        {tab === 'settings' && <StudioSettings />}
        {tab === 'local' && <StudioLocalAi />}
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
              variant={ov.paused ? 'primary' : 'secondary'}
              onClick={() => run(async () => { await api.studio.pauseAll(!ov.paused); reload() })}
            >
              {ov.paused ? 'Resume everything' : 'Pause everything'}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.studio.directorTick()
                  toast({ kind: 'info', headline: 'Director checked in.', detail: r.notes.slice(0, 3).join(' ') || `${r.created} new task(s).` })
                  reload()
                })
              }
            >
              Run a pass now
            </Button>
            <Button disabled={busy} onClick={() => run(async () => setReport(await api.studio.dryRunDay()))}>
              Dry run day
            </Button>
          </div>
        }
      >
        {ov.paused && (
          <div className="mb-2 rounded-md border border-warn p-2 text-[13px]">
            The studio starts paused so nothing happens until you are ready. Check Settings (keys, caps, brands), then press Resume everything. Mock mode is on, so the first runs spend nothing.
          </div>
        )}
        <div className="text-[13px] text-muted">
          {ov.paused ? 'Everything is paused. Nothing new will start.' : `${ov.queued} waiting, ${ov.running} running, ${ov.openFlags} need you.`}{' '}
          Library: {ov.libraryEpisodes} episodes, {(ov.libraryBytes / 1024 / 1024).toFixed(1)} MB.
        </div>
        {report && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-bg p-3 text-[12px] leading-relaxed">{report.join('\n')}</pre>
        )}
      </Card>
      <DirectorChat onChanged={reload} />
      <div className="grid gap-4 md:grid-cols-2">
        {ov.brands.map((b) => (
          <Card key={b.brandId} title={b.name} actions={<BrandDot color={b.color} />}>
            <div className="space-y-1 text-[13px]">
              <div className="flex gap-3 pb-1">
                <button className="text-accent underline" onClick={() => void api.studio.openBrandFolder(b.brandId, 'scripts')}>Open episode scripts folder</button>
                <button className="text-accent underline" onClick={() => void api.studio.openBrandFolder(b.brandId, 'videos')}>Open videos folder</button>
              </div>
              <div>
                {b.config.format === 'long' ? 'Long form, 16:9' : 'Short form, 9:16'}.{' '}
                {b.config.cadenceMode === 'every_n' ? `Every ${b.config.everyN} day(s)` : 'Weekly schedule'}
                {b.config.paused ? ' (paused)' : ''}.
              </div>
              <div className="text-muted">Next due: {b.nextDue ?? 'none'}. Runway covered: {b.runwayCovered} date(s) of {b.config.runwayDays} days.</div>
              <div className="text-muted">
                Posts to: {Object.entries(b.config.platforms).filter(([, on]) => on).map(([p]) => p).join(', ') || 'nowhere yet'}.
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function DirectorLog() {
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const [agent, setAgent] = useState('')
  const { data: rows } = useLoad(() => api.studio.auditLog({ brandId: brandId === 'all' ? null : brandId, agent: agent || undefined }), [brandId, agent])
  const { data: agents } = useLoad(async () => [...new Set((await api.studio.auditLog({})).map((r) => r.agent))])
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Select className="w-56" value={brandId} onChange={(e) => setBrandId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All brands</option>
          {brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="w-56" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All agents</option>
          {agents?.map((a) => <option key={a}>{a}</option>)}
        </Select>
      </div>
      {!rows?.length ? (
        <Empty>Nothing yet. The Director has not done anything.</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface2 text-muted"><tr><th className="p-2">When</th><th>Agent</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap p-2">{formatEastern(r.tsUtc)}</td>
                  <td>{r.agent}</td>
                  <td>{r.action}</td>
                  <td className="max-w-[420px] truncate text-muted" title={JSON.stringify(r.detail)}>{r.detail ? JSON.stringify(r.detail) : ''}{r.episodeId ? ` ${r.episodeId}` : ''}</td>
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
        <Button onClick={() => run(async () => { for (const { task } of data) await api.studio.resolveFlag(task.id, 'retry'); reload() })}>Retry all ({data.length})</Button>
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
                <Button onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'retry'); reload() })}>Retry</Button>
                <Button onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'approve'); reload() })}>Approve as is</Button>
                <Button variant="danger" onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'discard'); reload() })}>Discard</Button>
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
  const [log, setLog] = useState<Array<{ who: 'you' | 'director'; text: string; actions?: DirectorActionView[] }>>([])
  const send = () => {
    const message = text.trim()
    if (!message || busy) return
    setText('')
    setLog((l) => [...l, { who: 'you', text: message }])
    void run(async () => {
      const r = await api.studio.directorChat(message, log.map((m) => ({ who: m.who, text: m.text })))
      setLog((l) => [...l, { who: 'director', text: r.reply, actions: r.actions }])
    })
  }
  return (
    <Card title="Talk to the Director">
      <div className="max-h-72 space-y-2 overflow-y-auto text-[13px]">
        {!log.length && <div className="text-muted">Ask what is going on, or say what you want. For example: "I updated the bible for Trash Panda, make the changes", "rebuild Clock Out Early episode 3, make the hook shorter", "pause Trash Panda", or "add an idea about spam texts". I suggest buttons. Nothing runs until you press one. Episodes that already have a video are never rebuilt.</div>}
        {log.map((m, i) => (
          <div key={i} className={m.who === 'you' ? 'text-right' : ''}>
            <div className={m.who === 'you' ? 'inline-block rounded-md bg-surface-2 px-3 py-2' : 'inline-block px-1 py-1'}>{m.text}</div>
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
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
        <Button disabled={busy || !text.trim()} onClick={send}>Send</Button>
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
        const qc = j.qc as { reasons?: string[]; steps?: Array<{ name: string; ok: boolean; note: string; via: string }> } | null
        const bad = j.status === 'flagged' || j.status === 'failed' || j.status === 'expired'
        return (
          <div key={j.clipN} className="rounded-md border border-line p-3 text-[13px]">
            <div className="flex items-center justify-between">
              <b>Clip {j.clipN}, take {j.take}</b>
              <span className={bad ? 'font-bold text-bad' : 'text-muted'}>{j.status}</span>
            </div>
            {j.error && <div className="mt-1 text-bad">{j.error}</div>}
            {qc?.steps && <div className="mt-1 text-[12px] text-muted">{qc.steps.map((s) => `${s.name}: ${s.ok ? 'ok' : 'FAIL'} (${s.via}) ${s.note}`).join(' | ')}</div>}
            {bad && (
              <>
                <Textarea className="mt-2 min-h-[56px]" value={edit[j.clipN] ?? j.prompt} onChange={(e) => setEdit({ ...edit, [j.clipN]: e.target.value })} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={!j.filePath} onClick={() => run(async () => { await api.studio.resolveClip(episodeId, j.clipN, 'approve'); onDone() })}>Approve as is</Button>
                  <Button onClick={() => run(async () => { await api.studio.resolveClip(episodeId, j.clipN, 'edit', edit[j.clipN] ?? j.prompt); onDone() })}>Edit prompt and retry</Button>
                  <Button onClick={() => run(async () => { await api.studio.resolveClip(episodeId, j.clipN, 'regenerate'); onDone() })}>Regenerate clip</Button>
                  <Button variant="danger" onClick={() => run(async () => { await api.studio.resolveClip(episodeId, j.clipN, 'discard'); onDone() })}>Discard</Button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
