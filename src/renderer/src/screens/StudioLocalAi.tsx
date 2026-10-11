import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Select, useBusy } from '../ui'

export function StudioLocalAi() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: cfg, reload: reloadCfg } = useLoad(() => api.studio.getConfig())
  const { data: list, reload } = useLoad(() => api.studio.localChecklist())
  const { data: steps } = useLoad(() => api.studio.localSetupSteps())
  const [host, setHost] = useState('')
  const [ram, setRam] = useState('')
  const [gpu, setGpu] = useState(false)
  const [rec, setRec] = useState<Awaited<ReturnType<typeof api.studio.localRecommend>> | null>(null)
  const [progress, setProgress] = useState<Array<{ model: string; pct: number; status: string }>>(
    [],
  )
  const [test, setTest] = useState<Awaited<ReturnType<typeof api.studio.localSelfTest>> | null>(
    null,
  )
  const [os, setOs] = useState<'windows' | 'linux'>('windows')
  useEffect(() => {
    if (cfg) setHost(cfg.local.ollamaHost)
  }, [cfg?.local.ollamaHost]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg) return null
  const l = cfg.local
  const save = (patch: Partial<typeof l>) =>
    run(async () => {
      await api.studio.setConfig({ local: { ...l, ...patch } as never })
      reloadCfg()
      reload()
    })

  return (
    <div className="space-y-4">
      <Card title="Where the local AI lives">
        <p className="mb-3 text-[12px] text-muted">
          The local model runs on another computer on your network. To move to a bigger machine
          later, only change the address here and press Test.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Ollama host (vision and embeddings)">
            <div className="flex gap-2">
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="http://192.168.1.50:11434"
              />
              <Button
                disabled={busy || host === l.ollamaHost}
                onClick={() => save({ ollamaHost: host.trim() })}
              >
                Save
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    reload()
                  })
                }
              >
                Test
              </Button>
            </div>
          </Field>
          <Field label="Whisper (speech to text)">
            <Select
              value={l.whisperMode}
              onChange={(e) => save({ whisperMode: e.target.value as never })}
            >
              <option value="mac">Run on this Mac (recommended)</option>
              <option value="remote">Run on another computer</option>
            </Select>
          </Field>
          {l.whisperMode === 'mac' ? (
            <Field label="Whisper command ({audio} is replaced by the file)">
              <Input
                defaultValue={l.whisperCommand}
                onBlur={(e) =>
                  e.target.value !== l.whisperCommand && save({ whisperCommand: e.target.value })
                }
              />
            </Field>
          ) : (
            <Field label="Whisper host">
              <Input
                defaultValue={l.whisperHost}
                onBlur={(e) =>
                  e.target.value !== l.whisperHost && save({ whisperHost: e.target.value })
                }
              />
            </Field>
          )}
          <Field label="Vision model">
            <Input
              defaultValue={l.visionModel}
              list="vision-models"
              onBlur={(e) =>
                e.target.value !== l.visionModel && save({ visionModel: e.target.value })
              }
            />
            <datalist id="vision-models">
              {rec?.vision.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.note}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Embedding model">
            <Input
              defaultValue={l.embedModel}
              list="embed-models"
              onBlur={(e) =>
                e.target.value !== l.embedModel && save({ embedModel: e.target.value })
              }
            />
            <datalist id="embed-models">
              {rec?.embed.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.note}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <div className="mt-3">
          <Check checked={l.useClaudeVision} onChange={(v) => save({ useClaudeVision: v })}>
            Use Claude vision for QC when the other computer is off (costs a little, counted in AI
            text spend)
          </Check>
        </div>
      </Card>

      <Card
        title="Checklist"
        actions={
          <Button disabled={busy} onClick={() => run(async () => reload())}>
            Check again
          </Button>
        }
      >
        <div className="space-y-2">
          {list?.map((i) => (
            <div key={i.id}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className={i.ok ? 'text-ok' : 'text-bad'}>{i.ok ? 'OK' : 'FIX'}</span>
                <b>{i.label}</b>
                <span className="text-muted">{i.detail}</span>
              </div>
              {!i.ok && (
                <ol className="ml-8 mt-1 list-decimal text-[12px] text-muted">
                  {i.fix.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Models and self test">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="RAM on that computer (GB)">
            <Input className="w-24" value={ram} onChange={(e) => setRam(e.target.value)} />
          </Field>
          <Check checked={gpu} onChange={setGpu}>
            It has a graphics card
          </Check>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const n = ram ? Number(ram) : null
                setRec(await api.studio.localRecommend(n, gpu))
                await api.studio.setConfig({ local: { ...l, ramGb: n, hasGpu: gpu } as never })
              })
            }
          >
            Recommend models
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const poll = setInterval(
                  async () => setProgress(await api.studio.localPullProgress()),
                  1000,
                )
                try {
                  await api.studio.localPull()
                  toast({ kind: 'success', headline: 'Models downloaded.' })
                } finally {
                  clearInterval(poll)
                  setProgress(await api.studio.localPullProgress())
                  reload()
                }
              })
            }
          >
            Download recommended models
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                setTest(await api.studio.localSelfTest())
                reloadCfg()
              })
            }
          >
            Run self test
          </Button>
        </div>
        {rec?.warning && <p className="mt-2 text-[12px] text-warn">{rec.warning}</p>}
        {progress.map((p) => (
          <div key={p.model} className="mt-2 text-[12px]">
            <div>
              {p.model}: {p.status} {p.pct}%
            </div>
            <div className="h-2 rounded bg-bg">
              <div className="h-2 rounded bg-accent" style={{ width: `${p.pct}%` }} />
            </div>
          </div>
        ))}
        {test && (
          <div className="mt-3 space-y-1 text-[13px]">
            {(['vision', 'embed', 'whisper'] as const).map((k) => (
              <div key={k}>
                <b className={test[k].ok ? 'text-ok' : 'text-bad'}>
                  {test[k].ok ? 'Pass' : 'Fail'}
                </b>{' '}
                {k}: {test[k].seconds.toFixed(1)} s. {test[k].message}
              </div>
            ))}
          </div>
        )}
        {(l.measured.vision || l.measured.embed || l.measured.whisper) && (
          <p className="mt-2 text-[12px] text-muted">
            Measured: vision {l.measured.vision?.toFixed(1) ?? '?'} s, embed{' '}
            {l.measured.embed?.toFixed(1) ?? '?'} s, whisper {l.measured.whisper?.toFixed(1) ?? '?'}{' '}
            s. Timeouts follow these numbers.
          </p>
        )}
      </Card>

      {steps && (
        <Card
          title="Setup steps for the other computer"
          actions={
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(
                  (os === 'windows' ? steps.windows : steps.linux)
                    .map((s, i) => `${i + 1}. ${s}`)
                    .join('\n') +
                    '\n\n' +
                    steps.warning,
                )
                toast({ kind: 'success', headline: 'Steps copied.' })
              }}
            >
              Copy these steps
            </Button>
          }
        >
          <div className="mb-2 flex gap-2">
            <Button
              variant={os === 'windows' ? 'primary' : 'secondary'}
              onClick={() => setOs('windows')}
            >
              Windows
            </Button>
            <Button
              variant={os === 'linux' ? 'primary' : 'secondary'}
              onClick={() => setOs('linux')}
            >
              Linux
            </Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            {(os === 'windows' ? steps.windows : steps.linux).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 rounded-md border border-bad p-2 text-[13px] font-semibold text-bad">
            {steps.warning}
          </p>
        </Card>
      )}
    </div>
  )
}
