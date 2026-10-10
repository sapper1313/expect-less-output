import { useState } from 'react'
import { LANGUAGES } from '@shared/studio/captions'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Check, useBusy } from '../ui'

/** Chapters for the YouTube description and captions in other languages, made from the script. */
export function EpisodeExtras({ episodeId, live }: { episodeId: string; live: boolean }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: chapters, reload: reloadCh } = useLoad(() => api.studio.chaptersFor(episodeId), [episodeId])
  const { data: caps, reload: reloadCaps } = useLoad(() => api.studio.captionList(episodeId), [episodeId])
  const { data: cfg } = useLoad(() => api.studio.getConfig())
  const [langs, setLangs] = useState<string[] | null>(null)
  const chosen = langs ?? cfg?.captionLanguages ?? []
  const fail = (e: unknown) => toast({ kind: 'error', headline: 'That did not work.', detail: (e as Error).message })
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast({ kind: 'success', headline: 'Copied.' }))
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="text-[12px] font-bold uppercase text-muted">Chapters and captions</div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => run(async () => { try { await api.studio.makeChapters(episodeId); reloadCh() } catch (e) { fail(e) } })}>{chapters ? 'Make the chapters again' : 'Make chapters'}</Button>
          {chapters && <Button onClick={() => copy(chapters)}>Copy chapters</Button>}
          <span className="text-[11px] text-muted">Timed from the script. Check them against the finished video before you rely on them.</span>
        </div>
        {chapters && <pre className="mt-2 whitespace-pre-wrap rounded bg-black/20 p-2 text-[12px]">{chapters}</pre>}
      </div>
      <div>
        <div className="mb-1 text-[12px] text-muted">Make captions in English plus:</div>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {LANGUAGES.map(([code, name]) => (
            <Check key={code} checked={chosen.includes(code)} onChange={(v) => { const next = v ? [...chosen, code] : chosen.filter((x) => x !== code); setLangs(next); void api.studio.setConfig({ captionLanguages: next }) }}>{name}</Check>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => run(async () => { try { await api.studio.makeCaptions(episodeId, chosen); reloadCaps() } catch (e) { fail(e) } })}>Make captions</Button>
          <Button disabled={busy || !caps?.length} onClick={() => run(async () => { try { await api.studio.exportCaptions(episodeId) } catch (e) { fail(e) } })}>Open the caption files</Button>
          {live && <Button disabled={busy || !caps?.length} onClick={() => run(async () => { try { const r = await api.studio.uploadCaptions(episodeId); toast({ kind: 'success', headline: r.note }) } catch (e) { fail(e) } })}>Add to the YouTube video</Button>}
        </div>
        {!!caps?.length && <div className="mt-1 text-[12px] text-muted">Ready: {caps.map((c) => `${c.name} (${c.cues} lines)`).join(', ')}. Adding to YouTube uses 400 of your 10,000 daily YouTube points for each language.</div>}
      </div>
    </div>
  )
}
