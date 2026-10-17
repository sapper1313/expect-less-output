import { useState } from 'react'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, useBusy } from '../ui'
import { LocalModelLight } from './StudioModels'

/** Chat with the studio from your phone through your own Telegram bot. */
export function TelegramCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.telegram.status())
  const { data: keys, reload: reloadKeys } = useLoad(() => api.studio.keyStatus())
  const [token, setToken] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const key = keys?.find((k) => k.id === 'telegram')
  return (
    <Card title="Chat with the studio from your phone (Telegram)">
      <div className="mb-3">
        <LocalModelLight />
      </div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12px] text-muted">
        <li>
          In Telegram, message <b>@BotFather</b>, send <b>/newbot</b>, and follow the steps. It
          gives you a long token.
        </li>
        <li>Paste the token below and press Save.</li>
        <li>Tick "Turn on", then press Show pairing code.</li>
        <li>
          Open your new bot in Telegram and send it the 6 digit number. After that only your phone
          can talk to it.
        </li>
      </ol>
      <div className="space-y-3">
        <Field
          label="Bot token"
          hint={
            key?.has ? `Saved: ${key.masked}` : 'Kept in the Mac Keychain, never shown in full.'
          }
        >
          <div className="flex gap-2">
            <Input
              type="password"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={key?.has ? 'Paste a new token to replace it' : 'Paste the token'}
            />
            <Button
              disabled={busy || !token.trim()}
              onClick={() =>
                run(async () => {
                  await api.studio.setKey('telegram', token.trim())
                  setToken('')
                  reloadKeys()
                  reload()
                  toast({ kind: 'success', headline: 'Token saved.' })
                })
              }
            >
              Save
            </Button>
            {key?.has && (
              <Button
                onClick={() =>
                  run(async () => {
                    await api.studio.removeKey('telegram')
                    reloadKeys()
                    reload()
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
        </Field>
        <Check
          checked={!!st?.enabled}
          onChange={(v) =>
            run(async () => {
              await api.telegram.setEnabled(v)
              reload()
            })
          }
        >
          Turn on the phone chat
        </Check>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || !st?.hasToken}
            onClick={() =>
              run(async () => {
                try {
                  toast({ kind: 'success', headline: await api.telegram.test() })
                } catch (e) {
                  toast({
                    kind: 'error',
                    headline: 'The bot did not answer.',
                    detail: (e as Error).message,
                  })
                }
              })
            }
          >
            Test the bot
          </Button>
          <Button
            disabled={busy || !st?.hasToken}
            onClick={() =>
              run(async () => {
                setCode(await api.telegram.newCode())
                reload()
              })
            }
          >
            Show pairing code
          </Button>
          <Button
            disabled={busy || !st?.paired}
            onClick={() =>
              run(async () => {
                await api.telegram.unpair()
                setCode(null)
                reload()
              })
            }
          >
            Unpair all phones
          </Button>
          {code && (
            <span className="rounded-md border border-line px-3 py-1 text-[18px] font-bold tracking-widest">
              {code}
            </span>
          )}
        </div>
        <div className="text-[12px] text-muted">
          {st?.paired
            ? `${st.paired} phone${st.paired === 1 ? '' : 's'} paired.`
            : 'No phone is paired yet.'}{' '}
          Try "how is the last post doing?" or /status, /latest, /spend, /flags. It answers with
          your Text model from Settings, AI models and Local AI, and it can only pause or resume
          after you say YES.
        </div>
      </div>
    </Card>
  )
}
