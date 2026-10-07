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
        <MetaCard />
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
            TikTok is still a dry run. It waits a few seconds and reports success, and never
            contacts the platform. The real connection arrives in a later phase.
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
        {PLATFORMS.filter((p) => p !== 'youtube').map((p) => {
          const a = accounts.find((x) => x.brandId === brand.id && x.platform === p)
          const real = !!a && a.mode !== 'dry_run'
          return (
            <div key={p} className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                {real && a?.avatarUrl && (
                  <img src={a.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                )}
                <div className="font-semibold">{PLATFORM_LABELS[p]}</div>
                {real && a?.status === 'needs_reauth' && (
                  <span className="rounded bg-bad/20 px-1.5 text-[10px] font-bold uppercase text-bad">
                    needs sign in
                  </span>
                )}
                {real && a?.status === 'connected' && (
                  <span className="rounded bg-ok/20 px-1.5 text-[10px] font-bold uppercase text-ok">
                    connected
                  </span>
                )}
              </div>
              <div className="text-[12px] text-muted">
                {real
                  ? a?.displayName
                  : p === 'tiktok'
                    ? 'Dry run account'
                    : 'Not connected (dry run only)'}
              </div>
            </div>
          )
        })}
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

function MetaCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.meta.credentialsStatus())
  const { data: meta } = useLoad(() => api.meta.status())
  const { data: brands } = useLoad(() => api.brands.list())
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [editing, setEditing] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [choice, setChoice] = useState<Record<number, { pageId: string; igId: string }>>({})
  const saved = !!st?.hasAppId && !!st?.hasAppSecret
  const showForm = !saved || editing

  async function connect() {
    setWaiting(true)
    const r = await run(() => api.meta.connect())
    setWaiting(false)
    if (r) {
      setChoice({})
      toast({
        kind: 'success',
        headline: COPY.success,
        detail: `Meta connected. ${r.pages.length} Page(s) found. Match them to your brands below.`,
      })
    }
  }

  const pageName = (id: string) => meta?.pages.find((p) => p.pageId === id)?.name ?? ''
  const pick = (brandId: number) => {
    const sug = meta?.suggestions.find((s) => s.brandId === brandId)
    const current = choice[brandId]
    if (current) return current
    const page = meta?.pages.find((p) => p.facebookBrandId === brandId)
    const ig = meta?.pages.find((p) => p.instagramBrandId === brandId)
    return { pageId: page?.pageId ?? sug?.pageId ?? '', igId: ig?.igId ?? sug?.igId ?? '' }
  }
  const dirty = (brandId: number) => {
    const c = pick(brandId)
    const page = meta?.pages.find((p) => p.facebookBrandId === brandId)
    const ig = meta?.pages.find((p) => p.instagramBrandId === brandId)
    return (page?.pageId ?? '') !== c.pageId || (ig?.igId ?? '') !== c.igId
  }

  return (
    <Card title="Meta (Facebook Pages and Instagram)">
      {showForm ? (
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="App ID">
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder={st?.hasAppId ? st.appIdMasked : '15 digit number'}
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
            </Field>
            <Field label="App Secret">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={st?.hasAppSecret ? st.appSecretMasked : 'App secret'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          </div>
          <div className="text-[12px] text-muted">
            Get these from SETUP_B_META_FACEBOOK_INSTAGRAM.md step 5. They are saved encrypted in
            the macOS Keychain and never shown again in full.
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy || (!appId.trim() && !secret.trim())}
              onClick={async () => {
                if (await run(() => api.meta.saveCredentials(appId, secret))) {
                  setAppId('')
                  setSecret('')
                  setEditing(false)
                  reload()
                  toast({
                    kind: 'success',
                    headline: COPY.success,
                    detail: 'Meta credentials saved.',
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px]">
              <div>
                App ID: <span className="font-mono">{st?.appIdMasked}</span>
              </div>
              <div>
                App Secret: <span className="font-mono">{st?.appSecretMasked}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)}>Replace</Button>
              {waiting ? (
                <>
                  <Button disabled>Waiting for your browser...</Button>
                  <Button onClick={() => api.meta.cancelConnect()}>Cancel</Button>
                </>
              ) : (
                <Button
                  variant={meta?.connected ? 'secondary' : 'primary'}
                  onClick={connect}
                  disabled={busy}
                >
                  {meta?.connected ? 'Reconnect Meta' : 'Connect Meta'}
                </Button>
              )}
              {meta?.connected && !waiting && (
                <Button variant="danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
                  Disconnect
                </Button>
              )}
            </div>
          </div>

          {meta?.connected && (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span>
                  Signed in as <b>{meta.userName}</b>.
                </span>
                {meta.expiresAt ? (
                  <span className={meta.expiringSoon ? 'font-bold text-warn' : 'text-muted'}>
                    {meta.daysLeft !== null && meta.daysLeft < 0
                      ? 'Login expired'
                      : `Login works until ${formatEastern(meta.expiresAt, false)} (${meta.daysLeft} days left)`}
                  </span>
                ) : (
                  <span className="text-muted">Meta gave no expiry date.</span>
                )}
                {meta.status === 'needs_reauth' && (
                  <span className="rounded bg-bad/20 px-2 py-0.5 text-[11px] font-bold uppercase text-bad">
                    needs sign in
                  </span>
                )}
              </div>
              {meta.expiringSoon && (
                <div className="rounded-md border border-warn p-3 text-[13px]">
                  {meta.status === 'needs_reauth'
                    ? 'Meta stopped accepting the saved login.'
                    : 'The Meta login runs out soon.'}{' '}
                  Click <b>Reconnect Meta</b> above and approve every Page and Instagram account
                  again.
                </div>
              )}
              {meta.missingPermissions.length > 0 && (
                <div className="rounded-md border border-bad p-3 text-[13px]">
                  Meta did not grant: {meta.missingPermissions.join(', ')}. Click{' '}
                  <b>Reconnect Meta</b> and tick every box.
                </div>
              )}

              <div className="display text-xl">Match brands to Pages</div>
              <div className="space-y-2">
                {brands?.map((b) => {
                  const c = pick(b.id)
                  const usedPage = (id: string) =>
                    meta.pages.find((p) => p.pageId === id)?.facebookBrandId
                  const usedIg = (id: string) =>
                    meta.pages.find((p) => p.igId === id)?.instagramBrandId
                  return (
                    <div
                      key={b.id}
                      className="grid items-end gap-3 rounded-md border border-line p-3 md:grid-cols-[170px_1fr_1fr_auto]"
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <span
                          className="h-3 w-3 rounded-full border border-black/30"
                          style={{ background: b.color }}
                        />
                        {b.name}
                      </div>
                      <Field label="Facebook Page">
                        <Select
                          value={c.pageId}
                          onChange={(e) =>
                            setChoice({ ...choice, [b.id]: { ...c, pageId: e.target.value } })
                          }
                        >
                          <option value="">None (dry run)</option>
                          {meta.pages.map((p) => (
                            <option
                              key={p.pageId}
                              value={p.pageId}
                              disabled={!!usedPage(p.pageId) && usedPage(p.pageId) !== b.id}
                            >
                              {p.name}
                              {usedPage(p.pageId) && usedPage(p.pageId) !== b.id ? ' (used)' : ''}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Instagram account">
                        <Select
                          value={c.igId}
                          onChange={(e) =>
                            setChoice({ ...choice, [b.id]: { ...c, igId: e.target.value } })
                          }
                        >
                          <option value="">None (dry run)</option>
                          {meta.pages
                            .filter((p) => p.igId)
                            .map((p) => (
                              <option
                                key={p.igId}
                                value={p.igId as string}
                                disabled={
                                  !!usedIg(p.igId as string) && usedIg(p.igId as string) !== b.id
                                }
                              >
                                @{p.igUsername} ({p.name})
                                {usedIg(p.igId as string) && usedIg(p.igId as string) !== b.id
                                  ? ' (used)'
                                  : ''}
                              </option>
                            ))}
                        </Select>
                      </Field>
                      <Button
                        variant="primary"
                        disabled={busy || !dirty(b.id)}
                        onClick={async () => {
                          if (
                            await run(() => api.meta.assign(b.id, c.pageId || null, c.igId || null))
                          ) {
                            setChoice((x) => {
                              const n = { ...x }
                              delete n[b.id]
                              return n
                            })
                            toast({
                              kind: 'success',
                              headline: COPY.success,
                              detail: `${b.name}: ${c.pageId ? pageName(c.pageId) : 'no Page'} saved.`,
                            })
                          }
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  )
                })}
              </div>
              <div className="text-[12px] text-muted">
                New Page or Instagram not in the list? Create it, link them together, then click
                Reconnect Meta and tick the new ones.
              </div>
            </div>
          )}
        </div>
      )}
      {confirmDisconnect && (
        <Confirm
          title="Disconnect Meta?"
          message="This removes the saved Meta login and every Page token, and withdraws Expect Less Output's access at Meta. Facebook and Instagram will go back to dry runs until you connect again."
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            await run(() => api.meta.disconnect())
            setConfirmDisconnect(false)
          }}
        />
      )}
    </Card>
  )
}
