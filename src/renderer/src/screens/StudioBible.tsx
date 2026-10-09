import { useEffect, useState } from 'react'
import type { SeriesBibleData } from '@shared/studio/bible'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Select, Textarea, useBusy } from '../ui'

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean)

export function StudioBible() {
  const { toast } = useApp()
  const [, run] = useBusy()
  const { data: brands } = useLoad(() => api.studio.brands())
  const [brandId, setBrandId] = useState<number | null>(null)
  const id = brandId ?? brands?.[0]?.brandId ?? null
  const { data, reload } = useLoad(() => (id ? api.studio.bible(id) : Promise.resolve(null)), [id])
  const { data: ideas, reload: reloadIdeas } = useLoad(() => (id ? api.studio.ideas(id) : Promise.resolve([])), [id])
  const [draft, setDraft] = useState<SeriesBibleData | null>(null)
  const [newIdeas, setNewIdeas] = useState('')
  useEffect(() => setDraft(data?.bible ?? null), [data])
  if (!brands || !id || !data || !draft) return null
  const set = <K extends keyof SeriesBibleData>(k: K, v: SeriesBibleData[K]) => setDraft({ ...draft, [k]: v })
  const save = () => run(async () => { await api.studio.setBible(id, draft); toast({ kind: 'success', headline: 'Bible saved.' }); reload() })
  const area = (label: string, k: keyof SeriesBibleData, asLines = false) => (
    <Field label={label}>
      <Textarea
        value={asLines ? (draft[k] as string[]).join('\n') : (draft[k] as string)}
        onChange={(e) => set(k, (asLines ? lines(e.target.value) : e.target.value) as never)}
      />
    </Field>
  )
  const readFiles = async (files: FileList | null) => {
    if (!files) return
    let n = 0
    for (const f of Array.from(files)) {
      if (!/\.(md|txt|markdown)$/i.test(f.name)) continue
      await api.studio.importSkill(id, f.name, await f.text())
      n++
    }
    toast({ kind: n ? 'success' : 'error', headline: n ? `Imported ${n} skill file(s).` : 'No Markdown or text files found.' })
    reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-64" value={id} onChange={(e) => setBrandId(Number(e.target.value))}>
          {brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
        </Select>
        <Button variant="primary" onClick={save}>Save bible</Button>
        <Button onClick={() => run(async () => { await navigator.clipboard.writeText(await api.studio.exportBible(id)); toast({ kind: 'success', headline: 'Bible copied as Markdown.' }) })}>Export Markdown</Button>
        <Button onClick={() => run(async () => { await api.studio.writeNow(id); toast({ kind: 'info', headline: 'The Writer is on it.', detail: 'Watch the Library and the Director\'s Log.' }) })}>Write an episode now</Button>
      </div>
      <Card title="The bible">
        <div className="grid gap-3 md:grid-cols-2">
          {area('Channel premise', 'premise')}
          {area('Audience', 'audience')}
          {area('Voice and tone rules', 'voiceAndTone')}
          {area('Formats and templates', 'formats')}
          {area('Running jokes (one per line)', 'runningJokes', true)}
          {area('Hook patterns (one per line)', 'hookPatterns', true)}
          {area('Do (one per line)', 'dos', true)}
          {area("Don't (one per line)", 'donts', true)}
          {area('Banned phrases (one per line)', 'bannedPhrases', true)}
          {area('Recurring segments (one per line)', 'recurringSegments', true)}
          {area('Platform notes', 'platformNotes')}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shortest video (seconds)"><Input value={draft.minSeconds} onChange={(e) => set('minSeconds', Number(e.target.value) || 0)} /></Field>
            <Field label="Longest video (seconds)"><Input value={draft.maxSeconds} onChange={(e) => set('maxSeconds', Number(e.target.value) || 0)} /></Field>
          </div>
        </div>
      </Card>
      <Card title="Characters" actions={<Button onClick={() => set('characters', [...draft.characters, { name: 'New character', look: '', personality: '', voice: '', catchphrases: [] }])}>Add character</Button>}>
        <div className="space-y-3">
          {draft.characters.map((c, i) => {
            const upd = (patch: Partial<typeof c>) => set('characters', draft.characters.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div key={i} className="grid gap-2 rounded-md border border-line p-3 md:grid-cols-2">
                <Field label="Name"><Input value={c.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="Catchphrases (one per line)"><Textarea className="min-h-[40px]" value={c.catchphrases.join('\n')} onChange={(e) => upd({ catchphrases: lines(e.target.value) })} /></Field>
                <Field label="Look"><Textarea className="min-h-[40px]" value={c.look} onChange={(e) => upd({ look: e.target.value })} /></Field>
                <Field label="Personality"><Textarea className="min-h-[40px]" value={c.personality} onChange={(e) => upd({ personality: e.target.value })} /></Field>
                <Field label="Voice"><Textarea className="min-h-[40px]" value={c.voice} onChange={(e) => upd({ voice: e.target.value })} /></Field>
                <div className="flex items-end"><Button variant="danger" onClick={() => set('characters', draft.characters.filter((_, j) => j !== i))}>Remove</Button></div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card title="Skills (imported files)">
        <p className="mb-2 text-[12px] text-muted">Character and channel skills are handed to the Writer with the bible on every call. Choose Markdown or text files, or a whole folder.</p>
        <div className="mb-3 flex gap-3 text-[13px]">
          <label>Files: <input type="file" multiple accept=".md,.txt,.markdown" onChange={(e) => readFiles(e.target.files)} /></label>
          <label>Folder: <input type="file" multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => readFiles(e.target.files)} /></label>
        </div>
        {data.skills.map((s) => (
          <div key={s.id} className="mb-3">
            <div className="mb-1 flex items-center justify-between"><b className="text-[13px]">{s.name}</b><Button variant="danger" onClick={() => run(async () => { await api.studio.removeSkill(id, s.id); reload() })}>Remove</Button></div>
            <Textarea defaultValue={s.text} onBlur={(e) => e.target.value !== s.text && run(async () => { await api.studio.updateSkill(id, s.id, e.target.value); reload() })} />
          </div>
        ))}
      </Card>
      <Card title="Ideas bank">
        <p className="mb-2 text-[12px] text-muted">The Writer uses the top idea and refills this list when it runs low. Edit freely.</p>
        {ideas?.map((i) => (
          <div key={i.id} className="flex items-center justify-between border-b border-line py-1 text-[13px]"><span>{i.text}</span><Button variant="ghost" onClick={() => run(async () => { await api.studio.removeIdea(id, i.id); reloadIdeas() })}>Remove</Button></div>
        ))}
        <div className="mt-2 flex gap-2">
          <Input placeholder="Add ideas, one per line is fine" value={newIdeas} onChange={(e) => setNewIdeas(e.target.value)} />
          <Button onClick={() => run(async () => { await api.studio.addIdeas(id, newIdeas.split('\n')); setNewIdeas(''); reloadIdeas() })}>Add</Button>
        </div>
      </Card>
      <HolidayCard />
      <AgentsCard />
    </div>
  )
}

function HolidayCard() {
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.holidays())
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const upcoming = (data ?? []).filter((h) => h.date >= new Date().toISOString().slice(0, 10)).slice(0, 30)
  return (
    <Card title="Holidays and fun days">
      <p className="mb-2 text-[12px] text-muted">The Director gives each Writer the next 21 days. Switch a day off or add your own. Each brand can turn tie-ins off on the Settings tab.</p>
      <div className="max-h-64 overflow-auto">
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center justify-between py-0.5 text-[13px]">
            <Check checked={h.enabled} onChange={(v) => run(async () => { await api.studio.setHolidayEnabled(h.id, v); reload() })}>{h.date}: {h.name} <span className="text-muted">({h.kind})</span></Check>
            {h.custom && <Button variant="ghost" onClick={() => run(async () => { await api.studio.removeHoliday(h.id); reload() })}>Remove</Button>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input className="w-40" placeholder="2026-12-31" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input placeholder="Name of the day" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => run(async () => { await api.studio.addHoliday(date, name); setDate(''); setName(''); reload() })}>Add day</Button>
      </div>
    </Card>
  )
}

function AgentsCard() {
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.agents())
  return (
    <Card title="Agents and their models">
      <p className="mb-2 text-[12px] text-muted">Each text agent can use its own Anthropic model. Leave empty for the default. Untick an agent to switch it off: its work waits until you tick it again.</p>
      {data?.map((a) => (
        <div key={a.name} className="grid items-center gap-2 border-b border-line py-2 md:grid-cols-[220px_1fr_260px]">
          <div className="flex items-center gap-2 text-[13px]">
            {a.toggleable ? <Check checked={a.enabled} onChange={(v) => run(async () => { await api.studio.setAgentEnabled(a.name, v); reload() })}>{''}</Check> : <span className="w-4" />}
            <b>{a.name}</b>
          </div>
          <span className="text-[12px] text-muted">{a.role}</span>
          <Input defaultValue={a.isDefault ? '' : a.model} placeholder={a.model} onBlur={(e) => run(async () => { await api.studio.setAgentModel(a.name, e.target.value); reload() })} />
        </div>
      ))}
    </Card>
  )
}
