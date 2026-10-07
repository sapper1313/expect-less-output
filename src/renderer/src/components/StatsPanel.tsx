import { PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { PostStats, StatsNumbers, TargetStats } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, useBusy } from '../ui'

export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n.toLocaleString('en-US')

/** A small line chart of views over time, drawn by hand so no chart library is needed. */
export function ViewsChart({ history }: { history: Array<StatsNumbers & { t: string }> }) {
  const pts = history
    .filter((h) => h.views !== null)
    .map((h) => ({ x: new Date(h.t).getTime(), y: h.views as number }))
  if (pts.length < 2)
    return <div className="text-[12px] text-muted">{COPY.stats.chartNeedsMore}</div>
  const W = 420
  const H = 110
  const pad = 6
  const minX = pts[0].x
  const maxX = pts[pts.length - 1].x
  const maxY = Math.max(...pts.map((p) => p.y), 1)
  const px = (x: number) => pad + ((x - minX) / Math.max(maxX - minX, 1)) * (W - pad * 2)
  const py = (y: number) => H - pad - (y / maxY) * (H - pad * 2)
  const d = pts
    .map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[420px]"
      role="img"
      aria-label={`Views over time, now ${fmt(pts[pts.length - 1].y)}`}
    >
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r={2.5} fill="var(--accent)" />
      ))}
      <text x={pad} y={12} fontSize={10} fill="var(--muted)">
        {fmt(maxY)}
      </text>
    </svg>
  )
}

function Row({ t }: { t: TargetStats }) {
  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <div className="flex items-center justify-between">
        <b>{PLATFORM_LABELS[t.platform]}</b>
        {t.latest && (
          <span className="text-[11px] text-muted">Read {formatEastern(t.latest.fetchedAt)}</span>
        )}
      </div>
      {t.state === 'ok' && t.latest ? (
        <>
          <div className="grid grid-cols-4 gap-2 text-center text-[13px]">
            {(['views', 'likes', 'comments', 'shares'] as const).map((k) => (
              <div key={k}>
                <div className="display text-2xl">
                  {fmt(t.latest![k])}
                  {t.latest!.approximate.includes(k) ? '~' : ''}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-muted">{k}</div>
              </div>
            ))}
          </div>
          {t.latest.approximate.length > 0 && (
            <div className="text-[11px] text-muted">{COPY.stats.approximate}</div>
          )}
          <ViewsChart history={t.history} />
        </>
      ) : (
        <div className="text-[13px] text-muted">
          {t.state === 'pending'
            ? COPY.stats.pending
            : `${COPY.stats.notAvailable}. ${t.reason ?? ''}`}
        </div>
      )}
    </div>
  )
}

/** The Stats section of the post editor. */
export function PostStatsPanel({ postId }: { postId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad<PostStats>(() => api.stats.post(postId), [postId])
  if (!data || data.targets.length === 0) return null
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex items-center justify-between">
        <div className="display text-xl">Stats</div>
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.stats.refresh(postId))
            reload()
            if (r)
              toast({
                kind: 'info',
                headline: COPY.stats.refreshed,
                detail: `${r.fetched} read, ${r.unavailable} not available.`,
              })
          }}
        >
          Refresh stats
        </Button>
      </div>
      {data.targets.map((t) => (
        <Row key={t.targetId} t={t} />
      ))}
    </div>
  )
}
