import { useState } from 'react'
import { EXTRA_PLATFORMS, PLATFORM_LABELS, type ExtraPlatform } from '@shared/platformLimits'
import type { ExtraAccountView, ExtraCredentialsStatus } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Confirm, Field, Input, Select, useBusy } from '../ui'

type KeyPlatform = 'x' | 'linkedin' | 'pinterest'
const KEY_PLATFORMS: KeyPlatform[] = ['x', 'linkedin', 'pinterest']

const KEY_HELP: Record<KeyPlatform, { where: string; note: string }> = {
  x: {
    where: 'developer.x.com',
    note: 'X charges per post through its API. Add a few dollars of credit in the developer portal first.',
  },
  linkedin: {
    where: 'linkedin.com/developers',
    note: 'Posts go to your personal profile. The login lasts 60 days, then you press Connect again.',
  },
  pinterest: {
    where: 'developers.pinterest.com',
    note: 'Pinterest keeps new apps in Trial access, where pins are only visible to you, until it approves Standard access.',
  },
}

/** The app keys (client id and secret) for one platform. */
function KeysCard({ platform }: { platform: KeyPlatform }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.platforms.credentials(platform), [platform])
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const help = KEY_HELP[platform]
  const label = PLATFORM_LABELS[platform]
  const st: ExtraCredentialsStatus | null = data
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-1 font-semibold">{label} app keys</div>
      <div className="mb-2 text-[12px] text-muted">
        Get them at {help.where}. Steps are in docs/SETUP_MORE_PLATFORMS.md. {help.note}
      </div>
      {st && (
        <div className="mb-2 text-[12px]">
          Redirect address to type into {label}'s developer page: <b>{st.redirectUri}</b>
          <br />
          {st.hasClientId && st.hasClientSecret
            ? `Saved: ${st.clientIdMasked} and ${st.clientSecretMasked}.`
            : 'Not saved yet.'}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Client ID">
          <Input className="w-56" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label="Client Secret">
          <Input
            className="w-56"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <Button
          disabled={busy || (!id.trim() && !secret.trim())}
          onClick={async () => {
            const r = await run(() => api.platforms.saveCredentials(platform, id, secret))
            if (r) {
              setId('')
              setSecret('')
              reload()
              toast({
                kind: 'success',
                headline: `${label} keys saved.`,
                detail: 'Encrypted on this Mac.',
              })
            }
          }}
        >
          Save keys
        </Button>
      </div>
    </div>
  )
}

function StateBadge({ v }: { v: ExtraAccountView | undefined }) {
  if (!v || v.state === 'not_set') return <span className="text-[11px] text-muted">not set up</span>
  return v.state === 'connected' ? (
    <span className="rounded bg-ok/20 px-1.5 text-[10px] font-bold uppercase text-ok">
      connected
    </span>
  ) : (
    <span className="rounded bg-bad/20 px-1.5 text-[10px] font-bold uppercase text-bad">
      needs sign in
    </span>
  )
}

/** One platform on one channel. */
function Tile({
  view,
  reload,
  bluesky,
}: {
  view: ExtraAccountView
  reload: () => void
  bluesky?: { handle: string; hasPassword: boolean }
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [confirm, setConfirm] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [handle, setHandle] = useState(bluesky?.handle ?? '')
  const [pw, setPw] = useState('')
  const [boards, setBoards] = useState<Array<{ id: string; name: string }> | null>(null)
  const p = view.platform
  const label = PLATFORM_LABELS[p]
  const connected = view.state !== 'not_set'

  const connect = async () => {
    setWaiting(true)
    try {
      const r = await run(() => api.platforms.connect(view.brandId, p as KeyPlatform))
      if (r)
        toast({ kind: 'success', headline: `${label} connected.`, detail: r.displayName ?? '' })
    } finally {
      setWaiting(false)
      reload()
    }
  }

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <div className="font-semibold">{label}</div>
        <StateBadge v={view} />
      </div>
      <div className="mb-2 text-[12px] text-muted">
        {connected ? (view.displayName ?? '') : 'Not used on this channel.'}
      </div>

      {KEY_PLATFORMS.includes(p as KeyPlatform) && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy && !waiting} onClick={() => void connect()}>
            {waiting
              ? 'Waiting for you in the browser...'
              : connected
                ? 'Connect again'
                : 'Connect'}
          </Button>
          {waiting && <Button onClick={() => void api.platforms.cancel()}>Cancel</Button>}
          {connected && !waiting && (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Disconnect
            </Button>
          )}
        </div>
      )}

      {p === 'pinterest' && connected && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Board">
            <Select
              value={view.externalId ?? ''}
              onFocus={async () => {
                if (!boards) setBoards((await run(() => api.platforms.boards(view.brandId))) ?? [])
              }}
              onChange={async (e) => {
                const b = (boards ?? []).find((x) => x.id === e.target.value)
                if (b) {
                  await run(() => api.platforms.setBoard(view.brandId, b.id, b.name))
                  reload()
                }
              }}
            >
              <option value="">{view.externalId ? 'Board chosen' : 'Pick a board'}</option>
              {(boards ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          {!view.externalId && (
            <span className="text-[12px] text-bad">Pick a board or nothing will post.</span>
          )}
        </div>
      )}

      {p === 'bluesky' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Handle">
            <Input
              className="w-52"
              placeholder="name.bsky.social"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </Field>
          <Field label="App password">
            <Input
              className="w-44"
              type="password"
              placeholder={bluesky?.hasPassword ? 'saved' : ''}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy || !handle.trim()}
            onClick={async () => {
              await run(async () => {
                await api.studio.saveBluesky(view.brandId, handle, pw)
                const t = await api.studio.testBluesky(view.brandId)
                toast({
                  kind: t.ok ? 'success' : 'error',
                  headline: t.ok ? 'Bluesky connected.' : 'Bluesky said no.',
                  detail: t.message,
                })
              })
              setPw('')
              reload()
            }}
          >
            Save and test
          </Button>
        </div>
      )}

      {confirm && (
        <Confirm
          title={`Disconnect ${label}?`}
          message={`${view.brandName} will stop posting to ${label}. Posts already scheduled for it will fail until you connect again.`}
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false)
            await run(() => api.platforms.disconnect(view.brandId, p))
            reload()
          }}
        />
      )}
    </div>
  )
}

/** The app keys for X, LinkedIn and Pinterest (one set for all channels). They sit in Platform credentials. */
export function MorePlatformKeys() {
  return (
    <Card title="More platforms: app keys">
      <p className="mb-3 text-[13px] text-muted">
        Bluesky, X, LinkedIn and Pinterest are optional. A channel only posts to one when you give
        it a login above. Leave one blank and that platform is simply not part of the channel. X,
        LinkedIn and Pinterest each need app keys first (one set for all channels).
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {KEY_PLATFORMS.map((k) => (
          <KeysCard key={k} platform={k} />
        ))}
      </div>
    </Card>
  )
}

/** Bluesky, X, LinkedIn and Pinterest logins for one channel. A blank one means that platform is not part of the channel. */
export function MorePlatformsForBrand({ brandId }: { brandId: number }) {
  const { data, reload } = useLoad(() => api.platforms.views(), [])
  const { data: social } = useLoad(() => api.studio.socialAccountList(), [])
  const brandName = (data ?? []).find((v) => v.brandId === brandId)?.brandName
  if (!brandName) return null
  return (
    <Card title={`${brandName}: Bluesky and more platforms`}>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {EXTRA_PLATFORMS.map((p: ExtraPlatform) => {
          const v = (data ?? []).find((x) => x.brandId === brandId && x.platform === p)
          if (!v) return null
          const s = social?.find((x) => x.brandId === brandId)?.bluesky
          return (
            <Tile
              key={p}
              view={v}
              reload={reload}
              bluesky={s ? { handle: s.handle, hasPassword: s.hasPassword } : undefined}
            />
          )
        })}
      </div>
    </Card>
  )
}
