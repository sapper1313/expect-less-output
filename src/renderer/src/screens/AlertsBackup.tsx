import { useEffect, useState } from 'react'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { AlertChannel, AlertTestResult, RestorePreview, Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Confirm, Field, Input, useBusy, TimeSelect } from '../ui'

/** A text box that saves when you click away, so typing is never interrupted by a reload. */
function TextSetting({
  label,
  value,
  onSave,
  placeholder,
  hint,
  type,
}: {
  label: string
  value: string
  onSave: (v: string) => void
  placeholder?: string
  hint?: string
  type?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Field label={label} hint={hint}>
      <Input
        type={type}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
      />
    </Field>
  )
}

function TestButton({ channel, label }: { channel: AlertChannel; label: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AlertTestResult | null>(null)
  return (
    <div className="space-y-2">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setResult(null)
          try {
            setResult(await api.alerts.sendTest(channel))
          } catch (e) {
            setResult({ ok: false, message: String((e as Error).message) })
          }
          setBusy(false)
        }}
      >
        {busy ? 'Sending...' : label}
      </Button>
      {result && (
        <div className={`text-[12px] font-semibold ${result.ok ? 'text-ok' : 'text-bad'}`}>
          {result.message}
        </div>
      )}
    </div>
  )
}

export function AlertsCard({
  s,
  save,
}: {
  s: Settings
  save: (patch: Partial<Settings>) => Promise<void>
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.alerts.status())
  const [pw, setPw] = useState('')
  return (
    <Card title="Alerts (failures only)">
      <p className="mb-4 text-[13px] text-muted">
        When a post fails for good, is missed, a login needs renewing, a daily limit is hit, or the
        Media Root folder goes missing, you get a macOS notification right away. You can also get an
        iMessage and an email.
      </p>

      <div className="space-y-4 rounded-md border border-line p-4">
        <Check checked={s.alertIMessageEnabled} onChange={(v) => save({ alertIMessageEnabled: v })}>
          <b>iMessage</b>
        </Check>
        <div className="grid gap-4 md:grid-cols-2">
          <TextSetting
            label="Send to this phone number"
            value={s.alertIMessageNumber}
            placeholder="+18045551234"
            onSave={(v) => save({ alertIMessageNumber: v })}
          />
          <div className="self-end">
            <TestButton channel="imessage" label="Send test alert" />
          </div>
        </div>
        <div className="text-[12px] leading-relaxed text-muted">
          <b>First time:</b> macOS asks if Expect Less Output may control Messages. Click <b>OK</b>.
          If you missed it, open System Settings, then Privacy and Security, then Automation, find
          Expect Less Output, and switch on Messages. Messages must be signed in with your Apple ID
          on this Mac.
        </div>
      </div>

      <div className="mt-4 space-y-4 rounded-md border border-line p-4">
        <Check checked={s.alertEmailEnabled} onChange={(v) => save({ alertEmailEnabled: v })}>
          <b>Email</b> (Gmail, off until you turn it on)
        </Check>
        <div className="grid gap-4 md:grid-cols-2">
          <TextSetting
            label="From (your Gmail address)"
            value={s.alertEmailFrom}
            placeholder="you@gmail.com"
            onSave={(v) => save({ alertEmailFrom: v })}
          />
          <TextSetting
            label="To"
            value={s.alertEmailTo}
            placeholder="you@gmail.com"
            onSave={(v) => save({ alertEmailTo: v })}
          />
          <Field
            label="Gmail app password"
            hint={st?.emailPasswordSet ? `Saved: ${st.emailPasswordMasked}` : 'Not saved yet.'}
          >
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  st?.emailPasswordSet ? 'Paste a new one to replace it' : '16 characters'
                }
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
              <Button
                disabled={busy || !pw.trim()}
                onClick={async () => {
                  if (await run(() => api.alerts.saveEmailPassword(pw))) {
                    setPw('')
                    reload()
                    toast({
                      kind: 'success',
                      headline: COPY.success,
                      detail: 'App password saved (encrypted).',
                    })
                  }
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <div className="self-end">
            <TestButton channel="email" label="Send test email" />
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-muted">
          <li>Open your Google Account and go to Security.</li>
          <li>2-Step Verification must be on. Turn it on first if it is not.</li>
          <li>
            Search for <b>App passwords</b> and open it.
          </li>
          <li>
            Name it <b>Expect Less Output</b> and click Create.
          </li>
          <li>Copy the 16 characters and paste them above.</li>
        </ol>
      </div>

      <div className="mt-4 space-y-3 rounded-md border border-line p-4">
        <Check checked={s.alertQuietEnabled} onChange={(v) => save({ alertQuietEnabled: v })}>
          <b>Quiet hours</b>
        </Check>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Start (Eastern)">
            <TimeSelect
              value={s.alertQuietStart}
              label="Quiet hours start"
              onChange={(v) => save({ alertQuietStart: v })}
            />
          </Field>
          <Field label="End (Eastern)">
            <TimeSelect
              value={s.alertQuietEnd}
              label="Quiet hours end"
              onChange={(v) => save({ alertQuietEnd: v })}
            />
          </Field>
        </div>
        <div className="text-[12px] text-muted">
          During quiet hours iMessage and email wait. You get one summary when they end. The
          notification on this Mac still shows.
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <TestButton channel="notification" label="Send test notification" />
        <div className="text-[12px] text-muted">
          If more than 3 alerts happen in 5 minutes, the first 3 go out at once and the rest arrive
          as one combined message.
        </div>
      </div>
    </Card>
  )
}

export function BackupCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [newRoot, setNewRoot] = useState('')
  const [confirm, setConfirm] = useState(false)

  return (
    <Card title="Backup and restore">
      <p className="mb-4 text-[13px] text-muted">
        A backup holds your brands, slots, posts, settings and thumbnails. It does <b>not</b> hold
        your videos or your logins. After a restore you reconnect each account, and you copy the
        Media Root folder to the new Mac yourself.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.backup.export())
            if (r)
              toast({
                kind: 'success',
                headline: COPY.success,
                detail: `Backup saved to ${r.saved}. ${r.accounts} account(s) will need reconnecting after a restore.`,
              })
          }}
        >
          Export backup
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            const p = await run(() => api.backup.pick())
            if (p) {
              setPreview(p)
              setNewRoot('')
            }
          }}
        >
          Restore from backup
        </Button>
      </div>

      {preview && (
        <div className="mt-4 space-y-3 rounded-md border border-line p-4 text-[13px]">
          <div>
            Backup made {formatEastern(preview.createdAt)} by version {preview.appVersion}. It used
            the Media Root <span className="font-mono">{preview.oldMediaRoot}</span>.
          </div>
          <div>
            {preview.accountsToReconnect.length === 0
              ? 'No accounts were connected.'
              : 'You will need to reconnect: '}
            {preview.accountsToReconnect.map((a) => `${a.brandName} ${a.platform}`).join(', ')}
          </div>
          <Field
            label="Media Root folder on THIS Mac"
            hint="Copy your videos here first. Posts keep their folder names, so everything lines up."
          >
            <div className="flex gap-2">
              <Input readOnly value={newRoot} placeholder="Choose a folder" />
              <Button
                onClick={async () => {
                  const p = await api.settings.pickMediaRoot()
                  if (p) setNewRoot(p)
                }}
              >
                Choose
              </Button>
            </div>
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={!newRoot || busy} onClick={() => setConfirm(true)}>
              Restore and restart
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {confirm && preview && (
        <Confirm
          title="Restore this backup?"
          message="This replaces everything in the app with the backup. A safety copy of what is here now is saved first. The app restarts when it is done."
          confirmLabel="Restore and restart"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false)
            await run(() => api.backup.restore(preview.zipPath, newRoot))
          }}
        />
      )}
    </Card>
  )
}
