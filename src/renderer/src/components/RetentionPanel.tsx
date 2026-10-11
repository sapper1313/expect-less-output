import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, useBusy } from '../ui'

const mmss = (s: number | null) =>
  s === null ? 'n/a' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Watch time and a retention curve: how much of the audience is still watching at each point of the video. */
export function RetentionPanel({ postId }: { postId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.studio.retentionFor(postId), [postId])
  const load = () =>
    run(async () => {
      try {
        await api.studio.refreshRetention(postId)
        reload()
      } catch (e) {
        toast({
          kind: 'error',
          headline: 'Could not read watch time.',
          detail: (e as Error).message,
        })
      }
    })
  const W = 560
  const H = 140
  const pts = data?.curve ?? []
  const path = pts
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(p.t * W).toFixed(1)},${(H - (Math.min(1.2, p.watch) / 1.2) * H).toFixed(1)}`,
    )
    .join(' ')
  return (
    <div className="rounded-2xl bg-white/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <b className="text-[13px]">Watch time and retention (YouTube)</b>
        <Button disabled={busy} onClick={load}>
          {data ? 'Refresh' : 'Load watch time'}
        </Button>
      </div>
      {!data && (
        <div className="text-[12px] glass-dim">
          Press Load watch time to read it from YouTube. It is free and uses no YouTube points.
        </div>
      )}
      {data && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/10 p-2">
              <div className="text-[11px] glass-dim">Hours watched</div>
              <b className="text-[18px]">
                {data.minutesWatched === null ? 'n/a' : (data.minutesWatched / 60).toFixed(1)}
              </b>
            </div>
            <div className="rounded-xl bg-white/10 p-2">
              <div className="text-[11px] glass-dim">Average view</div>
              <b className="text-[18px]">{mmss(data.avgViewSeconds)}</b>
            </div>
            <div className="rounded-xl bg-white/10 p-2">
              <div className="text-[11px] glass-dim">Average watched</div>
              <b className="text-[18px]">
                {data.avgViewPercent === null ? 'n/a' : `${Math.round(data.avgViewPercent)}%`}
              </b>
            </div>
          </div>
          {pts.length > 1 ? (
            <div>
              <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full">
                {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                  <g key={g}>
                    <line
                      x1="0"
                      x2={W}
                      y1={H - (g / 1.2) * H}
                      y2={H - (g / 1.2) * H}
                      stroke="rgba(255,255,255,0.15)"
                    />
                    <text
                      x="2"
                      y={H - (g / 1.2) * H - 2}
                      fontSize="9"
                      fill="currentColor"
                      opacity="0.6"
                    >
                      {Math.round(g * 100)}%
                    </text>
                  </g>
                ))}
                <path d={`${path} L${W},${H} L0,${H} Z`} fill="rgba(79,209,197,0.22)" />
                <path
                  d={path}
                  fill="none"
                  stroke="#4fd1c5"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <text x="0" y={H + 14} fontSize="10" fill="currentColor" opacity="0.6">
                  Start
                </text>
                <text
                  x={W}
                  y={H + 14}
                  fontSize="10"
                  textAnchor="end"
                  fill="currentColor"
                  opacity="0.6"
                >
                  End of the video
                </text>
              </svg>
              <div className="text-[11px] glass-dim">
                The line shows how many viewers are still watching at each moment. A steep drop is
                where people leave.
              </div>
            </div>
          ) : (
            <div className="text-[12px] glass-dim">
              YouTube has not made a retention curve for this video yet. It needs some views first.
            </div>
          )}
          <div className="mt-2 text-[10px] glass-dim">
            Read {data.fetchedUtc.slice(0, 16).replace('T', ' ')} UTC
          </div>
        </>
      )}
    </div>
  )
}
