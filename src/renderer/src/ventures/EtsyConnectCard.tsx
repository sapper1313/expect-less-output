import { useState } from 'react'
import { COPY } from '@shared/copy'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, Input } from '../ui'
import { Card, Note, when } from './kit'

/** Mac only. Keys, Connect Etsy, Sync now and Disconnect. The phone page never gets this. */
export function EtsyConnectCard() {
  const { data: status, reload } = useLoad(() => api.ventures.status('etsy'))
  const { data: keysSet, reload: reloadKeys } = useLoad(() => api.ventures.etsyKeysSet())
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg(ok)
    } catch (e) {
      setMsg(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
      reload()
      reloadKeys()
    }
  }
  if (!status) return null
  const connected = status.mode === 'connected'
  return (
    <Card title="Etsy connection">
      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <span>
            {COPY.ventures.connected} <b>{status.shopName}</b>
            {status.lastSyncAt && <span className="text-muted"> · last sync {when(status.lastSyncAt)}</span>}
          </span>
          <span className="flex gap-2">
            <Button disabled={busy} onClick={() => run(() => api.ventures.syncNow('etsy'))}>
              {COPY.ventures.syncNow}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => run(() => api.ventures.disconnectEtsy())}>
              {COPY.ventures.disconnect}
            </Button>
          </span>
        </div>
      ) : keysSet ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => run(() => api.ventures.connectEtsy())}>
            {busy ? COPY.ventures.connecting : COPY.ventures.connectEtsy}
          </Button>
          {status.mode === 'needs_reauth' && <span className="text-[13px] text-warn">Etsy needs you to sign in again.</span>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-muted">{COPY.ventures.keysHelp}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <Input aria-label="Etsy keystring" placeholder="Keystring" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            <Input aria-label="Etsy shared secret" placeholder="Shared secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <Button disabled={busy || !key.trim() || !secret.trim()} onClick={() => run(async () => { await api.ventures.saveEtsyKeys(key, secret); setKey(''); setSecret('') }, COPY.ventures.keysSaved)}>
            {COPY.ventures.saveKeys}
          </Button>
        </div>
      )}
      {msg && <div className="mt-2 text-[13px]">{msg}</div>}
    </Card>
  )
}

/** The link to open on a phone. */
export function PhoneLinkCard() {
  const { data } = useLoad(() => api.agent.phoneLink())
  if (!data) return null
  return (
    <Card title={COPY.ventures.phoneTitle}>
      {data.url ? (
        <>
          <p className="text-[13px] text-muted">{COPY.ventures.phoneHelp}</p>
          <code className="mt-2 block break-all rounded-md border border-line bg-bg p-2 text-[12px]">{data.url + 'ventures/'}</code>
        </>
      ) : (
        <Note>{data.reason ?? COPY.ventures.phoneOff}</Note>
      )}
    </Card>
  )
}

/** Mac only. The mailbox that gets Etsy's "new message" emails, so buyer messages show up here. Replies stay on Etsy. */
export function MailboxCard() {
  const { data: st, reload } = useLoad(() => api.ventures.mailboxStatus())
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [folder, setFolder] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!st) return null
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg((await fn()) ?? null)
    } catch (e) {
      setMsg(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
      reload()
    }
  }
  return (
    <Card title="Buyer messages from email">
      <p className="text-[13px] text-muted">
        Etsy has no way to read messages directly. Forward Etsy's "new message" emails to a mailbox and enter it here. ELO only reads it. Replies are still made on Etsy.
      </p>
      {st.configured && (
        <p className="mt-2 text-[13px]">
          Reading <b>{st.folder || 'INBOX'}</b> on {st.host} as {st.user}.
        </p>
      )}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Input aria-label="Mail host" placeholder="Mail host (for example imap.gmail.com)" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input aria-label="Mail user" placeholder="Mail user" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
        <Input aria-label="Mail folder" placeholder="Folder or label (default INBOX)" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <Input aria-label="Mail password" placeholder="App password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          disabled={busy || !host.trim() || !user.trim() || !password.trim()}
          onClick={() =>
            run(async () => {
              await api.ventures.saveMailbox({ host, user, password, folder })
              setPassword('')
              return 'Mailbox saved.'
            })
          }
        >
          Save mailbox
        </Button>
        <Button
          disabled={busy || !st.configured}
          onClick={() =>
            run(async () => {
              const r = await api.ventures.testMailbox()
              return r.ok ? `It works. ${r.found ?? 0} unread email${r.found === 1 ? '' : 's'} found.` : (r.error ?? 'It did not work.')
            })
          }
        >
          Test mailbox
        </Button>
      </div>
      {msg && <div className="mt-2 text-[13px]">{msg}</div>}
    </Card>
  )
}

/** Mac only. The category and shipping profile beth's drafts use when she does not name one, and the drafts waiting. */
export function DraftsCard() {
  const { data: defaults, reload } = useLoad(() => api.ventures.draftDefaults())
  const { data: waiting, reload: reloadWaiting } = useLoad(() => api.ventures.pendingDrafts())
  const [cat, setCat] = useState<string | null>(null)
  const [ship, setShip] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (!defaults || !waiting) return null
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const catVal = cat ?? (defaults.taxonomyId ? String(defaults.taxonomyId) : '')
  const shipVal = ship ?? (defaults.shippingProfileId ? String(defaults.shippingProfileId) : '')
  return (
    <Card title="Drafts from beth">
      <p className="text-[13px] text-muted">
        beth's drafts use these when she does not name a category or shipping profile. Both are numbers from Etsy. Drafts only: nothing goes live until you activate it on Etsy.
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Input aria-label="Default category number" inputMode="numeric" placeholder="Default category number" value={catVal} onChange={(e) => setCat(e.target.value)} />
        <Input aria-label="Default shipping profile number" inputMode="numeric" placeholder="Default shipping profile number (physical items)" value={shipVal} onChange={(e) => setShip(e.target.value)} />
      </div>
      <div className="mt-2">
        <Button
          onClick={async () => {
            try {
              await api.ventures.saveDraftDefaults({ taxonomyId: num(catVal), shippingProfileId: num(shipVal) })
              setMsg('Saved.')
              setCat(null)
              setShip(null)
              reload()
            } catch (e) {
              setMsg(String((e as Error).message ?? e))
            }
          }}
        >
          Save defaults
        </Button>
        {msg && <span className="ml-3 text-[13px]">{msg}</span>}
      </div>
      {waiting.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-wider text-muted">Waiting for Etsy ({waiting.length})</div>
          <ul className="divide-y divide-line text-[13px]">
            {waiting.map((w, i) => (
              <li key={i} className="py-2">
                <b>{w.title}</b> <span className="text-muted">({w.kind === 'create' ? 'new draft' : 'change'})</span>
                {w.error && <div className="text-warn">{w.error}</div>}
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="mt-1" onClick={reloadWaiting}>
            Refresh
          </Button>
        </div>
      )}
    </Card>
  )
}
