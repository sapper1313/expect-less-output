import { useMemo, useState } from 'react'
import { PLATFORM_LABELS, type Platform } from '@shared/platformLimits'
import { formatEastern } from '@shared/time'
import type { DmConversation, InboxComment } from '@shared/engage'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { ThemedHost } from '../components/ThemedHost'
import pageCss from '../dashboard/dashboard.css?inline'
import postedCss from '../dashboard/posted.css?inline'

// Inside a screen the page has no background of its own, so it sits flush with the app.
const CSS = pageCss + postedCss + ':host{background:transparent!important;min-height:0}'
const label = (p: string) => PLATFORM_LABELS[p as Platform] ?? p
const plain = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A box to type a reply, with the local AI's ideas under it. Nothing is sent until the Send button is clicked. */
function ReplyBox({
  send,
  draft,
  sendLabel,
  disabledNote,
  onSent,
}: {
  send: (text: string) => Promise<void>
  draft: () => Promise<string[]>
  sendLabel: string
  disabledNote?: string
  onSent?: () => void
}) {
  const [text, setText] = useState('')
  const [ideas, setIdeas] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(plain(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <textarea
        className="f"
        value={text}
        placeholder="Type a reply"
        aria-label="Reply"
        disabled={!!disabledNote}
        onChange={(e) => setText(e.target.value)}
      />
      {disabledNote && <div className="note">{disabledNote}</div>}
      <div className="cacts">
        <button
          type="button"
          className="btn glass sm go"
          disabled={busy || !text.trim() || !!disabledNote}
          onClick={() =>
            go(async () => {
              await send(text)
              setText('')
              setIdeas([])
              onSent?.()
            })
          }
        >
          {sendLabel}
        </button>
        <button
          type="button"
          className="btn glass sm"
          disabled={busy || !!disabledNote}
          onClick={() => go(async () => setIdeas(await draft()))}
        >
          Suggest replies (local AI)
        </button>
      </div>
      {ideas.length > 0 && (
        <div className="sugg">
          {ideas.map((i) => (
            <button key={i} type="button" onClick={() => setText(i)}>
              {i}
            </button>
          ))}
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

/** Comments on posted videos, from every platform ticked on the Upload-Post card, in one list. */
export function CommentsInbox() {
  const { toast } = useApp()
  const [brandId, setBrandId] = useState<number | null>(null)
  const [platform, setPlatform] = useState('')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [busy, setBusy] = useState(false)
  const [replying, setReplying] = useState<number | null>(null)
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: up } = useLoad(() => api.uploadPost.get())
  const { data: items, reload } = useLoad(
    () => api.engage.comments({ brandId, platform: platform || null, show }),
    [brandId, platform, show],
  )
  const platforms = useMemo(() => ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin'], [])

  const refresh = async () => {
    setBusy(true)
    try {
      const r = await api.engage.refresh()
      reload()
      toast({
        kind: r.problems.length ? 'error' : 'success',
        headline: r.problems.length ? 'Some comments could not be read.' : 'Checked for new comments.',
        detail: r.problems.length ? r.problems.join(' ') : `${r.checked} videos checked, ${r.added} new comments.`,
      })
    } catch (e) {
      toast({ kind: 'error', headline: 'That did not work.', detail: plain(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ThemedHost css={CSS}>
      <div className="page" style={{ padding: 0 }}>
        <p className="sub">
          Comments on your posted videos, from every platform you ticked for a channel on the Upload-Post card in AI
          Settings. ELO checks about every 15 minutes for new videos and less often for older ones. A reply is only
          sent when you click Send.
        </p>
        <section className="glass filters" style={{ marginTop: 14 }}>
          <select className="f" aria-label="Channel" value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All channels</option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select className="f" aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
          <select className="f" aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')}>
            <option value="open">Waiting for a reply</option>
            <option value="all">Everything</option>
          </select>
          <button type="button" className="btn glass sm" disabled={busy || !up?.hasKey} onClick={refresh}>
            {busy ? 'Checking' : 'Check for new comments'}
          </button>
        </section>

        {up && !up.hasKey && (
          <div className="glass card muted">Add your Upload-Post key in AI Settings first. Comments are read through it.</div>
        )}
        {up?.hasKey && items && items.length === 0 && (
          <div className="glass card muted">
            {show === 'open'
              ? 'No comments are waiting. Click Check for new comments to look now.'
              : 'No comments yet. Only platforms ticked for a channel on the Upload-Post card are checked.'}
          </div>
        )}
        <div className="cards-col">
          {items?.map((c) => (
            <CommentCard
              key={c.id}
              c={c}
              open={replying === c.id}
              onOpen={() => setReplying(replying === c.id ? null : c.id)}
              reload={reload}
            />
          ))}
        </div>
      </div>
    </ThemedHost>
  )
}

function CommentCard({ c, open, onOpen, reload }: { c: InboxComment; open: boolean; onOpen: () => void; reload: () => void }) {
  return (
    <article className="glass ccard">
      <div className="cmeta">
        <span className="who2">
          <span className="dot" style={{ background: c.brandColor }} />
          {c.brandName}
        </span>
        <span className="pchip">{label(c.platform)}</span>
        <span>{c.atUtc ? formatEastern(c.atUtc) : ''}</span>
      </div>
      {c.postTitle && <div className="cvideo">On: {c.postTitle}</div>}
      <p className="ctext">
        {c.author && <span className="cauthor">{c.author.startsWith('@') ? c.author : `@${c.author}`}: </span>}
        {c.text}
      </p>
      {c.status === 'replied' && c.replyText && <div className="replied">You replied: {c.replyText}</div>}
      <div className="cacts">
        {c.status !== 'replied' && (
          <button type="button" className="btn glass sm go" onClick={onOpen}>
            {open ? 'Close' : 'Reply'}
          </button>
        )}
        {c.status === 'done' ? (
          <button type="button" className="btn glass sm" onClick={() => api.engage.setStatus(c.id, 'new').then(reload)}>
            Put back
          </button>
        ) : c.status === 'new' ? (
          <button type="button" className="btn glass sm" onClick={() => api.engage.setStatus(c.id, 'done').then(reload)}>
            Mark done
          </button>
        ) : null}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <ReplyBox
            sendLabel="Send reply"
            send={(t) => api.engage.reply(c.id, t)}
            draft={() => api.engage.draft(c.id)}
            onSent={reload}
          />
        </div>
      )}
    </article>
  )
}

/** Instagram messages for every channel with Instagram ticked. Instagram is the only platform Upload-Post offers messages for. */
export function MessagesInbox() {
  const [force, setForce] = useState(0)
  const { data: channels } = useLoad(() => api.engage.dms(force > 0), [force])
  const [sel, setSel] = useState<{ brandId: number; id: string } | null>(null)
  const all = useMemo(
    () => (channels ?? []).flatMap((c) => c.conversations.map((v) => ({ brandId: c.brandId, brandName: c.brandName, v }))),
    [channels],
  )
  const current = all.find((x) => x.brandId === sel?.brandId && x.v.id === sel?.id) ?? null

  return (
    <ThemedHost css={CSS}>
      <div className="page" style={{ padding: 0 }}>
        <p className="sub">
          Instagram messages for every channel with Instagram ticked on the Upload-Post card. Instagram only lets you
          reply within 24 hours of their last message. Other platforms do not offer messages through Upload-Post.
        </p>
        <section className="glass filters" style={{ marginTop: 14 }}>
          <button type="button" className="btn glass sm" onClick={() => setForce((n) => n + 1)}>
            Check for new messages
          </button>
        </section>
        {channels && channels.length === 0 && (
          <div className="glass card muted">No channel has Instagram ticked on the Upload-Post card in AI Settings yet.</div>
        )}
        {channels?.filter((c) => c.problem).map((c) => (
          <div key={c.brandId} className="glass card muted" style={{ marginBottom: 12 }}>
            {c.brandName}: {c.problem}
          </div>
        ))}
        {all.length > 0 && (
          <div className="dmwrap">
            <section className="glass dmlist">
              {all.map(({ brandId, brandName, v }) => (
                <button
                  key={`${brandId}-${v.id}`}
                  type="button"
                  className={`dmitem ${current?.v.id === v.id && current.brandId === brandId ? 'on' : ''}`}
                  onClick={() => setSel({ brandId, id: v.id })}
                >
                  <div className="n">{v.withName}</div>
                  <div className="c">
                    {brandName} {v.lastAtUtc ? ` ${formatEastern(v.lastAtUtc)}` : ''}
                  </div>
                  <div className="p">{v.messages[v.messages.length - 1]?.text}</div>
                </button>
              ))}
            </section>
            <section className="glass thread">
              {current ? <Thread key={`${current.brandId}-${current.v.id}`} brandId={current.brandId} v={current.v} onSent={() => setForce((n) => n + 1)} /> : <div className="muted">Pick a conversation.</div>}
            </section>
          </div>
        )}
        {channels && channels.length > 0 && all.length === 0 && !channels.some((c) => c.problem) && (
          <div className="glass card muted">No conversations yet.</div>
        )}
      </div>
    </ThemedHost>
  )
}

function Thread({ brandId, v, onSent }: { brandId: number; v: DmConversation; onSent: () => void }) {
  return (
    <div>
      <div className="cmeta">
        <span className="who2">{v.withName}</span>
      </div>
      <div className="bubs" style={{ marginTop: 10 }}>
        {v.messages.map((m) => (
          <div key={m.id} className={`bub ${m.mine ? 'mine' : ''}`}>
            {m.text}
            <span className="t">{m.atUtc ? formatEastern(m.atUtc) : ''}</span>
          </div>
        ))}
      </div>
      <ReplyBox
        sendLabel="Send message"
        send={(t) => api.engage.dmSend(brandId, v.withId, t)}
        draft={() => api.engage.dmDraft(brandId, v.withId)}
        disabledNote={v.canReply ? undefined : 'Instagram only allows a reply within 24 hours of their last message. That time has passed.'}
        onSent={onSent}
      />
    </div>
  )
}
