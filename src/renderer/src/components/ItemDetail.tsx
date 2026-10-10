import { useEffect } from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import { formatEastern } from '@shared/time'
import type { CalendarItem, CalendarKind } from '@shared/studio/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, StatusBadge, TargetChip } from '../ui'
import { PostStatsPanel } from './StatsPanel'
import { VideoPlayer } from './VideoPlayer'

const KIND_LABEL: Record<CalendarKind, string> = {
  posted: 'Posted',
  scheduled: 'Scheduled',
  in_production: 'In production',
  awaiting_video: 'Waiting for the video',
  flagged: 'Needs a look',
  failed: 'Failed',
  planned: 'Planned slot',
  production_window: 'Production window',
}

/** A large, readable pop-up for anything clicked on the calendar or the Home screen. */
function Big({ onClose, color, children }: { onClose: () => void; color?: string; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        className="glass max-h-[92vh] w-full max-w-3xl overflow-auto p-8"
        style={{ boxShadow: `var(--glass-shadow), 0 0 60px ${(color ?? '#ff6a13')}44` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function PostDetail({ postId, onClose, onEdit }: { postId: number; onClose: () => void; onEdit: () => void }) {
  const { data: post } = useLoad(() => api.posts.get(postId), [postId])
  if (!post) return null
  const bad = post.targets.filter((t) => t.status === 'failed' || t.status === 'needs_action')
  return (
    <Big onClose={onClose} color={post.brandColor}>
      <div className="flex items-start gap-5">
        {post.posterUrl && <img src={post.posterUrl} alt="" className="h-44 w-auto rounded-2xl object-cover shadow-xl" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[12px] glass-dim">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: post.brandColor }} />
            {post.brandName}
            <StatusBadge status={post.status} />
          </div>
          <h2 className="mt-2 text-[34px] leading-tight">{post.title || post.fileName}</h2>
          <div className="mt-2 text-[15px] font-semibold">{post.scheduledAtUtc ? formatEastern(post.scheduledAtUtc) : 'No time set'}</div>
        </div>
      </div>

      {post.videoPath && !post.videoPath.startsWith('/') && (
        <div className="mt-6">
          <VideoPlayer path={post.videoPath} poster={post.posterUrl} />
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 text-[12px] font-bold uppercase tracking-wide glass-dim">Posting to</div>
        <div className="grid gap-2 md:grid-cols-2">
          {post.targets.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
              <TargetChip platform={t.platform} status={t.status} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{PLATFORM_LABELS[t.platform]}</div>
                <div className="text-[12px] glass-dim">{t.status.replace('_', ' ')}{t.postedAtUtc ? ` · ${formatEastern(t.postedAtUtc, false)}` : ''}</div>
              </div>
              {t.externalUrl && (
                <a className="text-[12px] font-semibold underline" href={t.externalUrl} target="_blank" rel="noreferrer">Open</a>
              )}
            </div>
          ))}
        </div>
      </div>

      {bad.map((t) => t.lastError && (
        <div key={t.id} className="mt-3 rounded-2xl border border-red-400/60 bg-red-500/15 p-3 text-[13px]">
          <b>{PLATFORM_LABELS[t.platform]}:</b> {t.lastError}
        </div>
      ))}

      {post.caption && (
        <div className="mt-6">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide glass-dim">Caption</div>
          <div className="whitespace-pre-wrap rounded-2xl bg-white/10 p-4 text-[14px] leading-relaxed">{post.caption}</div>
        </div>
      )}

      {post.status === 'posted' && (
        <div className="mt-6">
          <PostStatsPanel postId={post.id} />
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={onEdit}>{post.status === 'posted' ? 'Open details and edit' : 'Edit this post'}</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Big>
  )
}

export function ItemDetail({ item, onClose, onOpenEpisode }: { item: CalendarItem; onClose: () => void; onOpenEpisode: () => void }) {
  return (
    <Big onClose={onClose} color={item.brandColor}>
      <div className="flex flex-wrap items-center gap-2 text-[12px] glass-dim">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.brandColor }} />
        {item.brandName}
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase">{KIND_LABEL[item.kind]}</span>
      </div>
      <h2 className="mt-2 text-[34px] leading-tight">{item.title}</h2>
      <div className="mt-2 text-[15px] font-semibold">{item.allDay ? item.date : formatEastern(item.startUtc)}</div>
      {item.platforms.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide glass-dim">Posting to</div>
          <div className="flex flex-wrap gap-2">
            {item.platforms.map((p) => (
              <span key={p} className="rounded-full bg-white/15 px-3 py-1.5 text-[14px] font-bold">{PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] ?? p}</span>
            ))}
          </div>
        </div>
      )}
      {item.kind === 'planned' && <p className="mt-5 text-[13px] glass-dim">This is an empty slot. The Director will fill it with an episode before the production window opens.</p>}
      {item.kind === 'production_window' && <p className="mt-5 text-[13px] glass-dim">Video making can run on this day for the episode that posts next.</p>}
      <div className="mt-6 flex gap-2">
        {item.episodeId && <Button variant="primary" onClick={onOpenEpisode}>Open the episode</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Big>
  )
}
