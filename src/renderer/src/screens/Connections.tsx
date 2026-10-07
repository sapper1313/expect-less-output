import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { Account, Brand, ConnectResult, YoutubeChannel, YoutubeMode } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Confirm, Dialog, Field, Input, PageHeader, Select, useBusy } from '../ui'

export const YT_MODE_LABELS: Record<YoutubeMode, string> = {
  manual_assist: 'Manual assist',
  test_private: 'Test private',
  auto: 'Auto',
}

const MODE_NOTES: Record<YoutubeMode, string> = {
  manual_assist:
    'At the scheduled time the app tells you, copies the title and description, and opens YouTube Studio. You upload by hand, then press Mark as posted.',
  test_private: 'Uploads stay private. Use for testing only.',
  auto: 'Uploads early and YouTube publishes at the exact time. Switch to Auto only after Google approves your audit (SETUP_A step 9).',
}

export function Connections() {
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: accounts } = useLoad(() => api.accounts.list())
  const [picker, setPicker] = useState<{
    sessionId: string
    channels: YoutubeChannel[]
    brandName: string
  } | null>(null)

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.connections} />
      <div className="space-y-4 px-8">
        <GoogleCard />
        {brands?.map((b) => (
          <BrandCard
            key={b.id}
            brand={b}
            accounts={accounts ?? []}
            onPick={(sessionId, channels) => setPicker({ sessionId, channels, brandName: b.name })}
          />
        ))}
        <Card>
          <p className="text-muted">
            Facebook, Instagram and TikTok are still dry runs. They wait a few seconds and report
            success, and never contact any platform. Real connections arrive in later phases.
          </p>
        </Card>
      </div>
      {picker && <ChannelPicker picker={picker} onClose={() => setPicker(null)} />}
    </div>
  )
}

function GoogleCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.youtube.credentialsStatus())
  const { data: quota } = useLoad(() => api.youtube.quota())
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [editing, setEditing] = useState(false)
  const saved = !!st?.hasClientId && !!st?.hasClientSecret
  const showForm = !saved || editing

  const bar = (used: number, limit: number) => {
    const pct = Math.min(100, Math.round((used / limit) * 100))
    return (
      <div className="h-2 w-full overflow-hidden rounded bg-surface2">
        <div
          className={`h-full ${pct >= 80 ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }

  return (
    <Card title="Google / YouTube credentials">
      {showForm ? (
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Client ID">
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  st?.hasClientId ? st.clientIdMasked : 'xxxx.apps.googleusercontent.com'
                }
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </Field>
            <Field label="Client Secret">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={st?.hasClientSecret ? st.clientSecretMasked : 'GOCSPX-...'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          </div>
          <div className="text-[12px] text-muted">
            Get these from SETUP_A_GOOGLE_YOUTUBE.md step 5. They are saved encrypted in the macOS
            Keychain and never shown again in full.
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy || (!id.trim() && !secret.trim())}
              onClick={async () => {
                if (await run(() => api.youtube.saveCredentials(id, secret))) {
                  setId('')
                  setSecret('')
                  setEditing(false)
                  reload()
                  toast({
                    kind: 'success',
                    headline: COPY.success,
                    detail: 'Google credentials saved.',
                  })
                }
              }}
            >
              Save
            </Button>
            {saved && <Button onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px]">
            <div>
              Client ID: <span className="font-mono">{st?.clientIdMasked}</span>
            </div>
            <div>
              Client Secret: <span className="font-mono">{st?.clientSecretMasked}</span>
            </div>
          </div>
          <Button onClick={() => setEditing(true)}>Replace</Button>
        </div>
      )}
      {quota && (
        <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[12px] text-muted">
              Uploads today: {quota.uploads.used} of {quota.uploads.limit}
            </div>
            {bar(quota.uploads.used, quota.uploads.limit)}
          </div>
          <div>
            <div className="mb-1 text-[12px] text-muted">
              Other YouTube calls today: {quota.other.used} of {quota.other.limit}
            </div>
            {bar(quota.other.used, quota.other.limit)}
          </div>
          <div className="text-[11px] text-muted md:col-span-2">
            Estimated use for Pacific day {quota.dayPt}. It resets at midnight Pacific.
            {quota.warn && <b className="ml-2 text-warn">Over 80 percent of a limit.</b>}
          </div>
        </div>
      )}
    </Card>
  )
}

function BrandCard({
  brand,
  accounts,
  onPick,
}: {
  brand: Brand
  accounts: Account[]
  onPick: (sessionId: string, channels: YoutubeChannel[]) => void
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [waiting, setWaiting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const yt = accounts.find((a) => a.brandId === brand.id && a.platform === 'youtube')
  const real = !!yt && yt.mode !== 'dry_run'

  async function connect() {
    setWaiting(true)
    const r: ConnectResult | undefined = await run(() => api.youtube.connect(brand.id))
    setWaiting(false)
    if (!r) return
    if (r.status === 'pick') onPick(r.sessionId, r.channels)
    else
      toast({
        kind: 'success',
        headline: COPY.success,
        detail: `${r.account.displayName} is connected to ${brand.name}.`,
      })
  }

  return (
    <Card title={brand.name}>
      <div className="mb-3 inline-flex items-center gap-2 text-[12px] text-muted">
        <span
          className="h-3 w-3 rounded-full border border-black/30"
          style={{ background: brand.color }}
        />
        Each brand has its own YouTube channel.
      </div>
      <div className="rounded-lg border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {real && yt?.avatarUrl ? (
              <img src={yt.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-surface2" />
            )}
            <div>
              <div className="font-semibold">YouTube</div>
              {real ? (
                <div className="text-[13px]">
                  {yt!.displayName}{' '}
                  {yt!.status === 'needs_reauth' ? (
                    <span className="ml-1 rounded bg-bad/20 px-2 py-0.5 text-[11px] font-bold uppercase text-bad">
                      needs sign in
                    </span>
                  ) : (
                    <span className="ml-1 rounded bg-ok/20 px-2 py-0.5 text-[11px] font-bold uppercase text-ok">
                      connected
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-[13px] text-muted">Not connected (dry run only)</div>
              )}
              {real && yt?.lastCheckedAt && (
                <div className="text-[11px] text-muted">
                  Last checked {formatEastern(yt.lastCheckedAt)}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {waiting ? (
              <>
                <Button disabled>Waiting for your browser...</Button>
                <Button onClick={() => api.youtube.cancelConnect()}>Cancel</Button>
              </>
            ) : real ? (
              <>
                <Button onClick={connect} disabled={busy}>
                  Reconnect
                </Button>
                <Button variant="danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={connect} disabled={busy}>
                Connect YouTube
              </Button>
            )}
          </div>
        </div>
        {real && (
          <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
            <Field label="Mode">
              <Select
                value={yt!.mode}
                onChange={(e) =>
                  run(() => api.youtube.setMode(brand.id, e.target.value as YoutubeMode))
                }
              >
                {(Object.keys(YT_MODE_LABELS) as YoutubeMode[]).map((m) => (
                  <option key={m} value={m}>
                    {YT_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="self-end pb-2 text-[12px] text-muted">
              {MODE_NOTES[yt!.mode as YoutubeMode]}
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {PLATFORMS.filter((p) => p !== 'youtube').map((p) => (
          <div key={p} className="rounded-md border border-line p-3">
            <div className="font-semibold">{PLATFORM_LABELS[p]}</div>
            <div className="text-[12px] text-muted">Dry run account</div>
          </div>
        ))}
      </div>
      {confirmDisconnect && (
        <Confirm
          title="Disconnect YouTube?"
          message={`This removes the saved sign-in for ${yt?.displayName} on ${brand.name} and revokes Expect Less Output's access at Google. Scheduled YouTube posts for this brand will turn into dry runs until you connect again.`}
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            await run(() => api.youtube.disconnect(brand.id))
            setConfirmDisconnect(false)
          }}
        />
      )}
    </Card>
  )
}

function ChannelPicker({
  picker,
  onClose,
}: {
  picker: { sessionId: string; channels: YoutubeChannel[]; brandName: string }
  onClose: () => void
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [sel, setSel] = useState(picker.channels[0]?.id ?? '')
  return (
    <Dialog title="Pick the channel" onClose={onClose}>
      <p className="mb-3 text-[13px]">
        This Google account has more than one channel. Which one belongs to {picker.brandName}?
      </p>
      <div className="space-y-2">
        {picker.channels.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${sel === c.id ? 'border-accent bg-surface' : 'border-line'}`}
          >
            <input
              type="radio"
              name="channel"
              checked={sel === c.id}
              onChange={() => setSel(c.id)}
              className="accent-[var(--accent)]"
            />
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-surface2" />
            )}
            <span className="font-semibold">{c.title}</span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !sel}
          onClick={async () => {
            const r = await run(() => api.youtube.finishConnect(picker.sessionId, sel))
            if (r && r.status === 'connected') {
              toast({
                kind: 'success',
                headline: COPY.success,
                detail: `${r.account.displayName} is connected to ${picker.brandName}.`,
              })
              onClose()
            }
          }}
        >
          Use this channel
        </Button>
      </div>
    </Dialog>
  )
}
