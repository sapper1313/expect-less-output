import { useMemo, useState } from 'react'
import { PLATFORM_LABELS, type Platform } from '@shared/platformLimits'
import { toCsv } from '@shared/csv'
import { formatEastern } from '@shared/time'
import type { AccountAudience, AccountStatRow } from '@shared/engage'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from '../components/StatsPanel'
import { useSort } from '../components/useSort'
import { ThemedHost } from '../components/ThemedHost'
import pageCss from '../dashboard/dashboard.css?inline'
import postedCss from '../dashboard/posted.css?inline'

const CSS = pageCss + postedCss + ':host{border-radius:22px;padding:20px;min-height:360px}'
const label = (p: string) => PLATFORM_LABELS[p as Platform] ?? p

/** The numbers every platform can give, in the order they are shown. Anything else Upload-Post sends is listed under Other. */
const MAIN: Array<[string, string]> = [
  ['followers', 'Followers'],
  ['views', 'Views'],
  ['impressions', 'Impressions'],
  ['reach', 'Reach'],
  ['profileViews', 'Profile views'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['saves', 'Saves'],
  ['video_count', 'Videos'],
  ['following', 'Following'],
]
const KNOWN = new Set(MAIN.map(([k]) => k))
const nice = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')

function Spark({ pts }: { pts: Array<{ value: number }> }) {
  if (pts.length < 2) return <span className="muted small">-</span>
  const max = Math.max(...pts.map((p) => p.value), 1)
  const min = Math.min(...pts.map((p) => p.value), 0)
  const span = max - min || 1
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * 90},${24 - ((p.value - min) / span) * 22 - 1}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 90 26" role="img" aria-label="Reach per day">
      <polyline points={d} fill="none" stroke="var(--cyan)" strokeWidth="2" />
    </svg>
  )
}

function Delta({ now, before }: { now: number | undefined; before: number | undefined }) {
  if (now === undefined || before === undefined || now === before) return null
  const d = now - before
  return <span className={`delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '+' : ''}{fmt(d)}</span>
}

/** Account numbers for every channel and platform, and the TikTok audience, read through Upload-Post. */
export function AccountStats() {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [platform, setPlatform] = useState('')
  const { data, reload } = useLoad(() => api.uploadPost.accountStats())

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((r) => (brandId ? r.brandId === brandId : true)).filter((r) => (platform ? r.platform === platform : true)),
    [data, brandId, platform],
  )
  const num = (r: AccountStatRow, k: string) => r.numbers[k] ?? -1
  const { sorted, th } = useSort(
    rows,
    {
      channel: (r) => r.brandName.toLowerCase(),
      platform: (r) => label(r.platform),
      followers: (r) => num(r, 'followers'),
      views: (r) => num(r, 'views'),
      impressions: (r) => num(r, 'impressions'),
      reach: (r) => num(r, 'reach'),
      profileViews: (r) => num(r, 'profileViews'),
      likes: (r) => num(r, 'likes'),
      comments: (r) => num(r, 'comments'),
      shares: (r) => num(r, 'shares'),
      saves: (r) => num(r, 'saves'),
      video_count: (r) => num(r, 'video_count'),
      following: (r) => num(r, 'following'),
      watch: (r) => r.watchMinutes ?? -1,
      read: (r) => r.fetchedAtUtc,
    },
    'channel',
    { th: 'thc', btn: 'thbtn' },
  )
  const platforms = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.platform))], [data])
  const channels = useMemo(() => [...new Map((data?.rows ?? []).map((r) => [r.brandId, r.brandName])).entries()], [data])
  const audience = (data?.audience ?? []).filter((a) => (brandId ? a.brandId === brandId : true))

  const refresh = async () => {
    setBusy(true)
    try {
      const r = await api.uploadPost.refreshAccountStats()
      reload()
      toast({
        kind: r.problems.length ? 'error' : 'success',
        headline: r.problems.length ? 'Some numbers could not be read.' : 'Numbers read.',
        detail: r.problems.length ? r.problems.join(' ') : `${r.platforms} platforms across ${r.channels} channels.`,
      })
    } catch (e) {
      toast({ kind: 'error', headline: 'That did not work.', detail: String((e as Error).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    const out = (sorted ?? []).map((r) => {
      const row: Record<string, string | number | null> = { Channel: r.brandName, Platform: label(r.platform) }
      for (const [k, name] of MAIN) row[name] = r.numbers[k] ?? null
      row['Watch hours'] = r.watchMinutes === null ? null : Math.round((r.watchMinutes / 60) * 10) / 10
      for (const [k, v] of Object.entries(r.numbers)) if (!KNOWN.has(k)) row[nice(k)] = v
      row['Read (Eastern)'] = formatEastern(r.fetchedAtUtc, false)
      row['Problem'] = r.error
      return row
    })
    const heads = [...new Set(out.flatMap((r) => Object.keys(r)))]
    const path = await api.media.saveCsv(`ELO account numbers ${new Date().toISOString().slice(0, 10)}.csv`, toCsv(heads, out))
    if (path) toast({ kind: 'success', headline: 'Saved.', detail: path })
  }

  return (
    <ThemedHost css={CSS}>
      <div className="page" style={{ padding: 0 }}>
        <p className="sub">
          Followers, views, impressions and every other number each platform gives through Upload-Post, for every
          channel and platform ticked on the Upload-Post card in AI Settings. They are read about once an hour. Some
          platforms report all time and others the last 28 or 30 days, so compare a platform with itself, not with
          another one. The change next to followers is since a week ago. Click a heading to sort.
        </p>
        <section className="glass filters" style={{ marginTop: 14 }}>
          <select className="f" aria-label="Channel" value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All channels</option>
            {channels.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select className="f" aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
          </select>
          <button type="button" className="btn glass sm" disabled={busy} onClick={refresh}>
            {busy ? 'Reading' : 'Read from Upload-Post now'}
          </button>
          <button type="button" className="btn glass sm" disabled={!sorted?.length} onClick={exportCsv}>
            Export CSV
          </button>
        </section>

        {data?.nothingTicked && (
          <div className="glass card muted">
            No channel has a platform ticked on the Upload-Post card in AI Settings yet. Tick the platforms you logged in
            on Upload-Post and these numbers appear within the hour.
          </div>
        )}
        {data && !data.nothingTicked && rows.length === 0 && (
          <div className="glass card muted">Nothing read yet. Click Read from Upload-Post now.</div>
        )}

        {rows.length > 0 && (
          <section className="glass tbl-card scroll-x">
            <table className="tbl" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  {th('channel', 'Channel')}
                  {th('platform', 'Platform')}
                  {th('followers', 'Followers')}
                  {th('views', 'Views')}
                  {th('impressions', 'Impressions')}
                  {th('reach', 'Reach')}
                  {th('profileViews', 'Profile views')}
                  {th('likes', 'Likes')}
                  {th('comments', 'Comments')}
                  {th('shares', 'Shares')}
                  {th('saves', 'Saves')}
                  {th('video_count', 'Videos')}
                  {th('watch', 'Watch hours')}
                  <th className="thc"><span className="thbtn">Reach, 30 days</span></th>
                  <th className="thc"><span className="thbtn">Other numbers</span></th>
                  {th('read', 'Read')}
                </tr>
              </thead>
              <tbody>
                {sorted?.map((r) => (
                  <tr key={`${r.brandId}-${r.platform}`} className="vrow">
                    <td>
                      <span className="who2"><span className="dot" style={{ background: r.brandColor }} />{r.brandName}</span>
                    </td>
                    <td><span className="pchip">{label(r.platform)}</span></td>
                    {r.error ? (
                      <td colSpan={13} className="errcell">{r.error}</td>
                    ) : (
                      <>
                        <td className="num">{fmt(r.numbers.followers)}<Delta now={r.numbers.followers} before={r.before?.followers} /></td>
                        <td className="num">{fmt(r.numbers.views)}</td>
                        <td className="num">{fmt(r.numbers.impressions)}</td>
                        <td className="num">{fmt(r.numbers.reach)}</td>
                        <td className="num">{fmt(r.numbers.profileViews)}</td>
                        <td className="num">{fmt(r.numbers.likes)}</td>
                        <td className="num">{fmt(r.numbers.comments)}</td>
                        <td className="num">{fmt(r.numbers.shares)}</td>
                        <td className="num">{fmt(r.numbers.saves)}</td>
                        <td className="num">{fmt(r.numbers.video_count)}</td>
                        <td className="num">{r.watchMinutes === null ? '-' : fmt(Math.round((r.watchMinutes / 60) * 10) / 10)}</td>
                        <td><Spark pts={r.series} /></td>
                        <td>
                          <div className="others">
                            {Object.entries(r.numbers)
                              .filter(([k]) => !KNOWN.has(k))
                              .map(([k, v]) => (
                                <span key={k}>{nice(k)}: {fmt(v)}</span>
                              ))}
                          </div>
                        </td>
                      </>
                    )}
                    <td className="whenc">{formatEastern(r.fetchedAtUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {audience.length > 0 && (
          <>
            <div className="lab section-lab">Audience</div>
            {audience.map((a) => (
              <AudienceCard key={`${a.brandId}-${a.platform}`} a={a} />
            ))}
          </>
        )}
      </div>
    </ThemedHost>
  )
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

function Bars({ title, items }: { title: string; items: Array<{ name: string; value: number }> }) {
  if (!items.length) return null
  return (
    <div>
      <div className="lab aud-h">{title}</div>
      {items.slice(0, 6).map((i) => (
        <div key={i.name} className="bar-row">
          <span>{i.name}</span>
          <span className="tr"><span className="fl" style={{ display: 'block', width: `${Math.min(100, i.value * 100)}%` }} /></span>
          <span className="pc">{pct(i.value)}</span>
        </div>
      ))}
    </div>
  )
}

function AudienceCard({ a }: { a: AccountAudience }) {
  const d = a.data
  const aud = d.audience ?? {}
  const hours = d.activity_by_hour ?? []
  const maxH = Math.max(...hours.map((h) => h.followers_online), 1)
  const best = hours.reduce<{ hour: string; followers_online: number } | null>((m, h) => (!m || h.followers_online > m.followers_online ? h : m), null)
  const daily = (d.followers_daily ?? []).slice(-14)
  const actions = Object.entries(d.profile_actions ?? {}).filter(([, v]) => v !== null && v !== undefined)
  const hourName = (h: string) => {
    const n = Number(h)
    return `${n % 12 === 0 ? 12 : n % 12} ${n < 12 ? 'AM' : 'PM'}`
  }
  return (
    <section className="glass card" style={{ marginBottom: 16 }}>
      <div className="row-between wrap">
        <div className="lab">{a.brandName}, {label(a.platform)} audience</div>
        <span className="muted small">
          {d.range ? `${d.range.start_date} to ${d.range.end_date}. ` : ''}Read {formatEastern(a.fetchedAtUtc)}
        </span>
      </div>
      <div className="aud-grid">
        <Bars title="Countries" items={(aud.countries ?? []).map((c) => ({ name: c.country, value: c.percentage }))} />
        <Bars title="Cities" items={(aud.cities ?? []).map((c) => ({ name: c.city, value: c.percentage }))} />
        <Bars title="Ages" items={(aud.ages ?? []).map((c) => ({ name: c.age, value: c.percentage }))} />
        <Bars title="Gender" items={(aud.genders ?? []).map((c) => ({ name: c.gender, value: c.percentage }))} />
        {hours.length > 0 && (
          <div>
            <div className="lab aud-h">When followers are online{best ? `, best ${hourName(best.hour)}` : ''}</div>
            <div className="hours" role="img" aria-label="Followers online by hour">
              {hours.map((h) => (
                <div key={h.hour} className={`hb ${best && h.hour === best.hour ? 'best' : ''}`} style={{ height: `${(h.followers_online / maxH) * 100}%` }} title={`${hourName(h.hour)}: ${fmt(h.followers_online)}`} />
              ))}
            </div>
            <div className="hlab"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
          </div>
        )}
        {daily.length > 0 && (
          <div>
            <div className="lab aud-h">Followers per day</div>
            {daily.map((r) => (
              <div key={r.date} className="kv">
                <span>{r.date.slice(5)}</span>
                <b>{fmt(r.total)}{r.new ? ` +${fmt(r.new)}` : ''}{r.lost ? ` -${fmt(r.lost)}` : ''}</b>
              </div>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div>
            <div className="lab aud-h">Profile taps</div>
            {actions.map(([k, v]) => (
              <div key={k} className="kv"><span>{nice(k)}</span><b>{fmt(v as number)}</b></div>
            ))}
          </div>
        )}
      </div>
      {d.bio_description && <div className="note">Bio: {d.bio_description}</div>}
    </section>
  )
}
