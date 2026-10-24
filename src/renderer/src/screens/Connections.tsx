import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { MorePlatforms } from './MorePlatforms'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type {
  Account,
  Brand,
  ConnectResult,
  TikTokMode,
  YoutubeChannel,
  YoutubeMode,
} from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import {
  Button,
  Card,
  Check,
  Confirm,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  useBusy,
} from '../ui'

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
        <HealthCard />
        <GoogleCard />
        <MetaCard />
        <TikTokCard />
        <MorePlatforms />
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
        {PLATFORMS.filter((p) => p !== 'youtube' && p !== 'tiktok').map((p) => {
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
                  : 'Not connected yet. Use the Meta box at the top, then match it to this brand.'}
              </div>
            </div>
          )
        })}
      </div>
      <TikTokTile
        brand={brand}
        account={accounts.find((x) => x.brandId === brand.id && x.platform === 'tiktok')}
      />
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

function TikTokCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.tiktok.credentialsStatus())
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [redirect, setRedirect] = useState('')
  const [publish, setPublish] = useState<boolean | null>(null)
  const [statsScope, setStatsScope] = useState<boolean | null>(null)
  const [editing, setEditing] = useState(false)
  const saved = !!st?.hasClientKey && !!st?.hasClientSecret
  const showForm = !saved || editing
  const publishOn = publish ?? st?.requestPublishScope ?? false
  const statsOn = statsScope ?? st?.requestStatsScope ?? false

  return (
    <Card title="TikTok credentials">
      {showForm ? (
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Client Key">
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder={st?.hasClientKey ? st.clientKeyMasked : 'Client key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Field label="Client Secret">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={st?.hasClientSecret ? st.clientSecretMasked : 'Client secret'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Redirect URI"
            hint="Must match the Login Kit Redirect URI in the TikTok developer portal exactly, including the slash at the end."
          >
            <Input
              spellCheck={false}
              placeholder={st?.redirectUri}
              value={redirect || st?.redirectUri || ''}
              onChange={(e) => setRedirect(e.target.value)}
            />
          </Field>
          <Check checked={publishOn} onChange={setPublish}>
            Also ask for video.publish (Direct Post). Leave off until TikTok approves the audit.
          </Check>
          <Check checked={statsOn} onChange={setStatsScope}>
            Also ask for video.list (stats). Add it in the TikTok developer portal first, then
            Reconnect TikTok.
          </Check>
          <div className="text-[12px] text-muted">
            Get these from SETUP_C_TIKTOK.md step 7. They are saved encrypted in the macOS Keychain
            and never shown again in full.
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={
                busy ||
                (!key.trim() &&
                  !secret.trim() &&
                  redirect === '' &&
                  publish === null &&
                  statsScope === null)
              }
              onClick={async () => {
                if (
                  await run(() =>
                    api.tiktok.saveCredentials(
                      key,
                      secret,
                      redirect || st?.redirectUri || '',
                      publishOn,
                      statsOn,
                    ),
                  )
                ) {
                  setKey('')
                  setSecret('')
                  setRedirect('')
                  setPublish(null)
                  setStatsScope(null)
                  setEditing(false)
                  reload()
                  toast({
                    kind: 'success',
                    headline: COPY.success,
                    detail: 'TikTok credentials saved.',
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
              Client Key: <span className="font-mono">{st?.clientKeyMasked}</span>
            </div>
            <div>
              Client Secret: <span className="font-mono">{st?.clientSecretMasked}</span>
            </div>
            <div className="text-muted">Redirect URI: {st?.redirectUri}</div>
            <div className="text-muted">
              Direct Post permission:{' '}
              {st?.requestPublishScope ? 'requested on connect' : 'not requested'}
            </div>
            <div className="text-muted">
              Stats permission: {st?.requestStatsScope ? 'requested on connect' : 'not requested'}
            </div>
          </div>
          <Button onClick={() => setEditing(true)}>Replace</Button>
        </div>
      )}
      <div className="mt-3 text-[11px] text-muted">
        Recording the review video for TikTok? Press Command+Shift+D to open the TikTok demo. It
        never posts anything.
      </div>
    </Card>
  )
}

function TikTokTile({ brand, account }: { brand: Brand; account: Account | undefined }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [waiting, setWaiting] = useState(false)
  const [code, setCode] = useState('')
  const [confirmDirect, setConfirmDirect] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const real = !!account && account.mode !== 'dry_run'

  async function connect() {
    setWaiting(true)
    const a = await run(() => api.tiktok.connect(brand.id))
    setWaiting(false)
    setCode('')
    if (a)
      toast({
        kind: 'success',
        headline: COPY.success,
        detail: `${a.displayName} is connected to ${brand.name}.`,
      })
  }

  return (
    <div className="mt-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {real && account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-surface2" />
          )}
          <div>
            <div className="font-semibold">TikTok</div>
            {real ? (
              <div className="text-[13px]">
                {account!.displayName}{' '}
                {account!.status === 'needs_reauth' ? (
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
          </div>
        </div>
        <div className="flex gap-2">
          {waiting ? (
            <>
              <Button disabled>Waiting for your browser...</Button>
              <Button onClick={() => api.tiktok.cancelConnect()}>Cancel</Button>
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
              Connect TikTok
            </Button>
          )}
        </div>
      </div>

      {waiting && (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <Field
            label="Did the app not come back to the front? Paste the code from the website page here"
            hint="The page at the website shows a code with a Copy button."
          >
            <Input
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Button
            className="self-start md:mt-5"
            disabled={!code.trim()}
            onClick={() => run(() => api.tiktok.submitCode(code))}
          >
            Use this code
          </Button>
        </div>
      )}

      {real && (
        <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="Mode">
            <Select
              value={account!.mode}
              onChange={(e) => {
                const m = e.target.value as TikTokMode
                if (m === 'direct') setConfirmDirect(true)
                else void run(() => api.tiktok.setMode(brand.id, m))
              }}
            >
              <option value="drafts">Drafts</option>
              <option value="direct">Direct post</option>
            </Select>
          </Field>
          <div className="self-end pb-2 text-[12px] text-muted">
            {account!.mode === 'drafts'
              ? "At the scheduled time the video goes to the brand's TikTok inbox. Open TikTok, tap the inbox notification, add the AI label if needed, and post."
              : 'Posts on its own with the choices you make on each post. Public posts only work after TikTok approves the audit.'}
          </div>
        </div>
      )}
      {confirmDirect && (
        <Confirm
          title="Switch to Direct post?"
          message="Has TikTok approved your Direct Post audit? Until it has, TikTok only lets this app post privately, and public posts fail. Only continue if you got the approval."
          confirmLabel="Yes, it is approved"
          onCancel={() => setConfirmDirect(false)}
          onConfirm={async () => {
            await run(() => api.tiktok.setMode(brand.id, 'direct', true))
            setConfirmDirect(false)
          }}
        />
      )}
      {confirmDisconnect && (
        <Confirm
          title="Disconnect TikTok?"
          message={`This removes the saved TikTok login for ${account?.displayName} on ${brand.name} and withdraws the app's access at TikTok. Scheduled TikTok posts for this brand will turn into dry runs until you connect again.`}
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            await run(() => api.tiktok.disconnect(brand.id))
            setConfirmDisconnect(false)
          }}
        />
      )}
    </div>
  )
}

function HealthCard() {
  const { data: rows } = useLoad(() => api.health.list())
  const { data: quota } = useLoad(() => api.youtube.quota())
  return (
    <Card title="Health">
      {!rows || rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          No real accounts are connected yet. Everything below says "not connected" until you
          connect it.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface2 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="p-2">Brand</th>
                <th className="p-2">Platform</th>
                <th className="p-2">Account</th>
                <th className="p-2">Status</th>
                <th className="p-2">Mode</th>
                <th className="p-2">Last check</th>
                <th className="p-2">Login runs out</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId} className="border-t border-line">
                  <td className="p-2">{r.brandName}</td>
                  <td className="p-2">{PLATFORM_LABELS[r.platform]}</td>
                  <td className="p-2">{r.displayName ?? ''}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.status === 'connected' ? 'bg-ok/20 text-ok' : 'bg-bad/20 text-bad'}`}
                    >
                      {r.status === 'connected'
                        ? 'ok'
                        : r.status === 'needs_reauth'
                          ? 'needs sign in'
                          : 'problem'}
                    </span>
                  </td>
                  <td className="p-2 text-muted">{r.note}</td>
                  <td className="p-2 text-muted">
                    {r.lastCheckedAt ? formatEastern(r.lastCheckedAt, false) : 'not yet'}
                  </td>
                  <td className="p-2 text-muted">
                    {r.expiresAt ? formatEastern(r.expiresAt, false) : 'no date'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {quota && rows?.some((r) => r.platform === 'youtube') && (
        <div className="mt-3 text-[12px] text-muted">
          YouTube today: {quota.uploads.used} of {quota.uploads.limit} uploads, {quota.other.used}{' '}
          of {quota.other.limit} other calls.
          {quota.warn && <b className="ml-2 text-warn">Over 80 percent of a limit.</b>}
        </div>
      )}
    </Card>
  )
}
