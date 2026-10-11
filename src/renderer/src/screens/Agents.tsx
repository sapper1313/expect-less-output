import { useEffect, useState } from 'react'
import { COPY } from '@shared/copy'
import type { McpConfig, Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Select, useBusy } from '../ui'

function CopyBox({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          }}
        >
          {done ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  )
}

export function AgentsCard({
  s,
  save,
}: {
  s: Settings
  save: (patch: Partial<Settings>) => Promise<void>
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.agent.status())
  const [mcp, setMcp] = useState<McpConfig | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [port, setPort] = useState(String(s.agentApiPort))
  useEffect(() => setPort(String(s.agentApiPort)), [s.agentApiPort])
  useEffect(() => {
    void api.agent.mcpConfig().then(setMcp)
  }, [s.agentApiPort])

  return (
    <Card title="Agents (local API and MCP)">
      <p className="mb-4 text-[13px] text-muted">
        Lets a program or an AI assistant on this Mac create and manage posts, using the same rules
        as this screen. It is off until you turn it on, it only listens on this Mac (127.0.0.1), and
        it needs the token below. Agents can never connect or disconnect accounts, change keys, or
        delete files. Scheduled posts only go out while this app is running (it keeps running in the
        menu bar).
      </p>

      <div className="space-y-4 rounded-md border border-line p-4">
        <Check checked={s.agentApiEnabled} onChange={(v) => save({ agentApiEnabled: v })}>
          <b>Turn on the local API</b>
        </Check>
        <div className="grid gap-4 md:grid-cols-[160px_1fr]">
          <Field label="Port">
            <Input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={() =>
                Number(port) !== s.agentApiPort &&
                Number(port) >= 1024 &&
                save({ agentApiPort: Number(port) })
              }
            />
          </Field>
          <div className="self-end pb-2 text-[13px]">
            {st?.running ? (
              <span className="font-semibold text-ok">Running on http://127.0.0.1:{st.port}</span>
            ) : (
              <span className="text-muted">Not running.</span>
            )}
            {st?.error && <div className="font-semibold text-bad">{st.error}</div>}
          </div>
        </div>

        <Check checked={!s.agentMaySchedule} onChange={(v) => save({ agentMaySchedule: !v })}>
          <b>Agents may create drafts only</b>
        </Check>
        <div className="ml-6 text-[12px] text-muted">
          {s.agentMaySchedule
            ? 'Agents CAN put posts on the schedule. A mistake by an agent can post something for real.'
            : 'On (recommended). An agent that asks to schedule gets a clear "drafts_only" error and nothing is created. You review drafts in the Queue and schedule them yourself.'}
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-md border border-line p-4">
        <div className="text-[13px]">
          <b>Token.</b> {st?.tokenSet ? `Saved: ${st.tokenMasked}` : 'No token yet.'}
        </div>
        {token ? (
          <div className="space-y-2 rounded-md border border-warn p-3">
            <div className="text-[12px] font-semibold text-warn">
              Copy this now. It is shown only once.
            </div>
            <CopyBox label="Your token" text={token} />
            <Button onClick={() => setToken(null)}>I copied it</Button>
          </div>
        ) : (
          <Button
            variant={st?.tokenSet ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={async () => {
              if (
                st?.tokenSet &&
                !window.confirm(
                  'Make a new token? The old one stops working right away, and anything using it must be updated.',
                )
              )
                return
              const r = await run(() => api.agent.generateToken())
              if (r) {
                setToken(r.token)
                reload()
                toast({
                  kind: 'success',
                  headline: COPY.success,
                  detail: 'New token made. Copy it now.',
                })
              }
            }}
          >
            {st?.tokenSet ? 'Make a new token' : 'Make a token'}
          </Button>
        )}
      </div>

      {mcp && (
        <div className="mt-4 space-y-4 rounded-md border border-line p-4">
          <div className="display text-xl">Connect Claude (MCP)</div>
          {!mcp.scriptExists && (
            <div className="text-[12px] font-semibold text-bad">
              The MCP file is missing at {mcp.scriptPath}. Run npm run build:mcp in the project,
              then reopen this screen.
            </div>
          )}
          <div className="text-[12px] text-muted">
            File: <span className="font-mono">{mcp.scriptPath}</span>
            <br />
            Node: <span className="font-mono">{mcp.nodePath}</span>
          </div>
          <CopyBox
            label="Claude Code: paste in Terminal (replace PASTE_YOUR_TOKEN_HERE)"
            text={mcp.claudeCodeCommand}
          />
          <CopyBox
            label={`Claude Desktop: merge into ${mcp.desktopConfigPath}`}
            text={mcp.desktopJson}
          />
        </div>
      )}
    </Card>
  )
}

export function TextAssistCard({
  s,
  save,
}: {
  s: Settings
  save: (patch: Partial<Settings>) => Promise<void>
}) {
  const [busy, run] = useBusy()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [url, setUrl] = useState(s.llmBaseUrl)
  const [model, setModel] = useState(s.llmModel)
  useEffect(() => setUrl(s.llmBaseUrl), [s.llmBaseUrl])
  useEffect(() => setModel(s.llmModel), [s.llmModel])
  return (
    <Card title="Text assist (local AI)">
      <p className="mb-4 text-[13px] text-muted">
        Adds Suggest buttons next to the title, caption and hashtags. It talks to a model running on
        this Mac (Ollama or LM Studio). Only the brand name, title and caption are sent, never your
        videos or keys. Off by default.
      </p>
      <div className="space-y-4">
        <Field label="Provider">
          <Select
            className="w-72"
            value={s.llmProvider}
            onChange={(e) => save({ llmProvider: e.target.value as Settings['llmProvider'] })}
          >
            <option value="none">Off</option>
            <option value="studio-local">
              My Local AI machine (Ollama from the Local AI section in Settings, under AI models and
              Local AI)
            </option>
            <option value="openai-compatible">Another local model (OpenAI compatible)</option>
          </Select>
        </Field>
        {s.llmProvider === 'studio-local' && <StudioLocalText />}
        {s.llmProvider === 'openai-compatible' && (
          <>
            <Field
              label="Server address"
              hint="Ollama: http://localhost:11434/v1. LM Studio: http://localhost:1234/v1."
            >
              <div className="flex gap-2">
                <Input
                  spellCheck={false}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => url !== s.llmBaseUrl && save({ llmBaseUrl: url })}
                />
                <Button
                  onClick={() => {
                    setUrl('http://localhost:11434/v1')
                    void save({ llmBaseUrl: 'http://localhost:11434/v1' })
                  }}
                >
                  Ollama
                </Button>
                <Button
                  onClick={() => {
                    setUrl('http://localhost:1234/v1')
                    void save({ llmBaseUrl: 'http://localhost:1234/v1' })
                  }}
                >
                  LM Studio
                </Button>
              </div>
            </Field>
            <Field
              label="Model name"
              hint="Exactly as the server lists it, for example llama3.1 or qwen2.5."
            >
              <Input
                spellCheck={false}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model !== s.llmModel && save({ llmModel: model })}
              />
            </Field>
            <Check checked={s.llmAllowLan} onChange={(v) => save({ llmAllowLan: v })}>
              My model runs on another computer on my network
            </Check>
            {s.llmAllowLan && (
              <div className="ml-6 text-[12px] text-warn">
                Titles and captions will be sent to that computer over your network.
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button
                disabled={busy}
                onClick={async () => {
                  setResult(null)
                  const r = await run(() => api.textAssist.test())
                  if (r) setResult(r)
                }}
              >
                Test the model
              </Button>
              {result && (
                <span className={`text-[12px] font-semibold ${result.ok ? 'text-ok' : 'text-bad'}`}>
                  {result.message}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

/** Text assist through the Ollama machine set up on the Local AI section in Settings, under AI models and Local AI. */
function StudioLocalText() {
  const [busy, run] = useBusy()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const { data: cfg, reload: reloadCfg } = useLoad(() => api.studio.getConfig())
  const { data: models, reload: reloadModels } = useLoad(() => api.studio.modelOptions())
  const local = (models?.options ?? []).filter(
    (o) => o.kind === 'local' && !/embed|llava|vision|-vl/i.test(o.id),
  )
  return (
    <>
      <p className="text-[12px] text-muted">
        Uses the Ollama machine you set on the Local AI section in Settings, under AI models and
        Local AI{cfg?.local.ollamaHost ? ` (${cfg.local.ollamaHost})` : ''}. Only the brand name,
        title and caption are sent to it.
      </p>
      <Field
        label="Text model"
        hint="A 7B or 8B model is a good fit for suggestions. The list comes from your Ollama machine."
      >
        <div className="flex gap-2">
          <Select
            className="w-80"
            value={cfg?.local.textModel ?? ''}
            onChange={(e) =>
              run(async () => {
                await api.studio.setConfig({ local: { textModel: e.target.value } } as never)
                reloadCfg()
              })
            }
          >
            <option value="">Pick a model</option>
            {local.map((o) => (
              <option key={o.id} value={o.id.replace(/^ollama:/, '')}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button onClick={() => reloadModels()}>Refresh list</Button>
        </div>
      </Field>
      {models && !models.localOnline && (
        <div className="text-[12px] text-warn">
          {models.localError ??
            'Set the Ollama host on the Local AI section in Settings, under AI models and Local AI.'}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.textAssist.autoSetup())
            if (r) {
              setResult(r)
              reloadCfg()
            }
          }}
        >
          Pick a model for me
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setResult(null)
            const r = await run(() => api.textAssist.test())
            if (r) setResult(r)
          }}
        >
          Test the model
        </Button>
        {result && (
          <span className={`text-[12px] font-semibold ${result.ok ? 'text-ok' : 'text-bad'}`}>
            {result.message}
          </span>
        )}
      </div>
    </>
  )
}
