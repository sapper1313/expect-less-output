import { useState } from 'react'
import { formatEastern } from '@shared/time'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { BrandDot, Button, Card, Empty, PageHeader, Select, useBusy } from '../ui'
import { StudioLibrary } from './StudioLibrary'
import { StudioSpend } from './StudioSpend'
import { StudioSettings } from './StudioSettings'
import { StudioLocalAi } from './StudioLocalAi'

type Tab = 'overview' | 'library' | 'spend' | 'log' | 'flagged' | 'settings' | 'local'
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['library', 'Library'],
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
        {tab === 'library' && <StudioLibrary />}
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
        <div className="text-[13px] text-muted">
          {ov.paused ? 'Everything is paused. Nothing new will start.' : `${ov.queued} waiting, ${ov.running} running, ${ov.openFlags} need you.`}{' '}
          Library: {ov.libraryEpisodes} episodes, {(ov.libraryBytes / 1024 / 1024).toFixed(1)} MB.
        </div>
        {report && (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-bg p-3 text-[12px] leading-relaxed">{report.join('\n')}</pre>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {ov.brands.map((b) => (
          <Card key={b.brandId} title={b.name} actions={<BrandDot color={b.color} />}>
            <div className="space-y-1 text-[13px]">
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
  if (!data) return null
  if (!data.length) return <Empty>Nothing is flagged. Everything is going fine.</Empty>
  return (
    <div className="space-y-3">
      {data.map(({ task, episode }) => (
        <Card key={task.id} title={`${task.type.replaceAll('_', ' ')} ${episode ? `: ${episode.title || episode.id}` : ''}`}>
          <div className="text-[13px]">
            <b>{task.status === 'stopped' ? 'Stopped' : 'Flagged'}.</b> {task.error}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'retry'); reload() })}>Retry</Button>
            <Button onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'approve'); reload() })}>Approve as is</Button>
            <Button variant="danger" onClick={() => run(async () => { await api.studio.resolveFlag(task.id, 'discard'); reload() })}>Discard</Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
