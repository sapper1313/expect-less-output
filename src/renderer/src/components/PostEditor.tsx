import { friendlyError } from '@shared/friendlyError'
import { useEffect, useState } from 'react'
import { PLATFORM_LABELS, captionCounters } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { Post } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import {
  BrandDot,
  Button,
  Check,
  Confirm,
  Counter,
  Dialog,
  Field,
  Input,
  StatusBadge,
  TargetChip,
  Textarea,
  useBusy,
} from '../ui'
import { PlatformPicker, WhenPicker } from './pickers'
import { PostStatsPanel } from './StatsPanel'
import { PostingAs, TikTokSection, useCreator } from './TikTokSection'
import { previewFor } from '@shared/preview'
import { slotKindFor } from '@shared/slots'
import { Suggest } from './Suggest'
import { emptyTikTokSettings } from '@shared/tiktok'

export function PostEditor({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: post } = useLoad(() => api.posts.get(postId), [postId])
  const { data: accounts } = useLoad(
    () => (post ? api.accounts.list(post.brandId) : Promise.resolve([])),
    [post?.brandId],
  )
  const ttAcct = accounts?.find((a) => a.platform === 'tiktok')
  const { data: brandDefaults } = useLoad(
    () => (post ? api.brands.getDefaults(post.brandId) : Promise.resolve(null)),
    [post?.brandId],
  )
  const ttOpen =
    !!post && post.targets.some((t) => t.platform === 'tiktok' && t.status !== 'posted')
  const ttLive = ttOpen && !!ttAcct && ttAcct.mode !== 'dry_run' && ttAcct.status === 'connected'
  const creator = useCreator(post?.brandId ?? null, ttLive)
  const [draft, setDraft] = useState<Post | null>(null)
  const [platforms, setPlatforms] = useState<Post['targets'][number]['platform'][]>([])
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [alsoFile, setAlsoFile] = useState(false)
  const [urls, setUrls] = useState<Record<number, string>>({})
  /** Each platform's own time. A platform left out follows the post's time. */
  const [times, setTimes] = useState<Partial<Record<Post['targets'][number]['platform'], string | null>>>({})

  useEffect(() => {
    if (post && (!draft || draft.id !== post.id)) {
      setDraft(post)
      setPlatforms(post.targets.filter((t) => t.status !== 'skipped').map((t) => t.platform))
      setTimes(Object.fromEntries(post.targets.filter((t) => t.status !== 'skipped').map((t) => [t.platform, t.scheduledAtUtc])))
    } else if (post && draft) {
      // keep local edits, but follow status and target changes coming from the scheduler
      setDraft((d) => (d ? { ...d, status: post.status, targets: post.targets } : d))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post])

  if (!draft) return null
  const locked = ['posted', 'in_progress'].includes(draft.status)
  const canCommentNow = draft.targets.some((t) => t.status === 'posted')
  const counters = captionCounters(draft.title, draft.caption)
  const failed = draft.targets.filter((t) => t.status === 'failed')
  const waiting = draft.targets.filter((t) => t.status === 'needs_action')
  const todo = draft.targets.filter((t) => t.checklist)
  const ttTarget = draft.targets.find((t) => t.platform === 'tiktok' && t.status !== 'posted')
  const igTarget = draft.targets.find((t) => t.platform === 'instagram' && t.status !== 'posted')
  const uploading = draft.targets.filter((t) => t.status === 'uploading' && t.progress !== null)
  const set = <K extends keyof Post>(k: K, v: Post[K]) => setDraft({ ...draft, [k]: v })

  async function save(status?: 'draft' | 'scheduled') {
    const existing = new Map(draft!.targets.map((t) => [t.platform, t]))
    const saved = await run(() =>
      api.posts.update(draft!.id, {
        title: draft!.title,
        caption: draft!.caption,
        firstComment: draft!.firstComment ?? '',
        // The post's own time stays as it was. The platform times below move it, so one platform can change alone.
        scheduledAtUtc: post?.scheduledAtUtc ?? draft!.scheduledAtUtc,
        status,
        targets: platforms.map((p) => ({
          platform: p,
          ...(draft!.postType !== 'clip' && existing.get(p)?.status !== 'posted' && times[p] !== undefined
            ? { scheduledAtUtc: times[p] }
            : {}),
          aiFlag: existing.get(p)?.aiFlag ?? false,
          captionOverride: existing.get(p)?.captionOverride ?? null,
          settings: existing.get(p)?.settings,
        })),
      }),
    )
    if (saved) {
      toast({ kind: 'success', headline: COPY.success, detail: `Saved "${saved.title}".` })
      onClose()
    }
  }

  return (
    <Dialog title="Edit post" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div>
          {draft.posterUrl ? (
            <img src={draft.posterUrl} alt="Poster frame" className="w-full rounded-md" />
          ) : (
            <div className="h-48 rounded-md bg-surface2" />
          )}
          <div className="mt-2 text-[12px] text-muted">{draft.fileName}</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={draft.status} />
          </div>
          <div className="mt-2 text-[13px]">
            <BrandDot color={draft.brandColor} name={draft.brandName} />
          </div>
        </div>
        <div className="space-y-4">
          {(failed.length > 0 || draft.status === 'missed') && (
            <div className="rounded-md border border-bad p-3">
              <div className="display text-2xl text-bad">
                {draft.status === 'missed' ? COPY.missedHeadline : COPY.failureHeadline}
              </div>
              {failed.map((t) => (
                <div
                  key={t.id}
                  className="mt-2 flex items-center justify-between gap-3 text-[13px]"
                >
                  <span>
                    {COPY.failureDetail(
                      PLATFORM_LABELS[t.platform],
                      draft.brandName,
                      draft.title,
                      friendlyError(t.lastError),
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      placeholder="Video link (optional)"
                      value={urls[t.id] ?? ''}
                      onChange={(e) => setUrls({ ...urls, [t.id]: e.target.value })}
                    />
                    <Button disabled={busy} onClick={() => run(() => api.posts.retryTarget(t.id))}>
                      Retry
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => run(() => api.posts.markPosted(t.id, urls[t.id]))}
                    >
                      Already posted
                    </Button>
                  </div>
                </div>
              ))}
              {draft.status === 'missed' && (
                <div className="mt-2 flex items-center justify-between text-[13px]">
                  <span>
                    {COPY.failureDetail(
                      'All platforms',
                      draft.brandName,
                      draft.title,
                      'the Mac was not awake at the scheduled time.',
                    )}
                  </span>
                  <Button
                    onClick={() =>
                      run(async () => {
                        await api.posts.postNow(draft.id)
                        onClose()
                      })
                    }
                  >
                    Post now
                  </Button>
                </div>
              )}
            </div>
          )}

          {(draft.status === 'posted' || draft.status === 'partial') && (
            <PostStatsPanel postId={draft.id} />
          )}

          {waiting.length > 0 && (
            <div className="rounded-md border border-warn p-3">
              <div className="display text-2xl text-warn">Waiting for you</div>
              {waiting.map((t) => (
                <div key={t.id} className="mt-2 space-y-2 text-[13px]">
                  <div>
                    {PLATFORM_LABELS[t.platform]}, {draft.brandName}, "{draft.title}": the title and
                    description were copied. Upload the video by hand, then mark it done. If the account is set to upload for you, use Try the upload again.
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Video link (optional, lets Stats work)"
                      value={urls[t.id] ?? ''}
                      onChange={(e) => setUrls({ ...urls, [t.id]: e.target.value })}
                    />
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => run(() => api.posts.markPosted(t.id, urls[t.id]))}
                    >
                      Mark as posted
                    </Button>
                    <Button disabled={busy} onClick={() => run(() => api.posts.retryTarget(t.id))}>
                      Try the upload again
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {todo.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border border-warn p-3 text-[13px]"
            >
              <span>
                <b className="text-warn">{t.checklist}</b>: {PLATFORM_LABELS[t.platform]} has no way
                to set the AI label from here.{' '}
                {t.externalUrl && (
                  <a
                    href={t.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-accent underline"
                  >
                    Open the post
                  </a>
                )}
              </span>
              <Button disabled={busy} onClick={() => run(() => api.posts.dismissChecklist(t.id))}>
                Done
              </Button>
            </div>
          ))}
          {uploading.map((t) => (
            <div key={t.id}>
              <div className="mb-1 text-[12px] text-muted">
                Uploading to {PLATFORM_LABELS[t.platform]}: {Math.round((t.progress ?? 0) * 100)}%
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-surface2">
                <div
                  className="h-full bg-hot"
                  style={{ width: `${Math.round((t.progress ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          ))}

          <Field label="Title">
            <Input
              value={draft.title}
              disabled={locked}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          {!locked && (
            <div className="flex flex-wrap items-start gap-2">
              <Suggest
                kind="title"
                brandId={draft.brandId}
                title={draft.title}
                caption={draft.caption}
                onPick={(t) => set('title', t)}
              />
              <Suggest
                kind="caption"
                brandId={draft.brandId}
                title={draft.title}
                caption={draft.caption}
                onPick={(t) => set('caption', t)}
              />
              <Suggest
                kind="hashtags"
                brandId={draft.brandId}
                title={draft.title}
                caption={draft.caption}
                onPick={(t) =>
                  set('caption', `${draft.caption.trim()}${draft.caption.trim() ? '\n\n' : ''}${t}`)
                }
              />
            </div>
          )}
          <Field label="Caption">
            <Textarea
              rows={4}
              value={draft.caption}
              disabled={locked}
              onChange={(e) => set('caption', e.target.value)}
            />
          </Field>
          <Field label="First comment" hint="Optional. A question or call to action that ELO posts as the first comment as soon as the video is live. It goes through Upload-Post, on the platforms ticked for this channel in AI Settings. Instagram cannot take one.">
            <Textarea
              rows={2}
              value={draft.firstComment ?? ''}
              disabled={locked && !canCommentNow}
              onChange={(e) => set('firstComment', e.target.value)}
              placeholder="Which one would you try first?"
            />
            {locked && canCommentNow && (
              <div className="mt-2 flex items-center gap-3">
                <Button
                  variant="primary"
                  disabled={busy || !(draft.firstComment ?? '').trim()}
                  onClick={async () => {
                    const p = await run(() => api.uploadPost.commentNow(draft.id, draft.firstComment ?? ''))
                    if (p) {
                      setDraft((d) => (d ? { ...d, targets: p.targets, firstComment: p.firstComment } : d))
                      toast({
                        kind: 'success',
                        headline: 'Comment sent for posting.',
                        detail: 'See each platform below for how it went.',
                      })
                    }
                  }}
                >
                  Post comment now
                </Button>
                <span className="text-[12px] text-muted">
                  This post is live, so the comment goes out now on the platforms ticked for this channel.
                </span>
              </div>
            )}
          </Field>
          <div className="flex flex-wrap gap-x-4">
            {draft.targets.flatMap((t) =>
              counters[t.platform].map((c) => (
                <Counter
                  key={t.platform + c.label}
                  c={{ ...c, label: `${PLATFORM_LABELS[t.platform]} ${c.label.toLowerCase()}` }}
                />
              )),
            )}
          </div>
          <Field label="When (Eastern time)">
            {draft.postType === 'clip' ? (
              <WhenPicker
                brandId={draft.brandId}
                disabled={locked}
                value={draft.scheduledAtUtc}
                onChange={(v) => set('scheduledAtUtc', v)}
                slotsToo={false}
              />
            ) : (
              <div className="space-y-3">
                <div className="text-[12px] text-muted">
                  Each platform has its own time. Pick one of its open slots, or Pick a different time to use any date
                  and time.
                </div>
                {platforms.map((p) => {
                  const t = draft.targets.find((x) => x.platform === p)
                  const done = t?.status === 'posted'
                  return (
                    <div key={p} className="grid items-start gap-2 md:grid-cols-[110px_1fr]">
                      <div className="pt-2 text-[13px] font-semibold">{PLATFORM_LABELS[p]}</div>
                      {done ? (
                        <div className="pt-2 text-[13px] text-muted">
                          Posted {t?.postedAtUtc ? formatEastern(t.postedAtUtc) : ''}
                        </div>
                      ) : (
                        <WhenPicker
                          brandId={draft.brandId}
                          platform={p}
                          kind={slotKindFor(draft.videoMeta)}
                          disabled={locked}
                          value={times[p] ?? draft.scheduledAtUtc}
                          onChange={(v) => setTimes({ ...times, [p]: v })}
                        />
                      )}
                    </div>
                  )
                })}
                {platforms.length > 1 && !locked && (
                  <Button
                    onClick={() => {
                      const open = platforms.filter((p) => draft.targets.find((x) => x.platform === p)?.status !== 'posted')
                      const first = open.map((p) => times[p] ?? draft.scheduledAtUtc).find((x) => !!x) ?? null
                      setTimes({ ...times, ...Object.fromEntries(open.map((p) => [p, first])) })
                    }}
                  >
                    Same time for all platforms
                  </Button>
                )}
              </div>
            )}
          </Field>
          {ttTarget && ttLive && !locked && (
            <div className="space-y-2 rounded-md border border-line p-3">
              <div className="display text-xl">TikTok</div>
              {ttAcct?.mode === 'direct' ? (
                <TikTokSection
                  info={creator.info}
                  loading={creator.loading}
                  error={creator.error}
                  value={ttTarget.settings.tiktok ?? emptyTikTokSettings()}
                  durationSeconds={draft.videoMeta.durationSeconds ?? 0}
                  aiFlag={ttTarget.aiFlag}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      targets: draft.targets.map((t) =>
                        t.id === ttTarget.id ? { ...t, settings: { ...t.settings, tiktok: v } } : t,
                      ),
                    })
                  }
                />
              ) : (
                <div className="space-y-1 text-[13px]">
                  <PostingAs info={creator.info} />
                  <p className="text-muted">
                    Drafts mode: you choose the privacy and settings in the TikTok app.
                  </p>
                </div>
              )}
            </div>
          )}
          {igTarget && (
            <Field label="Instagram cover frame (milliseconds from the start, optional)">
              <Input
                type="number"
                min={0}
                disabled={locked}
                value={igTarget.settings.thumbOffsetMs ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    targets: draft.targets.map((t) =>
                      t.id === igTarget.id
                        ? {
                            ...t,
                            settings: {
                              ...t.settings,
                              thumbOffsetMs:
                                e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          }
                        : t,
                    ),
                  })
                }
              />
            </Field>
          )}
          {draft.targets.length > 0 && (
            <div className="space-y-2 rounded-md border border-line p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                What each platform will get
              </div>
              {draft.targets.map((t) => {
                const pv = previewFor(t.platform, draft, t.captionOverride, {
                  appendShorts: !!brandDefaults?.youtubeAppendShorts,
                })
                return (
                  <div key={t.id} className="text-[12px]">
                    <div className="font-semibold">{PLATFORM_LABELS[t.platform]}</div>
                    {pv.title !== undefined && (
                      <div className="text-ink">Title: {pv.title || '(empty)'}</div>
                    )}
                    <div className="whitespace-pre-wrap text-muted">
                      {pv.body || '(empty caption)'}
                    </div>
                    <FirstCommentLine
                      target={t}
                      fallback={draft.firstComment}
                      onRetry={async () => {
                        await run(() => api.uploadPost.retryFirstComment(t.id))
                      }}
                    />
                  </div>
                )
              })}
              {!locked && draft.targets.some((t) => t.status === 'pending') && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      const changed = await run(() => api.growth.morphCaptions(draft.id))
                      if (changed)
                        toast({
                          kind: 'success',
                          headline: changed.length
                            ? 'Each platform now has its own version.'
                            : 'Nothing to change.',
                          detail: changed.join(', '),
                        })
                    }}
                  >
                    Reformat for each platform
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      const msg = await run(() => api.growth.normalizeAudio(draft.id))
                      if (msg) toast({ kind: 'success', headline: COPY.success, detail: msg })
                    }}
                  >
                    Set sound to -14 LUFS
                  </Button>
                </div>
              )}
            </div>
          )}
          <Field label="Platforms">
            <PlatformPicker brandId={draft.brandId} value={platforms} onChange={setPlatforms} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {draft.targets.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 text-[12px] text-muted">
                <TargetChip platform={t.platform} status={t.status} /> {t.status.replace('_', ' ')}
                {t.attempts > 0 && t.status !== 'posted' && ` (try ${t.attempts})`}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              const copy = await run(() => api.posts.duplicate(draft.id))
              if (copy) {
                toast({
                  kind: 'success',
                  headline: COPY.success,
                  detail: `Duplicated as a draft: "${copy.title}". Find it in the Queue.`,
                })
                onClose()
              }
            }}
          >
            Duplicate
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirm('delete')}>
            Delete
          </Button>
          {!['posted', 'canceled'].includes(draft.status) && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirm('cancel')}>
              Cancel post
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>Close</Button>
          {!locked && draft.status !== 'posted' && (
            <>
              {['draft', 'canceled'].includes(draft.status) && (
                <Button disabled={busy} onClick={() => save('draft')}>
                  Save draft
                </Button>
              )}
              <Button
                variant="fine"
                disabled={busy || platforms.length === 0 || !draft.scheduledAtUtc}
                onClick={() => save('scheduled')}
                title={COPY.scheduleTooltip(
                  platforms.map((p) => PLATFORM_LABELS[p]),
                  formatEastern(draft.scheduledAtUtc),
                )}
              >
                {COPY.publishButton}
              </Button>
            </>
          )}
        </div>
      </div>
      {confirm === 'cancel' && (
        <Confirm
          title="Cancel this post?"
          message={COPY.confirm.cancelPost}
          confirmLabel="Cancel post"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await run(() => api.posts.cancel([draft.id]))
            onClose()
          }}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          title="Delete this post?"
          message={COPY.confirm.deletePost}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          extra={
            <Check checked={alsoFile} onChange={setAlsoFile}>
              Also delete the video file
            </Check>
          }
          onConfirm={async () => {
            await run(() => api.posts.remove([draft.id], alsoFile))
            onClose()
          }}
        />
      )}
    </Dialog>
  )
}

const FC_LABEL: Record<string, string> = {
  waiting: 'Waiting to be posted',
  done: 'Posted',
  failed: 'Failed',
  skipped: 'Not sent',
}

/** One line under a platform: its first comment and how it went. */
function FirstCommentLine({
  target,
  fallback,
  onRetry,
}: {
  target: Post['targets'][number]
  fallback: string | null
  onRetry: () => void
}) {
  const fc = target.firstComment
  const planned = (target.settings.firstComment ?? fallback ?? '').trim()
  if (!fc && !planned) return null
  const text = fc?.text ?? planned
  return (
    <div className="mt-1 rounded bg-surface2 px-2 py-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        First comment{fc ? `: ${FC_LABEL[fc.status]}` : ''}
      </div>
      <div className="whitespace-pre-wrap text-ink">{text}</div>
      {fc?.error && (
        <div className={fc.status === 'failed' ? 'text-bad' : 'text-muted'}>{fc.error}</div>
      )}
      {fc && (fc.status === 'failed' || fc.status === 'skipped') && (
        <button className="mt-1 text-[12px] font-semibold text-accent" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
