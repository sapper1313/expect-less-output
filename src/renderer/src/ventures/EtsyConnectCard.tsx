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
