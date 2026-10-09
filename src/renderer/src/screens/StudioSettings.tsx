import { useEffect, useState } from 'react'
import { CAP_MAX, capError } from '@shared/studio/config'
import { STUDIO_PLATFORMS, type Cap, type StudioBrandConfig, type StudioConfig } from '@shared/studio/types'
import type { KeyId, KeyStatus } from '@shared/studio/api'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Select, Textarea, useBusy } from '../ui'
import { OperationsCards } from './StudioOperations'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function StudioSettings() {
  const { data: cfg, reload } = useLoad(() => api.studio.getConfig())
  if (!cfg) return null
  return (
    <div className="space-y-4">
      <ModeCard cfg={cfg} reload={reload} />
      <KeysCard />
      <CapsCard cfg={cfg} reload={reload} />
      <GenerateCard cfg={cfg} reload={reload} />
      <ProductionCard cfg={cfg} reload={reload} />
      <BrandsCard />
      <GuidelinesCard />
      <CapsTableCard cfg={cfg} reload={reload} />
      <PublicHostCard cfg={cfg} reload={reload} />
      <RetentionCard cfg={cfg} reload={reload} />
      <OperationsCards cfg={cfg} reload={reload} />
      <WritingCard cfg={cfg} reload={reload} />
    </div>
  )
}

function ModeCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  return (
    <Card title="Mock mode">
      <Check checked={cfg.mockMode} onChange={(v) => run(async () => { await api.studio.setMockMode(v); reload() })}>
        Mock mode (no network calls, no real spending)
      </Check>
      <p className="mt-2 text-[12px] text-muted">
        On: every flow runs with placeholder videos and canned text. Turn it off only after you saved keys and set caps.
      </p>
      <div className="mt-3">
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.studio.cheapTest()
              toast({ kind: r.ok ? 'success' : 'error', headline: r.ok ? 'Cheap test worked.' : 'Cheap test failed.', detail: `${r.message} Cost $${r.dollars.toFixed(2)}${r.mock ? ' (mock)' : ''}.` })
            })
          }
        >
          Cheap test (one 480p Lite 3 second clip)
        </Button>
      </div>
    </Card>
  )
}

const STATE_LABEL: Record<KeyStatus['state'], string> = {
  connected: 'Connected',
  not_set: 'Not set',
  failed: 'Failed',
  expiring: 'Expiring soon',
  untested: 'Saved, not tested',
}

function KeysCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: keys, reload } = useLoad(() => api.studio.keyStatus())
  const [vals, setVals] = useState<Partial<Record<KeyId, string>>>({})
  const [acct, setAcct] = useState<Partial<Record<KeyId, string>>>({})
  return (
    <Card title="Keys and connections">
      <p className="mb-3 text-[12px] text-muted">Keys are stored in the macOS Keychain. They are never shown again after you save them.</p>
      <div className="space-y-4">
        {keys?.map((k) => (
          <div key={k.id} className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <b className="text-[13px]">{k.label}</b>
              <span className={`text-[11px] font-bold uppercase ${k.state === 'connected' ? 'text-ok' : k.state === 'failed' ? 'text-bad' : 'text-muted'}`}>{STATE_LABEL[k.state]}</span>
            </div>
            {k.has && <div className="mt-1 text-[12px] text-muted">{k.masked}{k.account ? `  (${k.account})` : ''}{k.lastTestAt ? `  Last test ${k.lastTestAt.slice(0, 16).replace('T', ' ')} UTC: ${k.lastMessage}` : ''}</div>}
            <div className="mt-2 flex gap-2">
              {k.id === 'bluesky' && (
                <Input className="w-56" placeholder="handle.bsky.social" value={acct.bluesky ?? k.account} onChange={(e) => setAcct({ ...acct, bluesky: e.target.value })} />
              )}
              <Input type="password" autoComplete="off" placeholder={k.has ? 'Paste a new value to replace' : 'Paste here'} value={vals[k.id] ?? ''} onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })} />
              <Button disabled={busy || (!vals[k.id] && !(k.id === 'bluesky' && acct.bluesky))} onClick={() => run(async () => { if (vals[k.id]) await api.studio.setKey(k.id, vals[k.id] as string, acct[k.id]); setVals({ ...vals, [k.id]: '' }); reload() })}>
                {k.has ? 'Replace' : 'Save'}
              </Button>
              <Button disabled={busy || !k.has} onClick={() => run(async () => { const r = await api.studio.testKey(k.id); toast({ kind: r.ok ? 'success' : 'error', headline: r.ok ? 'Test passed.' : 'Test failed.', detail: r.message }); reload() })}>Test connection</Button>
              <Button variant="danger" disabled={busy || !k.has} onClick={() => run(async () => { await api.studio.removeKey(k.id); reload() })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">Facebook, Instagram, TikTok and YouTube connections stay on the Connections screen.</p>
    </Card>
  )
}

function CapField({ label, cap, onChange }: { label: string; cap: Cap; onChange: (c: Cap) => void }) {
  const [text, setText] = useState(String(cap.value))
  useEffect(() => setText(String(cap.value)), [cap.value])
  const err = cap.none ? null : capError(text)
  return (
    <div>
      <Field label={label} hint={err ? <span className="text-bad">{err}</span> : undefined}>
        <div className="flex items-center gap-3">
          <span>$</span>
          <Input
            className="w-32"
            inputMode="decimal"
            disabled={cap.none}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (!capError(e.target.value)) onChange({ value: Number(e.target.value), none: cap.none })
            }}
          />
          <Check checked={cap.none} onChange={(none) => onChange({ value: cap.value, none })}>No spend cap</Check>
        </div>
      </Field>
    </div>
  )
}

function CapsCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const [, run] = useBusy()
  const { data: brands, reload: reloadBrands } = useLoad(() => api.studio.brands())
  const save = (patch: Partial<StudioConfig>) => run(async () => { await api.studio.setConfig(patch); reload() })
  return (
    <Card title="Spend caps">
      <p className="mb-3 text-[12px] text-muted">Caps are hard stops. A step that would cross an enabled cap does not run, and you get one alert. Values from 0 to {CAP_MAX}. The month resets on the 1st, Eastern time.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <CapField label="Global monthly cap" cap={cfg.globalCap} onChange={(c) => save({ globalCap: c })} />
        <CapField label="AI text (Anthropic) monthly cap" cap={cfg.aiTextCap} onChange={(c) => save({ aiTextCap: c })} />
        <CapField label="Per episode cap (default)" cap={cfg.perEpisodeCapDefault} onChange={(c) => save({ perEpisodeCapDefault: c })} />
      </div>
      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase text-muted">Per brand monthly cap</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {brands?.map((b) => (
          <CapField key={b.brandId} label={b.name} cap={b.config.monthlyCap} onChange={(c) => run(async () => { await api.studio.setBrand(b.brandId, { monthlyCap: c }); reloadBrands() })} />
        ))}
      </div>
      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase text-muted">Per episode cap override (a brand set to "No spend cap" uses the default above)</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {brands?.map((b) => (
          <CapField key={b.brandId} label={b.name} cap={b.config.perEpisodeCap} onChange={(c) => run(async () => { await api.studio.setBrand(b.brandId, { perEpisodeCap: c }); reloadBrands() })} />
        ))}
      </div>
    </Card>
  )
}

function GenerateCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const [, run] = useBusy()
  const row = (format: 'short' | 'long', title: string) => (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase text-muted">{title}</h3>
      <div className="space-y-1">
        <Check checked={cfg.formatModel[format] === 'lite'} onChange={(v) => run(async () => { await api.studio.setFormatModel(format, 'lite', v); reload() })}>Lite (${cfg.prices.video.lite[cfg.formatResolution[format]].toFixed(2)} per second)</Check>
        <br />
        <Check checked={cfg.formatModel[format] === 'standard'} onChange={(v) => run(async () => { await api.studio.setFormatModel(format, 'standard', v); reload() })}>1.5 (${cfg.prices.video.standard[cfg.formatResolution[format]].toFixed(2)} per second)</Check>
      </div>
    </div>
  )
  return (
    <Card title="Generate settings">
      <div className="grid gap-4 md:grid-cols-2">
        {row('short', 'Shorts')}
        {row('long', 'Long videos')}
      </div>
      <p className="mt-2 text-[12px] text-muted">Exactly one is checked for each. Prices, model names and the retake multiplier ({cfg.retakeMultiplier}x) are edited in the studio config.</p>
    </Card>
  )
}

function ProductionCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const [, run] = useBusy()
  const save = (patch: Partial<StudioConfig>) => run(async () => { await api.studio.setConfig(patch); reload() })
  return (
    <Card title="Production and QC">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Video QC">
          <Select value={cfg.qcMode} onChange={(e) => save({ qcMode: e.target.value as never })}>
            <option value="auto">Auto (decides by itself)</option>
            <option value="off">Off</option>
          </Select>
        </Field>
        <Field label="Retries per clip">
          <Input value={cfg.qcClipRetryCap} onChange={(e) => Number(e.target.value) >= 0 && save({ qcClipRetryCap: Number(e.target.value) })} />
        </Field>
        <Field label="Paid video requests at once">
          <Input value={cfg.paidConcurrency} onChange={(e) => Number(e.target.value) >= 1 && save({ paidConcurrency: Number(e.target.value) })} />
        </Field>
        <Field label="Retake multiplier (estimates)">
          <Input value={cfg.retakeMultiplier} onChange={(e) => Number(e.target.value) >= 1 && save({ retakeMultiplier: Number(e.target.value) })} />
        </Field>
      </div>
      <p className="mt-2 text-[12px] text-muted">A clip that fails QC is retried with a prompt the text agent fixed. After the retries it is flagged, you get one alert, and only that video stops.</p>
    </Card>
  )
}

function BrandAssetsRow({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.assetList(brandId), [brandId])
  const [prompt, setPrompt] = useState('')
  const pick = async (kind: 'opening' | 'outro' | 'reference_image') => {
    const files = kind === 'reference_image' ? await api.media.pickImages(true) : await api.media.pickVideos(false)
    for (const f of files) await api.studio.addAsset(brandId, kind, f)
    reload()
  }
  const of = (k: string) => (data ?? []).filter((a) => a.kind === k)
  return (
    <div className="mt-3 rounded-md border border-line p-3 text-[13px]">
      <b>Opening, outro and reference images</b>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {(['opening', 'outro'] as const).map((k) => (
          <div key={k}>
            <div className="text-[11px] font-semibold uppercase text-muted">{k}</div>
            <div className="text-[12px]">{of(k)[0]?.name ?? 'Not set'}</div>
            <div className="mt-1 flex gap-2">
              <Button disabled={busy} onClick={() => run(async () => pick(k))}>Import video</Button>
              {of(k)[0] && <Button variant="danger" disabled={busy} onClick={() => run(async () => { await api.studio.removeAsset(brandId, of(k)[0].id); reload() })}>Remove</Button>}
            </div>
          </div>
        ))}
        <div>
          <div className="text-[11px] font-semibold uppercase text-muted">Reference images ({of('reference_image').length})</div>
          <div className="text-[12px]">Up to 14. Used so characters look the same.</div>
          <div className="mt-1 flex gap-2"><Button disabled={busy} onClick={() => run(async () => pick('reference_image'))}>Add images</Button>
            {of('reference_image').length > 0 && <Button variant="danger" disabled={busy} onClick={() => run(async () => { for (const a of of('reference_image')) await api.studio.removeAsset(brandId, a.id); reload() })}>Clear</Button>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Input placeholder="Or describe an opening or outro to generate once (about 5 seconds)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {(['opening', 'outro'] as const).map((k) => (
          <Button key={k} disabled={busy || !prompt.trim()} onClick={() => run(async () => { const r = await api.studio.generateSlot(brandId, k, prompt); reload(); toast({ kind: 'success', headline: `${k} generated once.`, detail: `It costs $${r.dollars.toFixed(2)} now and nothing on later episodes${r.mock ? ' (mock)' : ''}.` }) })}>Generate {k}</Button>
        ))}
      </div>
    </div>
  )
}

function BrandsCard() {
  const { data: brands, reload } = useLoad(() => api.studio.brands())
  return (
    <Card title="Brands: cadence, platforms, flags">
      <div className="space-y-4">
        {brands?.map((b) => <BrandRow key={b.brandId} id={b.brandId} name={b.name} cfg={b.config} nextDue={b.nextDue} reload={reload} />)}
      </div>
    </Card>
  )
}

function BrandRow({ id, name, cfg, nextDue, reload }: { id: number; name: string; cfg: StudioBrandConfig; nextDue: string | null; reload: () => void }) {
  const [, run] = useBusy()
  const [n, setN] = useState(String(cfg.everyN))
  const [what, setWhat] = useState<{ current: number; proposed: number } | null>(null)
  const save = (patch: Partial<StudioBrandConfig>) => run(async () => { await api.studio.setBrand(id, patch); reload() })
  const long = cfg.format === 'long'
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <b>{name}</b>
        <span className="text-[12px] text-muted">{long ? 'Long, 16:9, YouTube only' : 'Short, 9:16'}. Next due: {nextDue ?? 'none'}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Cadence">
          <Select value={cfg.cadenceMode} onChange={(e) => save({ cadenceMode: e.target.value as never })}>
            <option value="every_n">Every N days</option>
            <option value="weekly">Weekly schedule</option>
          </Select>
        </Field>
        {cfg.cadenceMode === 'every_n' ? (
          <Field label="Every N days" hint="Applies from the next due date forward.">
            <div className="flex gap-2">
              <Input className="w-20" value={n} onChange={async (e) => { setN(e.target.value); const v = Number(e.target.value); if (Number.isInteger(v) && v >= 1) setWhat(await api.studio.cadenceWhatIf(id, v)) }} />
              <Button disabled={!(Number.isInteger(Number(n)) && Number(n) >= 1) || Number(n) === cfg.everyN} onClick={() => save({ everyN: Number(n) }).then(() => setWhat(null))}>Save</Button>
            </div>
            {what && <div className="mt-1 text-[12px]">Estimated about ${what.current.toFixed(2)} a month now, ${what.proposed.toFixed(2)} a month at {n} day(s).</div>}
          </Field>
        ) : (
          <Field label="Post days">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, i) => (
                <Check key={w} checked={cfg.postDays.includes(i + 1)} onChange={(v) => save({ postDays: v ? [...cfg.postDays, i + 1].sort() : cfg.postDays.filter((d) => d !== i + 1) })}>{w}</Check>
              ))}
            </div>
          </Field>
        )}
        <Field label="Production run time (Eastern)">
          <Input value={cfg.runTime} onChange={(e) => /^\d{1,2}:\d{2}$/.test(e.target.value) && save({ runTime: e.target.value })} />
        </Field>
        <Field label="Script runway days">
          <Input value={cfg.runwayDays} onChange={(e) => Number(e.target.value) >= 0 && save({ runwayDays: Number(e.target.value) })} />
        </Field>
        <Field label="Resolution">
          <Select value={cfg.resolution} onChange={(e) => save({ resolution: e.target.value as never })}>
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p (costs much more)</option>
          </Select>
        </Field>
        <Field label="Captions">
          <Select value={cfg.captionMode} onChange={(e) => save({ captionMode: e.target.value as never })}>
            <option value="sidecar">Sidecar file (.srt)</option>
            <option value="burn">Burned into the picture</option>
            <option value="off">None</option>
          </Select>
        </Field>
        <Field label="Comments">
          <Select value={cfg.commentsMode} onChange={(e) => save({ commentsMode: e.target.value as never })}>
            <option value="auto">Auto reply</option>
            <option value="draft">Draft only</option>
            <option value="off">Off</option>
          </Select>
        </Field>
      </div>
      <BrandAssetsRow brandId={id} />
      <div className="mt-3 flex flex-wrap gap-4">
        {STUDIO_PLATFORMS.map((p) => (
          <Check key={p} checked={cfg.platforms[p]} disabled={long && p !== 'youtube'} onChange={(v) => save({ platforms: { ...cfg.platforms, [p]: v } })}>{p}</Check>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Check checked={cfg.paused} onChange={(v) => save({ paused: v })}>Pause this brand</Check>
        <Check checked={cfg.aiDisclosure} onChange={(v) => save({ aiDisclosure: v })}>AI disclosure</Check>
        <Check checked={cfg.madeForKids} onChange={(v) => save({ madeForKids: v })}>Made for kids</Check>
        <Check checked={cfg.holidayTieIns} onChange={(v) => save({ holidayTieIns: v })}>Holiday tie-ins</Check>
        <Check checked={cfg.useOpeningOutro} onChange={(v) => save({ useOpeningOutro: v })}>Shared opening and outro</Check>
        {!long && <Check checked={cfg.openingFrame} onChange={(v) => save({ openingFrame: v })}>Strong opening frame (YouTube Shorts thumbnail)</Check>}
        {long && <Check checked={cfg.addOpeningOutroOnIngest} onChange={(v) => save({ addOpeningOutroOnIngest: v })}>Add opening and outro on ingest</Check>}
        {long && <Check checked={cfg.hollowViaApi} onChange={(v) => save({ hollowViaApi: v })}>Make this brand's video through the API</Check>}
      </div>
    </div>
  )
}

function RetentionCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [report, setReport] = useState<string | null>(null)
  return (
    <Card title="Retention">
      <p className="mb-2 text-[12px] text-muted">After this many days the Archivist deletes the video and the full size thumbnail of posted items. Episode packages, small previews and stats are kept forever. It runs daily at 3:00 AM Eastern.</p>
      <div className="flex items-end gap-3">
        <Field label="Days to keep videos">
          <Input className="w-24" value={cfg.retentionDays} onChange={(e) => Number(e.target.value) >= 1 && run(async () => { await api.studio.setConfig({ retentionDays: Number(e.target.value) }); reload() })} />
        </Field>
        <Button disabled={busy} onClick={() => run(async () => { const r = await api.studio.purge(true); setReport(`Would remove ${r.count} item(s), ${(r.bytes / 1024 / 1024).toFixed(1)} MB:\n` + r.items.map((i) => `- ${i.title}: ${i.files.map((f) => f.kind).join(', ')}`).join('\n')) })}>Dry run purge</Button>
        <Button variant="danger" disabled={busy} onClick={() => run(async () => { const r = await api.studio.purge(false); toast({ kind: 'info', headline: 'Purge done.', detail: `${r.count} item(s) cleaned.` }) })}>Purge now</Button>
        <Button disabled={busy} onClick={() => run(async () => { const n = await api.studio.backfillPosted(); toast({ kind: 'info', headline: 'Backfill done.', detail: `${n} past item(s) added to the calendar.` }) })}>Backfill calendar from Posted folders</Button>
      </div>
      {report && <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-bg p-3 text-[12px]">{report}</pre>}
    </Card>
  )
}

function WritingCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const [text, setText] = useState(cfg.roboticPhrases.join('\n'))
  const [, run] = useBusy()
  return (
    <Card title="Writing checks">
      <p className="mb-2 text-[12px] text-muted">Every agent text is rejected and rewritten if it has an em dash or one of these phrases. One phrase per line.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2">
        <Button onClick={() => run(async () => { await api.studio.setConfig({ roboticPhrases: text.split('\n').map((s) => s.trim()).filter(Boolean) }); reload() })}>Save phrases</Button>
      </div>
    </Card>
  )
}

function GuidelinesCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.guidelineInfo())
  const [text, setText] = useState('')
  useEffect(() => { if (data) setText(data.current.text) }, [data?.current.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  return (
    <Card
      title="Thumbnail guidelines"
      actions={<Button disabled={busy} onClick={() => run(async () => { const r = await api.studio.refreshGuidelines(); toast({ kind: r.applied ? 'success' : 'info', headline: 'Monthly check', detail: r.note }); reload() })}>Check the platforms now</Button>}
    >
      <p className="mb-2 text-[12px] text-muted">The Thumbnail agent reads this file on every run. Every change is a new version, so nothing is ever lost. It also checks the platforms' own help pages once a month and applies small, safe edits by itself.</p>
      {data.proposal && (
        <div className="mb-3 rounded-md border border-warn p-3 text-[13px]">
          A bigger change is waiting: {data.proposal.changes.join('; ') || 'rewritten guidelines'}.
          <div className="mt-2"><Button onClick={() => run(async () => { await api.studio.approveGuidelineProposal(); reload() })}>Use it</Button></div>
        </div>
      )}
      <Textarea className="min-h-[220px] font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-3">
        <Button variant="primary" disabled={busy || text === data.current.text} onClick={() => run(async () => { await api.studio.saveGuidelines(text, 'Edited by the owner.'); reload() })}>Save as a new version</Button>
        <span className="text-[12px] text-muted">Version {data.current.id} ({data.current.source})</span>
      </div>
      <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase text-muted">History</h3>
      {data.history.slice(0, 8).map((h) => (
        <div key={h.id} className="flex items-center justify-between border-b border-line py-1 text-[12px]">
          <span>v{h.id}, {h.createdUtc.slice(0, 16).replace('T', ' ')} UTC, {h.source}. {h.note}</span>
          {h.id !== data.current.id && <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api.studio.revertGuidelines(h.id); reload() })}>Revert to this</Button>}
        </div>
      ))}
    </Card>
  )
}

function CapsTableCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const [, run] = useBusy()
  const { data } = useLoad(() => api.studio.platformCaps(), [JSON.stringify(cfg.platformCaps)])
  if (!data) return null
  const set = (key: string, field: string, value: number) =>
    run(async () => { await api.studio.setConfig({ platformCaps: { ...cfg.platformCaps, [key]: { ...((cfg.platformCaps[key] as object) ?? {}), [field]: value } } } as never); reload() })
  const rows = Object.entries(data) as Array<[string, Record<string, any>]>
  return (
    <Card title="Platform limits">
      <p className="mb-2 text-[12px] text-muted">Filled from the platforms' own docs. A video that does not fit a platform skips that platform only. Edit a number when a platform changes its rules.</p>
      <div className="overflow-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="text-muted"><tr><th>Platform</th><th>Max seconds</th><th>Max MB</th><th>Text limit</th><th>Cover</th></tr></thead>
          <tbody>
            {rows.map(([k, c]) => (
              <tr key={k} className="border-t border-line align-top">
                <td className="py-1"><b>{c.label}</b><div className="max-w-[360px] text-[11px] text-muted">{c.notes}</div></td>
                <td><Input className="w-24" defaultValue={c.maxDurationSeconds} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== c.maxDurationSeconds && set(k, 'maxDurationSeconds', Number(e.target.value))} /></td>
                <td><Input className="w-24" defaultValue={c.maxFileMB} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== c.maxFileMB && set(k, 'maxFileMB', Number(e.target.value))} /></td>
                <td><Input className="w-24" defaultValue={c.textMax} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== c.textMax && set(k, 'textMax', Number(e.target.value))} /></td>
                <td className="whitespace-nowrap">{String(c.cover).replaceAll('_', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PublicHostCard({ cfg, reload }: { cfg: StudioConfig; reload: () => void }) {
  const { toast } = useApp()
  const [, run] = useBusy()
  const h = cfg.publicHost
  const save = (patch: Partial<typeof h>) => run(async () => { await api.studio.setConfig({ publicHost: { ...h, ...patch } } as never); reload() })
  return (
    <Card title="Public host (needed for Threads video)">
      <p className="mb-2 text-[12px] text-muted">Threads downloads the video from a public web address, so each video is put in a Cloudflare R2 bucket for a few minutes and deleted right after. The two keys are on the key list above. See docs/SETUP_E_CLOUDFLARE_R2_IF_NEEDED.md. Set the bucket rule to delete files after 10 days if you also want Instagram cover pictures.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="S3 endpoint (https://ACCOUNT.r2.cloudflarestorage.com)"><Input defaultValue={h.endpoint} onBlur={(e) => e.target.value !== h.endpoint && save({ endpoint: e.target.value.trim() })} /></Field>
        <Field label="Bucket name"><Input defaultValue={h.bucket} onBlur={(e) => e.target.value !== h.bucket && save({ bucket: e.target.value.trim() })} /></Field>
        <Field label="Public address of the bucket"><Input defaultValue={h.publicBase} onBlur={(e) => e.target.value !== h.publicBase && save({ publicBase: e.target.value.trim() })} /></Field>
      </div>
      <div className="mt-3"><Button onClick={() => run(async () => { const r = await api.studio.threadsRefresh(); toast({ kind: r.ok ? 'success' : 'error', headline: r.ok ? 'Threads token refreshed.' : 'Could not refresh.', detail: r.message }) })}>Refresh the Threads token now</Button></div>
    </Card>
  )
}
