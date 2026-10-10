import { useState } from 'react'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Empty, Field, Input, Select, Textarea, useBusy } from '../ui'

export function StudioComments() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.studio.brands())
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const [status, setStatus] = useState('draft')
  const { data: items, reload } = useLoad(() => api.studio.commentList({ brandId: brandId === 'all' ? null : brandId, status }), [brandId, status])
  const [edit, setEdit] = useState<Record<number, string>>({})
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-56" value={brandId} onChange={(e) => setBrandId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All brands</option>
          {brands?.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
        </Select>
        <Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Drafts waiting for you</option>
          <option value="flagged">Flagged (not answered)</option>
          <option value="queued">Waiting for their turn</option>
          <option value="replied">Replied</option>
          <option value="spam">Spam hidden</option>
          <option value="discarded">Discarded</option>
          <option value="failed">Could not send</option>
        </Select>
        {brandId !== 'all' && <Button disabled={busy} onClick={() => run(async () => { const r = await api.studio.runComments(brandId); toast({ kind: 'info', headline: 'Comments checked.', detail: `${r.checked} looked at, ${r.replied} replied, ${r.drafted} drafted, ${r.flagged} flagged.` }); reload() })}>Check comments now</Button>}
      </div>
      <p className="text-[12px] text-muted">Set each brand to Auto reply, Draft only or Off in Settings. Only praise, thanks, simple questions and light jokes are answered. Replies are limited per day and spread out. TikTok comments are not available through its API.</p>
      {!items?.length ? (
        <Empty>Nothing here.</Empty>
      ) : (
        items.map((c) => (
          <Card key={c.id} title={`${c.platform}: ${c.author || 'someone'}`}>
            <div className="text-[13px]">"{c.text}"</div>
            {c.reason && <div className="mt-1 text-[12px] text-muted">{c.reason}</div>}
            {(c.status === 'draft' || c.status === 'flagged' || c.status === 'failed') && (
              <>
                <Textarea className="mt-2 min-h-[56px]" placeholder="Type a reply" value={edit[c.id] ?? c.replyText ?? ''} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} />
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => run(async () => { await api.studio.approveComment(c.id, edit[c.id] ?? c.replyText ?? ''); reload() })}>Send this reply</Button>
                  <Button variant="danger" disabled={busy} onClick={() => run(async () => { await api.studio.discardComment(c.id); reload() })}>Discard</Button>
                </div>
              </>
            )}
            {c.status === 'replied' && <div className="mt-1 text-[13px]"><b>Replied:</b> {c.replyText}</div>}
          </Card>
        ))
      )}
    </div>
  )
}

export function StudioInsights() {
  const [busy, run] = useBusy()
  const { toast } = useApp()
  const { data: brands } = useLoad(() => api.studio.brands())
  const [brandId, setBrandId] = useState<number | null>(null)
  const id = brandId ?? brands?.[0]?.brandId ?? null
  const { data, reload } = useLoad(() => (id ? api.studio.insightsFor(id) : Promise.resolve(null)), [id])
  if (!brands || !id) return null
  const i = data?.insights
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select className="w-64" value={id} onChange={(e) => setBrandId(Number(e.target.value))}>
          {brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
        </Select>
        <Button disabled={busy} onClick={() => run(async () => { const r = await api.studio.refreshInsights(); toast({ kind: 'success', headline: 'Numbers collected.', detail: `${r.fetched} platform numbers, ${r.social} social posts.` }); reload() })}>Collect numbers now</Button>
      </div>
      <Card title="What is working">
        {data?.summary ? <p className="text-[14px]">{data.summary}</p> : <Empty>Not enough posted videos yet. At least three are needed.</Empty>}
        {data?.updatedUtc && <div className="mt-2 text-[11px] text-muted">Updated {data.updatedUtc.slice(0, 16).replace('T', ' ')} UTC. The Writer and the Thumbnail agent read this.</div>}
      </Card>
      <RepostCard brandId={id} />
      {i && i.videos > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Best videos">{i.topEpisodes.map((e) => <div key={e.id} className="text-[13px]"><b>{e.title}</b>: {e.views} views. {e.hook}</div>)}</Card>
          <Card title="Topics">{i.topics.length ? i.topics.map((t) => <div key={t.topic} className="text-[13px]">{t.topic}: {t.avgViews} views on average ({t.videos} videos)</div>) : <div className="text-[13px] text-muted">Needs more videos per topic.</div>}</Card>
          <Card title="Length">{i.lengths.map((l) => <div key={l.bucket} className="text-[13px]">{l.bucket}: {l.avgViews} views on average ({l.videos})</div>)}</Card>
          <Card title="Posting hours (Eastern)">{i.postingHours.map((h) => <div key={h.hourEt} className="text-[13px]">{h.hourEt}:00: {h.avgViews} views on average ({h.videos})</div>)}</Card>
          <Card title="Thumbnail styles that won">{i.thumbnailStyles.length ? i.thumbnailStyles.map((t, n) => <div key={n} className="text-[13px]">"{t.headline}": {(t.ctr * 100).toFixed(1)} percent click rate</div>) : <div className="text-[13px] text-muted">No finished thumbnail tests yet.</div>}</Card>
        </div>
      )}
    </div>
  )
}

/** The best older videos, ready to go out again on the platforms where a repeat is fine. */
function RepostCard({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.repostCandidates(brandId), [brandId])
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const fail = (e: unknown) => toast({ kind: 'error', headline: 'That did not work.', detail: (e as Error).message })
  return (
    <Card title="Re-post queue: your best older videos">
      <p className="mb-2 text-[12px] text-muted">Videos that did well, are older than a month, and still have their file. A repeat goes out at the next open slot. YouTube is off by default because the same video twice can look like spam.</p>
      {!data?.length && <Empty>Nothing is ready to re-post yet.</Empty>}
      {data?.map((c) => {
        const chosen = picked[c.postId] ?? c.platforms.filter((p) => p !== 'youtube')
        return (
          <div key={c.postId} className="border-t border-line py-2 text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <div><b>{c.title}</b> <span className="text-muted">{c.views === null ? '' : `${c.views} views`} · posted {c.postedUtc?.slice(0, 10)}</span></div>
              <div className="flex shrink-0 gap-2">
                <Button disabled={busy || !chosen.length} onClick={() => run(async () => { try { const r = await api.studio.queueRepost(c.postId, chosen); toast({ kind: 'success', headline: 'Queued to go out again.', detail: r.whenUtc ? `Scheduled for ${r.whenUtc.slice(0, 16).replace('T', ' ')} UTC.` : 'Saved as a draft: no open slot was found.' }); reload() } catch (e) { fail(e) } })}>Post it again</Button>
                <Button variant="ghost" onClick={() => run(async () => { await api.studio.skipRepost(c.postId); reload() })}>Not this one</Button>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {c.platforms.map((p) => <Check key={p} checked={chosen.includes(p)} onChange={(v) => setPicked({ ...picked, [c.postId]: v ? [...chosen, p] : chosen.filter((x) => x !== p) })}>{p}</Check>)}
            </div>
            {c.note && <div className="text-[11px] text-muted">{c.note}</div>}
          </div>
        )
      })}
    </Card>
  )
}

/** Morning digest, watchdog, backups. Used inside the Settings tab. */
export function OperationsCards({ cfg, reload }: { cfg: import('@shared/studio/types').StudioConfig; reload: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: wd, reload: reloadWd } = useLoad(() => api.studio.watchdogInfo())
  const { data: backups, reload: reloadBackups } = useLoad(() => api.studio.backupList())
  const [preview, setPreview] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const w = cfg.watchdog
  const saveW = (patch: Partial<typeof w>) => run(async () => { await api.studio.saveWatchdog({ ...w, ...patch }); reload(); reloadWd() })
  return (
    <>
      <Card title="Morning digest">
        <p className="mb-2 text-[12px] text-muted">One short iMessage a day: what posted, what is coming, how many days of scripts are ready, spend against caps, flags, comment activity, and any login about to expire.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Check checked={cfg.digestEnabled} onChange={(v) => run(async () => { await api.studio.setConfig({ digestEnabled: v }); reload() })}>Send it</Check>
          <Field label="Time (Eastern)"><Input className="w-28" defaultValue={cfg.digestTime} onBlur={(e) => /^\d{1,2}:\d{2}$/.test(e.target.value) && e.target.value !== cfg.digestTime && run(async () => { await api.studio.setConfig({ digestTime: e.target.value }); reload() })} /></Field>
          <Button disabled={busy} onClick={() => run(async () => setPreview(await api.studio.digestPreview()))}>Preview</Button>
          <Button disabled={busy} onClick={() => run(async () => { await api.studio.sendDigest(); toast({ kind: 'success', headline: 'Sent.' }) })}>Send it now</Button>
        </div>
        {preview && <pre className="mt-3 whitespace-pre-wrap rounded-md bg-bg p-3 text-[12px]">{preview}</pre>}
      </Card>
      <Card title="Watchdog (alerts you if the app stops)">
        <p className="mb-2 text-[12px] text-muted">A small separate launchd job checks every 5 minutes that the Director is still checking in. If it has not for the limit below during run hours, you get an iMessage, even if this app is not running.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Check checked={w.enabled} onChange={(v) => saveW({ enabled: v })}>On</Check>
          <Field label="Run hours from"><Input className="w-24" defaultValue={w.runStart} onBlur={(e) => /^\d{1,2}:\d{2}$/.test(e.target.value) && saveW({ runStart: e.target.value })} /></Field>
          <Field label="to"><Input className="w-24" defaultValue={w.runEnd} onBlur={(e) => /^\d{1,2}:\d{2}$/.test(e.target.value) && saveW({ runEnd: e.target.value })} /></Field>
          <Field label="Minutes without a check in"><Input className="w-24" defaultValue={w.thresholdMinutes} onBlur={(e) => Number(e.target.value) >= 5 && saveW({ thresholdMinutes: Number(e.target.value) })} /></Field>
        </div>
        {wd && (
          <div className="mt-3 text-[13px]">
            <div>{wd.installed ? 'Installed.' : 'Not installed yet.'} Last check in: {wd.heartbeatAgeMinutes === null ? 'never' : `${wd.heartbeatAgeMinutes} minute(s) ago`}.</div>
            <div className="mt-2 text-[12px] text-muted">To install, paste this into Terminal:</div>
            <pre className="select-all whitespace-pre-wrap rounded-md bg-bg p-2 text-[12px]">{wd.installCommand}</pre>
            <div className="mt-1 text-[12px] text-muted">To remove it:</div>
            <pre className="select-all whitespace-pre-wrap rounded-md bg-bg p-2 text-[12px]">{wd.uninstallCommand}</pre>
          </div>
        )}
      </Card>
      <Card title="Backups" actions={<Button disabled={busy} onClick={() => run(async () => { await api.studio.backupNow(); reloadBackups(); toast({ kind: 'success', headline: 'Backup made.' }) })}>Back up now</Button>}>
        <p className="mb-2 text-[12px] text-muted">Every night after 2 AM Eastern: the database (settings without any key, series bibles, thumbnail guidelines, ledger, stats) and the episode Library. The last {cfg.backupKeep} are kept in {cfg.backupDir}.</p>
        {!backups?.length ? <Empty>No backups yet.</Empty> : backups.map((b) => (
          <div key={b.stamp} className="flex items-center justify-between border-b border-line py-1 text-[13px]">
            <span>{b.stamp.replace(/-(\d{6})$/, ' $1')} ({(b.bytes / 1024 / 1024).toFixed(1)} MB)</span>
            <Button variant="ghost" onClick={() => setConfirm(b.stamp)}>Restore from this</Button>
          </div>
        ))}
        {confirm && backups && (
          <div className="mt-3 rounded-md border border-bad p-3 text-[13px]">
            <b>Restore from {confirm}?</b> The Library files in this backup replace the ones on disk. To bring back the database too, use Restore on the Settings screen with the file named elo-backup-{confirm}.zip in the backup folder. This cannot be undone.
            <div className="mt-2 flex gap-2">
              <Button variant="danger" disabled={busy} onClick={() => run(async () => { const b = backups.find((x) => x.stamp === confirm); if (b?.libraryZip) { const n = await api.studio.restoreLibrary(b.libraryZip); toast({ kind: 'success', headline: 'Library restored.', detail: `${n} files.` }) } setConfirm(null) })}>Yes, restore the Library</Button>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
