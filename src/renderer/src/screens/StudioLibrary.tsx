import { useState } from 'react'
import { EPISODE_STATUSES, type EpisodeStatus } from '@shared/studio/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Dialog, Empty, Input, Select, useBusy } from '../ui'
import { ClipActions } from './Studio'

export function StudioLibrary() {
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<EpisodeStatus | 'all'>('all')
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest')
  const { data: brands } = useLoad(() => api.brands.list(true))
  const { data: rows } = useLoad(
    () => api.studio.episodeList({ search, status, brandId: brandId === 'all' ? null : brandId, sort }),
    [search, status, brandId, sort],
  )
  const brandName = (id: number) => brands?.find((b) => b.id === id)?.name ?? ''
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Input className="w-64" placeholder="Search title, summary, tags" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-52" value={brandId} onChange={(e) => setBrandId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All brands</option>
          {brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value as EpisodeStatus | 'all')}>
          <option value="all">Any status</option>
          {EPISODE_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="w-40" value={sort} onChange={(e) => setSort(e.target.value as never)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title</option>
        </Select>
      </div>
      {!rows?.length ? (
        <Empty>No episodes yet. The Writers fill this as the Director asks for scripts.</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface2 text-[11px] uppercase text-muted"><tr><th className="p-2">Episode</th><th>Brand</th><th>Status</th><th>Slot</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-surface2" onClick={() => setOpen(r.id)}>
                  <td className="p-2"><div className="font-semibold">{r.title || r.id}</div><div className="text-[11px] text-muted">{r.id}</div></td>
                  <td>{brandName(r.brandId)}</td>
                  <td>{r.status}</td>
                  <td>{r.slotDate ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <EpisodeView id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function copy(text: string, toast: ReturnType<typeof useApp>['toast']) {
  void navigator.clipboard.writeText(text).then(() => toast({ kind: 'success', headline: 'Copied.' }))
}

export function EpisodePeek(p: { id: string; onClose: () => void }) {
  return <EpisodeView {...p} />
}

function EpisodeView({ id, onClose }: { id: string; onClose: () => void }) {
  const { toast } = useApp()
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.episode(id), [id])
  if (!data) return null
  const { row, pkg } = data
  return (
    <Dialog title={pkg?.title || row.title || row.id} onClose={onClose} wide>
      <div className="space-y-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-56" value={row.status} onChange={(e) => run(async () => { await api.studio.setEpisodeStatus(id, e.target.value as EpisodeStatus); reload() })}>
            {EPISODE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Button onClick={() => run(async () => copy(await api.studio.exportEpisode(id), toast))}>Export JSON</Button>
          <Button
            onClick={() =>
              run(async () => {
                const d = await api.studio.duplicateEpisode(id)
                toast({ kind: 'success', headline: 'Duplicated.', detail: d.id })
              })
            }
          >
            Duplicate as new episode
          </Button>
          {pkg && pkg.scenes.length > 0 && (
            <Button onClick={() => copy(pkg.scenes.map((s) => `Scene ${s.n}: ${s.grok_prompt}`).join('\n\n'), toast)}>Copy all prompts</Button>
          )}
        </div>
        {row.flaggedReason && <div className="rounded-md border border-bad p-2 text-bad">Flagged: {row.flaggedReason}</div>}
        {pkg ? (
          <>
            <p className="text-muted">{pkg.logline}</p>
            {(pkg.life_lesson || pkg.math_lesson) && (
              <div>
                {pkg.life_lesson && <div><b>Life lesson:</b> {pkg.life_lesson}</div>}
                {pkg.math_lesson && <div><b>Math lesson:</b> {pkg.math_lesson}</div>}
              </div>
            )}
            {pkg.counted_objects.length > 0 && (
              <div><b>Counted objects:</b> {pkg.counted_objects.map((o) => `${o.quantity} ${o.name} (scenes ${o.scenes.join(', ')})`).join('; ')}</div>
            )}
            <Card title="YouTube">
              <div><b>Title:</b> {pkg.youtube.title}</div>
              <div className="mt-1 whitespace-pre-wrap"><b>Description:</b> {pkg.youtube.description}</div>
              <div className="mt-1 text-muted">Tags: {pkg.youtube.tags.join(', ')}. {pkg.youtube.made_for_kids ? 'Made for kids.' : ''}</div>
            </Card>
            {pkg.scenes.map((s) => (
              <Card key={s.n} title={`Scene ${s.n}`} actions={<Button onClick={() => copy(s.grok_prompt, toast)}>Copy scene prompt</Button>}>
                <div className="text-muted">{s.setting}</div>
                <div className="mt-1">{s.action}</div>
                {s.dialogue.map((d, i) => <div key={i} className="mt-1"><b>{d.speaker}:</b> {d.line}</div>)}
                <div className="mt-2 rounded-md bg-bg p-2 text-[12px]">{s.grok_prompt}</div>
                <div className="mt-1 text-[11px] text-muted">{s.content_seconds}s of content, generated at {s.generate_seconds}s. {s.extension_note}</div>
              </Card>
            ))}
            <Card title="Status history">
              {pkg.status_history.map((h, i) => <div key={i} className="text-[12px]">{h.at.slice(0, 16).replace('T', ' ')} UTC: {h.status}{h.note ? ` (${h.note})` : ''}</div>)}
            </Card>
          </>
        ) : (
          <Empty>This episode has no package file.</Empty>
        )}
        {['Ready for production', 'In production', 'Flagged', 'Scheduled', 'Posted', 'Archived'].includes(row.status) && (
          <Card
            title="Video clips"
            actions={row.status === 'Ready for production' ? <Button onClick={() => run(async () => { await api.studio.produceNow(id); toast({ kind: 'info', headline: 'The Producer is on it.' }) })}>Make the video now</Button> : undefined}
          >
            <ClipActions episodeId={id} onDone={reload} />
          </Card>
        )}
        <Card title="Spend for this episode">
          <div>${data.spend.dollars.toFixed(2)} real spend, {data.spend.rows.length} ledger row(s).</div>
        </Card>
      </div>
    </Dialog>
  )
}
