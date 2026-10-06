import { useEffect, useState } from 'react'
import { PLATFORM_LABELS, captionCounters } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern, isoToLocalInput, localInputToIso } from '@shared/time'
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
import { PlatformPicker } from './pickers'

export function PostEditor({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: post } = useLoad(() => api.posts.get(postId), [postId])
  const [draft, setDraft] = useState<Post | null>(null)
  const [platforms, setPlatforms] = useState<Post['targets'][number]['platform'][]>([])
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [alsoFile, setAlsoFile] = useState(false)

  useEffect(() => {
    if (post && (!draft || draft.id !== post.id)) {
      setDraft(post)
      setPlatforms(post.targets.filter((t) => t.status !== 'skipped').map((t) => t.platform))
    } else if (post && draft) {
      // keep local edits, but follow status and target changes coming from the scheduler
      setDraft((d) => (d ? { ...d, status: post.status, targets: post.targets } : d))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post])

  if (!draft) return null
  const locked = ['posted', 'in_progress'].includes(draft.status)
  const counters = captionCounters(draft.title, draft.caption)
  const failed = draft.targets.filter((t) => t.status === 'failed')
  const set = <K extends keyof Post>(k: K, v: Post[K]) => setDraft({ ...draft, [k]: v })

  async function save(status?: 'draft' | 'scheduled') {
    const existing = new Map(draft!.targets.map((t) => [t.platform, t]))
    const saved = await run(() =>
      api.posts.update(draft!.id, {
        title: draft!.title,
        caption: draft!.caption,
        scheduledAtUtc: draft!.scheduledAtUtc,
        status,
        targets: platforms.map((p) => ({
          platform: p,
          aiFlag: existing.get(p)?.aiFlag ?? false,
          captionOverride: existing.get(p)?.captionOverride ?? null,
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
                      t.lastError ?? 'Unknown error.',
                    )}
                  </span>
                  <Button disabled={busy} onClick={() => run(() => api.posts.retryTarget(t.id))}>
                    Retry
                  </Button>
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

          <Field label="Title">
            <Input
              value={draft.title}
              disabled={locked}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label="Caption">
            <Textarea
              rows={4}
              value={draft.caption}
              disabled={locked}
              onChange={(e) => set('caption', e.target.value)}
            />
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
            <Input
              type="datetime-local"
              step={60}
              disabled={locked}
              value={isoToLocalInput(draft.scheduledAtUtc)}
              onChange={(e) => set('scheduledAtUtc', localInputToIso(e.target.value))}
            />
          </Field>
          {draft.scheduledAtUtc && (
            <div className="-mt-3 text-[12px] text-muted">
              {formatEastern(draft.scheduledAtUtc)}
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
