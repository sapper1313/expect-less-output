import { useEffect, useState } from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import { formatEastern, localInputToIso } from '@shared/time'
import type { SendSchedule } from '@shared/sendSchedule'
import type { Platform } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Check, DateTimeSelect, Dialog, Input, Select, useBusy } from '../ui'

type Older = Awaited<ReturnType<typeof api.posts.olderMissingPlatform>>

/** Sends videos that already went out to one more platform, for example once TikTok or Facebook is connected. */
export function SendOlder({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | null>(null)
  const id = brandId ?? brands?.[0]?.id ?? null
  const { data: accounts } = useLoad(() => (id ? api.accounts.list(id) : Promise.resolve([])), [id])
  const real = (accounts ?? []).filter((a) => a.mode !== 'dry_run' && a.status === 'connected' && ['facebook', 'tiktok', 'instagram', 'bluesky', 'youtube'].includes(a.platform))
  const [platform, setPlatform] = useState<Platform | ''>('')
  const chosenPlatform = (real.find((a) => a.platform === platform)?.platform ?? real[0]?.platform ?? '') as Platform | ''
  const [mode, setMode] = useState<'now' | 'start' | 'channel'>('now')
  const [startAt, setStartAt] = useState('')
  const [every, setEvery] = useState('1')
  const [unit, setUnit] = useState<'60' | '1440' | '1'>('1440')
  const [list, setList] = useState<Older>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  useEffect(() => {
    let alive = true
    if (!id || !chosenPlatform) {
      setList([])
      setPicked(new Set())
      return
    }
    void api.posts.olderMissingPlatform(id, chosenPlatform).then((r) => {
      if (alive) {
        setList(r)
        setPicked(new Set(r.map((x) => x.postId)))
      }
    })
    return () => {
      alive = false
    }
  }, [id, chosenPlatform])
  const label = chosenPlatform ? PLATFORM_LABELS[chosenPlatform] : ''
  return (
    <Dialog title="Send older videos to another platform" onClose={onClose} wide>
      <p className="mb-3 text-[12px] text-muted">
        For videos that already went out but never went to a platform, for example because it was not connected yet. They go one at a time, about 2 minutes apart, and keep their old date. TikTok videos land in your TikTok drafts, and you press Post in the TikTok app.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select className="w-64" value={id ?? ''} onChange={(e) => { setBrandId(Number(e.target.value)); setPlatform('') }}>
          {brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select className="w-44" value={chosenPlatform} onChange={(e) => setPlatform(e.target.value as Platform)} disabled={!real.length}>
          {real.map((a) => <option key={a.platform} value={a.platform}>{PLATFORM_LABELS[a.platform]}</option>)}
        </Select>
      </div>
      {!real.length && <div className="rounded-md border border-line p-3 text-[13px]">This channel has no real Facebook, Instagram, TikTok, Bluesky or YouTube account connected yet. Connect one in Setup Channels, Connections tab, first.</div>}
      {!!real.length && !list.length && <div className="rounded-md border border-line p-3 text-[13px]">Nothing to send. Every older video that still has its file already has a {label} entry.</div>}
      {!!list.length && (
        <>
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <b>{picked.size} of {list.length} selected</b>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPicked(new Set(list.map((x) => x.postId)))}>Select all</Button>
              <Button variant="ghost" onClick={() => setPicked(new Set())}>Select none</Button>
            </div>
          </div>
          <div className="max-h-[40vh] overflow-y-auto rounded-md border border-line">
            {list.map((x) => (
              <div key={x.postId} className="border-b border-line px-3 py-2 text-[13px] last:border-0">
                <Check checked={picked.has(x.postId)} onChange={(v) => { const n = new Set(picked); if (v) n.add(x.postId); else n.delete(x.postId); setPicked(n) }}>
                  <b>{x.title}</b> <span className="text-muted">{x.postedAtUtc ? formatEastern(x.postedAtUtc, false) : ''} · already on {x.platforms.join(', ')}</span>
                </Check>
              </div>
            ))}
          </div>
        </>
      )}
      {!!list.length && (
        <div className="mt-4 space-y-2 rounded-md border border-line p-3 text-[13px]">
          <b>When should they go?</b>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} /> Right away, one about every 2 minutes</label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={mode === 'start'} onChange={() => setMode('start')} /> Start on
            <DateTimeSelect value={startAt} onChange={(v) => { setStartAt(v); setMode('start') }} label="Start" />
            then one every
            <Input className="w-16" value={every} onChange={(e) => { setEvery(e.target.value.replace(/\D/g, '')); setMode('start') }} />
            <Select className="w-32" value={unit} onChange={(e) => { setUnit(e.target.value as '60' | '1440' | '1'); setMode('start') }}>
              <option value="1">minutes</option>
              <option value="60">hours</option>
              <option value="1440">days</option>
            </Select>
          </label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'channel'} onChange={() => setMode('channel')} /> On this channel's usual posting times, one video for each time</label>
          <div className="text-[11px] text-muted">Times are Eastern. They go to the platform at that time. TikTok videos land in your TikTok drafts then.</div>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !picked.size || !chosenPlatform || (mode === 'start' && (!startAt || !Number(every)))}
          onClick={() =>
            run(async () => {
              try {
                const schedule: SendSchedule =
                  mode === 'channel' ? { mode: 'channel' } : mode === 'start' ? { mode: 'start', startAtUtc: localInputToIso(startAt) ?? new Date().toISOString(), everyMinutes: Number(every) * Number(unit) } : { mode: 'now', spacingSeconds: 120 }
                const r = await api.posts.addPlatform([...picked], chosenPlatform as Platform, schedule)
                toast({ kind: r.added ? 'success' : 'error', headline: r.added ? `Sending ${r.added} video${r.added === 1 ? '' : 's'} to ${label}.` : 'Nothing was sent.', detail: r.problems.length ? r.problems.map((p) => `${p.title}: ${p.reason}`).join(' ') : r.times.length ? `First goes ${formatEastern(r.times[0])}, last ${formatEastern(r.times[r.times.length - 1])}.` : 'Watch the Queue to see them go.' })
                if (r.added) onClose()
              } catch (e) {
                toast({ kind: 'error', headline: 'That did not work.', detail: (e as Error).message })
              }
            })
          }
        >
          Send {picked.size || ''} to {label || 'the platform'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  )
}
