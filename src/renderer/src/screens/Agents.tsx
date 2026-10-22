import { useEffect, useState } from 'react'
import { COPY } from '@shared/copy'
import type { McpConfig, Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Dialog, Field, Input, Select, useBusy } from '../ui'

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

        <div>
          <Check checked={s.agentApiTailscale} onChange={(v) => save({ agentApiTailscale: v })}>
            <b>Also listen on Tailscale</b> (so a bot computer on your Tailscale network can reach
            this app)
          </Check>
          <div className="ml-6 text-[12px] text-muted">
            {st?.tailscaleAddress
              ? `This Mac's Tailscale address is ${st.tailscaleAddress}. ${st.tailscaleListening ? `The API is also at http://${st.tailscaleAddress}:${st.port}.` : ''}`
              : 'Tailscale does not seem to be running on this Mac.'}{' '}
            Nothing else on the internet or your Wi-Fi can reach it, and every request still needs a
            token. The Mac must be awake. When it sleeps, the bot computer sees the app as
            unreachable.
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

        <div className="mt-3" />
        <Check checked={s.agentMayChangeStudio} onChange={(v) => save({ agentMayChangeStudio: v })}>
          <b>Agents may change Studio settings</b>
        </Check>
        <div className="ml-6 text-[12px] text-muted">
          {s.agentMayChangeStudio
            ? 'Agents CAN change Studio spend caps, add or remove Bible skills (a removed skill is saved to a backup file first), retry flagged tasks, rebuild episodes and pause or resume a brand. Retries and rebuilds spend money. Every change is written to the Activity Log.'
            : 'Off (recommended). Agents can still read Studio spend and see flagged tasks, but an attempt to change anything gets a clear "studio_locked" error and nothing changes.'}
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

/** One token per bot, so the app knows who is calling. A bot's token can read, drop videos and use Upcoming. Nothing else. */
export function BotsCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: bots, reload } = useLoad(() => api.agent.bots())
  const [name, setName] = useState('')
  const [role, setRole] = useState<'writer' | 'orchestrator'>('writer')
  const [channels, setChannels] = useState<string[]>([])
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null)
  const { data: brandList } = useLoad(() => api.brands.list())
  const slugs = (brandList ?? []).filter((b) => b.slug).map((b) => b.slug as string)
  const [editing, setEditing] = useState<{ id: number; name: string; channels: string[] } | null>(
    null,
  )
  return (
    <Card title="Bots">
      <p className="mb-3 text-[13px] text-muted">
        Give each bot its own token. The token is shown once. A bot can read, drop finished videos
        into its own channels and use its own Upcoming entries. It cannot change settings, post or
        delete. Your own token above keeps full access.
      </p>
      {shown && (
        <div className="mb-3 rounded-md border border-warn p-3 text-[13px]">
          <b>Token for {shown.name}.</b> Copy it now. It is not shown again.
          <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 text-[11px]">{shown.token}</pre>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(shown.token)
              toast({ kind: 'success', headline: 'Copied.' })
            }}
          >
            Copy token
          </Button>{' '}
          <Button variant="ghost" onClick={() => setShown(null)}>
            Done
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {bots
          ?.filter((b) => !b.revokedAt)
          .map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3 text-[13px]"
            >
              <b className="w-32">{b.name}</b>
              <span className="text-muted">{b.role}</span>
              <span className="min-w-0 flex-1 text-muted">
                {b.channels.includes('*')
                  ? 'All channels, including new ones'
                  : b.channels.join(', ') || 'no channels'}
              </span>
              <Button
                disabled={busy}
                onClick={() => setEditing({ id: b.id, name: b.name, channels: b.channels })}
              >
                Edit channels
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  const r = await run(() => api.agent.newBotToken(b.id))
                  if (r) setShown({ name: b.name, token: r.token })
                }}
              >
                Make a new token
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  await run(() => api.agent.revokeBot(b.id))
                  reload()
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        {bots && !bots.some((b) => !b.revokedAt) && (
          <div className="text-[13px] text-muted">No bots yet.</div>
        )}
      </div>
      <div className="mt-4 space-y-3 rounded-md border border-line p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Bot name" hint="Lowercase, like grok-bot, kids-comedy or beth.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Role"
            hint="A writer works on its channels. An orchestrator (B.E.T.H.) can move any entry forward."
          >
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as 'writer' | 'orchestrator')}
            >
              <option value="writer">writer</option>
              <option value="orchestrator">orchestrator</option>
            </Select>
          </Field>
        </div>
        <ChannelPicker slugs={slugs} value={channels} onChange={setChannels} />
        <Button
          variant="primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            const r = await run(() => api.agent.createBot(name, channels, role))
            if (r) {
              setShown({ name: r.bot.name, token: r.token })
              setName('')
              setChannels([])
              reload()
            }
          }}
        >
          Add bot
        </Button>
      </div>
      {editing && (
        <Dialog title={`Channels for ${editing.name}`} onClose={() => setEditing(null)}>
          <ChannelPicker
            slugs={slugs}
            value={editing.channels}
            onChange={(channels) => setEditing({ ...editing, channels })}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const e = editing
                setEditing(null)
                await run(() => api.agent.updateBot(e.id, { channels: e.channels }))
                reload()
              }}
            >
              Save
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}

/** Pick the channels a bot works on. "All channels" also covers any channel you add later. */
function ChannelPicker({
  slugs,
  value,
  onChange,
}: {
  slugs: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const all = value.includes('*')
  return (
    <div className="space-y-2">
      <Check checked={all} onChange={(v) => onChange(v ? ['*'] : [])}>
        <b>All channels</b> (including any channel you add later)
      </Check>
      <div className={`grid gap-1 md:grid-cols-2 ${all ? 'opacity-40' : ''}`}>
        {slugs.map((c) => (
          <Check
            key={c}
            checked={all || value.includes(c)}
            disabled={all}
            onChange={(v) => onChange(v ? [...value, c] : value.filter((x) => x !== c))}
          >
            {c}
          </Check>
        ))}
      </div>
    </div>
  )
}
