import { useState } from 'react'
import { UPLOAD_POST_PLATFORMS, UPLOAD_POST_POSTS_TO, type UploadPostLink, type UploadPostTest } from '@shared/uploadPost'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Input, useBusy } from '../ui'

/** Upload-Post: the API key, then one row per channel with its profile name and the platforms that are active. */
export function UploadPostCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: st, reload } = useLoad(() => api.uploadPost.get())
  const [key, setKey] = useState('')
  const [test, setTest] = useState<UploadPostTest | null>(null)
  if (!st) return null

  const doTest = () =>
    run(async () => {
      const r = await api.uploadPost.test()
      setTest(r)
      toast({ kind: r.ok ? 'success' : 'error', headline: r.ok ? 'Test passed.' : 'Test failed.', detail: r.message })
    })

  return (
    <Card title="Upload-Post">
      <p className="mb-3 text-[12px] text-muted">
        Upload-Post is the paid service that holds your logins. ELO uses it to post to TikTok straight to the
        feed and to post Instagram Reels. For the other platforms you tick, it is used for comments, first comments and
        numbers. It never posts to them. The key is kept in the macOS Keychain and is never shown again.
      </p>

      <div className="rounded-md border border-line p-3">
        <div className="flex items-center justify-between">
          <b className="text-[13px]">Step 1. API key</b>
          <span className={`text-[11px] font-bold uppercase ${st.hasKey ? 'text-ok' : 'text-muted'}`}>
            {st.hasKey ? 'Saved' : 'Not saved'}
          </span>
        </div>
        {st.hasKey && <div className="mt-1 text-[12px] text-muted">{st.masked}</div>}
        <div className="mt-2 flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder={st.hasKey ? 'Paste a new key to replace' : 'Paste your Upload-Post API key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            disabled={busy || !key.trim()}
            onClick={() =>
              run(async () => {
                await api.uploadPost.setKey(key)
                setKey('')
                reload()
                await doTest()
              })
            }
          >
            {st.hasKey ? 'Replace' : 'Save'}
          </Button>
          <Button disabled={busy || !st.hasKey} onClick={() => void doTest()}>
            Test
          </Button>
          <Button
            variant="danger"
            disabled={busy || !st.hasKey}
            onClick={() =>
              run(async () => {
                await api.uploadPost.removeKey()
                setTest(null)
                reload()
              })
            }
          >
            Remove
          </Button>
        </div>
        {test && (
          <p className={`mt-2 text-[12px] ${test.ok ? 'text-ok' : 'text-bad'}`}>{test.message}</p>
        )}
        {test && test.profiles.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12px] text-muted" aria-label="Profiles on this key">
            {test.profiles.map((p) => (
              <li key={p.username}>
                Username to type: <code className="select-all rounded bg-surface2 px-1.5 py-0.5 text-ink">{p.username}</code>
                {' '}({p.connected.length ? `logged in: ${p.connected.join(', ')}` : 'no logins yet'})
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <b className="text-[13px]">Step 2. Each channel</b>
        <p className="mb-2 mt-1 text-[12px] text-muted">
          Type the profile name exactly as it is on Upload-Post, then tick the platforms you have logged in there.
          ELO cannot see what is logged in, so it only trusts your ticks. TikTok ticked means ELO posts to TikTok
          through Upload-Post. TikTok not ticked means ELO puts the video in your TikTok drafts like before. Instagram ticked means ELO posts the
          Reel through Upload-Post. Instagram not ticked means ELO uses its own Instagram login like before.
        </p>
        <div className="space-y-3">
          {st.links.map((l) => (
            <ChannelRow
              key={l.brandId}
              link={l}
              known={test?.profiles.find((p) => p.username === l.profile.trim())?.connected ?? null}
              profileNames={test?.profiles.map((p) => p.username) ?? []}
              onSaved={reload}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}

function ChannelRow({
  link,
  known,
  profileNames,
  onSaved,
}: {
  link: UploadPostLink
  /** Platforms Upload-Post says this profile has, from the last Test. Null when not tested or no match. */
  known: string[] | null
  profileNames: string[]
  onSaved: () => void
}) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [profile, setProfile] = useState(link.profile)
  const [on, setOn] = useState<Record<string, boolean>>(link.platforms)
  const dirty =
    profile.trim() !== link.profile ||
    UPLOAD_POST_PLATFORMS.some((p) => (on[p.key] === true) !== (link.platforms[p.key] === true))
  const listId = `up-profiles-${link.brandId}`
  const missing = (on[UPLOAD_POST_POSTS_TO] === true && known && !known.includes(UPLOAD_POST_POSTS_TO)) || false

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <b className="min-w-[160px] text-[13px]">{link.brandName}</b>
        <Input
          className="max-w-[240px]"
          placeholder="Profile name on Upload-Post"
          list={listId}
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
        <datalist id={listId}>
          {profileNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          disabled={busy || !dirty}
          onClick={() =>
            run(async () => {
              await api.uploadPost.setLink(link.brandId, profile, on)
              onSaved()
              toast({ kind: 'success', headline: 'Saved.', detail: link.brandName })
            })
          }
        >
          Save
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {UPLOAD_POST_PLATFORMS.map((p) => (
          <Check key={p.key} checked={on[p.key] === true} onChange={(v) => setOn({ ...on, [p.key]: v })}>
            {p.label}
            {p.key === UPLOAD_POST_POSTS_TO ? ' (posts)' : ''}
            {known?.includes(p.key) ? ' ✓' : ''}
          </Check>
        ))}
      </div>
      {known && (
        <p className="mt-1 text-[11px] text-muted">
          A check mark means Upload-Post says this profile has that login.
        </p>
      )}
      {missing && (
        <p className="mt-1 text-[12px] text-bad">
          Upload-Post does not show a TikTok login on this profile. Connect it on their site first.
        </p>
      )}
    </div>
  )
}
