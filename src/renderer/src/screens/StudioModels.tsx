import type { ModelOption } from '@shared/studio/modelCatalog'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, Card, Check, Input, Select, useBusy } from '../ui'

const money = (n: number) => (n === 0 ? 'free' : `$${n}`)

/** A model dropdown that shows what each choice costs. Empty means "use the default". */
export function ModelSelect({ value, options, defaultLabel, onPick }: { value: string; options: ModelOption[]; defaultLabel?: string; onPick: (id: string) => void }) {
  const claude = options.filter((o) => o.kind === 'claude')
  const local = options.filter((o) => o.kind === 'local')
  const known = !value || options.some((o) => o.id === value)
  return (
    <Select value={value} onChange={(e) => onPick(e.target.value)}>
      {defaultLabel !== undefined && <option value="">{defaultLabel}</option>}
      <optgroup label="Claude (paid)">
        {claude.map((o) => (
          <option key={o.id} value={o.id}>{o.label}: in {money(o.inPerM)}, out {money(o.outPerM)} per million</option>
        ))}
      </optgroup>
      {local.length > 0 && (
        <optgroup label="Your Ollama (free)">
          {local.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </optgroup>
      )}
      {!known && <option value={value}>Custom: {value}</option>}
    </Select>
  )
}

/** Which model each agent uses, and whether it is switched on. */
export function AgentModelsCard() {
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.agents())
  const { data: models } = useLoad(() => api.studio.modelOptions())
  const { data: cfg, reload: reloadCfg } = useLoad(() => api.studio.getConfig())
  const options = models?.options ?? []
  return (
    <Card title="Agents and their models">
      <p className="mb-2 text-[12px] text-muted">
        Each text agent can use its own model. Pick a cheaper one for simple jobs. Untick an agent to switch it off: its work waits until you tick it again. The guide below says what each model is good for.
      </p>
      {cfg && (
        <div className="mb-3 grid items-center gap-2 border-b border-line pb-3 md:grid-cols-[220px_1fr]">
          <b className="text-[13px]">Default for every agent</b>
          <ModelSelect value={cfg.defaultAgentModel} options={options} onPick={(id) => run(async () => { await api.studio.setConfig({ defaultAgentModel: id }); reloadCfg(); reload() })} />
        </div>
      )}
      {data?.map((a) => (
        <div key={a.name} className="grid items-center gap-2 border-b border-line py-2 md:grid-cols-[220px_1fr_340px]">
          <div className="flex items-center gap-2 text-[13px]">
            {a.toggleable ? <Check checked={a.enabled} onChange={(v) => run(async () => { await api.studio.setAgentEnabled(a.name, v); reload() })}>{''}</Check> : <span className="w-4" />}
            <b>{a.name}</b>
          </div>
          <span className="text-[12px] text-muted">{a.role}</span>
          <ModelSelect
            value={a.isDefault ? '' : a.model}
            options={options}
            defaultLabel={`Default (${a.isDefault ? a.model : cfg?.defaultAgentModel ?? ''})`}
            onPick={(id) => run(async () => { await api.studio.setAgentModel(a.name, id); reload() })}
          />
        </div>
      ))}
    </Card>
  )
}

/** The short list of models, what they cost, and what each one is good for. Prices can be edited. */
export function ModelGuideCard() {
  const [, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.modelOptions())
  return (
    <Card title="Models and prices">
      <p className="mb-3 text-[12px] text-muted">
        Prices are dollars per million tokens. Check Anthropic's price page now and then and fix a number here if it changed. Your own Ollama models cost nothing.
        {data && !data.localOnline && ` ${data.localError ?? 'Set the Ollama host on the Local AI section in Settings, under AI models and Local AI to see your local models.'}`}
        {data?.localOnline && ' Your Ollama machine is online.'}
      </p>
      <div className="space-y-3">
        {data?.options.map((o) => (
          <div key={o.id} className="grid gap-2 border-b border-line pb-3 md:grid-cols-[240px_1fr_210px]">
            <div className="text-[13px]">
              <b>{o.label}</b>
              <div className="text-[11px] text-muted">{o.id}</div>
            </div>
            <div className="text-[12px]">
              <div><b>Good for:</b> {o.bestFor}</div>
              {o.avoid && <div className="text-muted"><b>Not for:</b> {o.avoid}</div>}
            </div>
            {o.kind === 'claude' ? (
              <div className="flex items-center gap-1 text-[12px]">
                in <Input className="w-16" defaultValue={String(o.inPerM)} onBlur={(e) => run(async () => { await api.studio.setModelPrice(o.id, Number(e.target.value), o.outPerM); reload() })} />
                out <Input className="w-16" defaultValue={String(o.outPerM)} onBlur={(e) => run(async () => { await api.studio.setModelPrice(o.id, o.inPerM, Number(e.target.value)); reload() })} />
              </div>
            ) : (
              <div className="text-[12px] font-bold">Free</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3"><Button onClick={() => reload()}>Check for local models again</Button></div>
    </Card>
  )
}
