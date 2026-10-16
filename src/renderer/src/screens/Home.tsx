import type { ReactNode } from 'react'
import { formatEastern } from '@shared/time'
import type { HealthState, HomeChannel, HomePost, HomeStage } from '@shared/home'
import { api } from '../api'
import { useLoad } from '../hooks'

export type GoTarget = {
  screen: 'calendar' | 'queue' | 'studio' | 'channels' | 'newPost' | 'stats' | 'settings'
  studioTab?: string
}

const STAGE_COLOR: Record<HomeStage['key'], string> = {
  writing: '#8ab4ff',
  ready: '#b79bff',
  making: '#ffb454',
  scheduled: '#4fd1c5',
  posted: '#8fe388',
  flagged: '#ff6b6b',
}
const STATE_COLOR: Record<HealthState, string> = {
  ok: '#6ee7a0',
  warn: '#ffc857',
  bad: '#ff6b6b',
  none: '#9aa0a6',
}

function Ring({
  value,
  max,
  size = 84,
  color,
  children,
}: {
  value: number
  max: number
  size?: number
  color: string
  children?: ReactNode
}) {
  const r = size / 2 - 8
  const c = 2 * Math.PI * r
  const frac = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="8"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{
            transition: 'stroke-dasharray 700ms ease',
            filter: `drop-shadow(0 0 6px ${color})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
        {children}
      </div>
    </div>
  )
}

const num = (n: number | null) =>
  n === null ? 'n/a' : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n)

function Stat({ icon, value, label }: { icon: string; value: number | null; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-white/10 px-3 py-2">
      <span className="text-[11px] glass-dim">
        {icon} {label}
      </span>
      <b className="text-[18px]">{num(value)}</b>
    </div>
  )
}

function PostRow({ p, onClick }: { p: HomePost; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="glass-btn flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-left"
    >
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{p.title}</span>
        <span className="block text-[11px] glass-dim">
          {p.brandName} · {p.platforms.join(', ')}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] glass-dim">
        {p.whenUtc ? formatEastern(p.whenUtc, false) : 'No time'}
      </span>
    </button>
  )
}

function ChannelCard({ c, go }: { c: HomeChannel; go: (t: GoTarget) => void }) {
  const p = c.pipeline
  const pills: Array<[string, number, string]> = [
    ['Writing', p.writing, STAGE_COLOR.writing],
    ['Ready', p.ready, STAGE_COLOR.ready],
    ['Video', p.making, STAGE_COLOR.making],
    ['Scheduled', p.scheduled, STAGE_COLOR.scheduled],
    ['Flagged', p.flagged, STAGE_COLOR.flagged],
  ]
  return (
    <div className="glass p-5" style={{ boxShadow: `var(--glass-shadow), 0 0 40px ${c.color}33` }}>
      <div className="flex items-start gap-4">
        <Ring value={c.runwayDays} max={14} color={c.color}>
          <b className="text-[20px]">{c.runwayDays}</b>
          <span className="text-[9px] glass-dim">days ahead</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }}
            />
            <h3 className="truncate text-[17px] font-bold">{c.name}</h3>
            {c.paused && (
              <span className="rounded-full bg-amber-400/25 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                Paused
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] glass-dim">
            Next episode due {c.nextDue ?? 'when you turn on a schedule'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pills.map(([label, n, color]) => (
              <span
                key={label}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: n ? `${color}33` : 'rgba(255,255,255,0.06)',
                  color: n ? color : undefined,
                  opacity: n ? 1 : 0.55,
                }}
              >
                {n} {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {c.connections.map((x) => (
          <button
            key={x.label + x.note}
            title={x.note}
            onClick={() => go({ screen: 'channels' })}
            className="glass-btn flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold"
          >
            <span
              className={`h-2 w-2 rounded-full ${x.state === 'bad' ? 'dot-pulse' : ''}`}
              style={{
                background: STATE_COLOR[x.state],
                boxShadow: `0 0 8px ${STATE_COLOR[x.state]}`,
              }}
            />
            {x.label}
            {x.state !== 'ok' && <span className="glass-dim font-normal">{x.note}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl bg-black/15 p-3">
        {c.latest ? (
          <>
            <div className="text-[11px] glass-dim">
              {c.latest.existing ? 'Latest video' : 'Latest post'} ·{' '}
              {c.latest.postedAtUtc ? formatEastern(c.latest.postedAtUtc, false) : ''}
            </div>
            <div className="mb-2 truncate text-[13px] font-semibold">{c.latest.title}</div>
            <div className="grid grid-cols-4 gap-2">
              <Stat icon="👁" value={c.latest.views} label="views" />
              <Stat icon="♥" value={c.latest.likes} label="likes" />
              <Stat icon="💬" value={c.latest.comments} label="comments" />
              <Stat icon="↗" value={c.latest.shares} label="shares" />
            </div>
          </>
        ) : (
          <div className="text-[12px] glass-dim">Nothing posted yet.</div>
        )}
      </div>
    </div>
  )
}

export function Home({
  go,
  openPost,
}: {
  go: (t: GoTarget) => void
  openPost: (postId: number) => void
}) {
  const { data } = useLoad(() => api.home.summary())
  if (!data) return <div className="glass-stage h-full" />
  const total = Math.max(
    1,
    data.stages.reduce((n, s) => n + s.count, 0),
  )
  const spendColor =
    data.spend.percent === null
      ? '#8ab4ff'
      : data.spend.percent >= 80
        ? '#ff6b6b'
        : data.spend.percent >= 50
          ? '#ffc857'
          : '#6ee7a0'
  return (
    <div className="glass-stage h-full overflow-y-auto p-8 pt-12">
      <div className="mx-auto max-w-[1180px] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[34px] leading-none">Home</h1>
            <div className="mt-1 text-[13px] glass-dim">
              {formatEastern(data.generatedUtc)}
              {data.spend.mock ? ' · Mock mode: nothing real is spent' : ''}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="glass glass-sm glass-btn px-4 py-2 text-[13px] font-semibold"
              onClick={() => go({ screen: 'newPost' })}
            >
              ＋ New post
            </button>
            <button
              className="glass glass-sm glass-btn px-4 py-2 text-[13px] font-semibold"
              onClick={() => go({ screen: 'studio' })}
            >
              Open Studio
            </button>
          </div>
        </div>

        {data.needsYou.length > 0 && (
          <div
            className="glass p-4"
            style={{ boxShadow: 'var(--glass-shadow), 0 0 30px rgba(255,107,107,0.25)' }}
          >
            <div className="mb-2 flex items-center gap-2 text-[13px] font-bold">
              <span className="dot-pulse h-2.5 w-2.5 rounded-full bg-red-400" /> Needs you
            </div>
            <div className="flex flex-wrap gap-2">
              {data.needsYou.map((t) => (
                <button
                  key={t}
                  className="glass-btn rounded-full bg-white/10 px-3 py-1 text-[12px]"
                  onClick={() =>
                    go(
                      /studio/i.test(t)
                        ? { screen: 'studio', studioTab: 'flagged' }
                        : /post/i.test(t)
                          ? { screen: 'queue' }
                          : { screen: 'channels' },
                    )
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="glass p-5">
          <div className="mb-3 text-[13px] font-bold">Where everything is right now</div>
          <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-white/10">
            {data.stages.map((s) => (
              <div
                key={s.key}
                title={`${s.label}: ${s.count}`}
                style={{
                  width: `${(s.count / total) * 100}%`,
                  background: STAGE_COLOR[s.key],
                  transition: 'width 700ms ease',
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {data.stages.map((s) => (
              <button
                key={s.key}
                className="glass-btn rounded-2xl bg-white/8 p-3 text-left"
                style={{
                  background: `${STAGE_COLOR[s.key]}1f`,
                  border: `1px solid ${STAGE_COLOR[s.key]}55`,
                }}
                onClick={() =>
                  go(
                    s.key === 'flagged'
                      ? { screen: 'studio', studioTab: 'flagged' }
                      : s.key === 'scheduled' || s.key === 'posted'
                        ? { screen: 'calendar' }
                        : { screen: 'studio', studioTab: 'library' },
                  )
                }
              >
                <div
                  className="text-[30px] font-bold leading-none"
                  style={{ color: STAGE_COLOR[s.key] }}
                >
                  {s.count}
                </div>
                <div className="mt-1 text-[12px] font-semibold">{s.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              {data.channels.map((c) => (
                <ChannelCard key={c.brandId} c={c} go={go} />
              ))}
            </div>
          </div>
          <div className="space-y-5">
            <div className="glass flex items-center gap-4 p-5">
              <Ring
                value={data.spend.total}
                max={data.spend.capValue ?? Math.max(1, data.spend.total)}
                size={96}
                color={spendColor}
              >
                <b className="text-[17px]">${data.spend.total.toFixed(2)}</b>
                <span className="text-[9px] glass-dim">
                  {data.spend.percent === null ? 'no cap' : `${data.spend.percent}% of cap`}
                </span>
              </Ring>
              <div>
                <div className="text-[13px] font-bold">Spend in {data.spend.month}</div>
                <div className="text-[12px] glass-dim">
                  {data.spend.capValue === null
                    ? 'No spend cap is set.'
                    : `Cap $${data.spend.capValue}`}
                </div>
                <div className="text-[12px] glass-dim">
                  On pace for about ${data.spend.projected.toFixed(2)} this month
                </div>
                <button
                  className="mt-1 text-[12px] font-semibold underline"
                  onClick={() => go({ screen: 'studio', studioTab: 'spend' })}
                >
                  See the details
                </button>
              </div>
            </div>
            <div className="glass p-5">
              <div className="mb-3 flex items-center justify-between">
                <b className="text-[13px]">Coming up</b>
                <button
                  className="text-[12px] underline"
                  onClick={() => go({ screen: 'calendar' })}
                >
                  Calendar
                </button>
              </div>
              <div className="space-y-2">
                {data.upcoming.length ? (
                  data.upcoming.map((p) => (
                    <PostRow key={p.postId} p={p} onClick={() => openPost(p.postId)} />
                  ))
                ) : (
                  <div className="text-[12px] glass-dim">Nothing is scheduled.</div>
                )}
              </div>
            </div>
            <div className="glass p-5">
              <div className="mb-3">
                <b className="text-[13px]">Just posted</b>
              </div>
              <div className="space-y-2">
                {data.recent.length ? (
                  data.recent.map((p) => (
                    <PostRow key={p.postId} p={p} onClick={() => openPost(p.postId)} />
                  ))
                ) : (
                  <div className="text-[12px] glass-dim">Nothing has posted yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
