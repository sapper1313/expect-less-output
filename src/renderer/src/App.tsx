import { useEffect, useState } from 'react'
import { COPY } from '@shared/copy'
import { api } from './api'
import { AppProvider, useLoad } from './hooks'
import { Toasts } from './ui'
import { Calendar } from './screens/Calendar'
import { Queue } from './screens/Queue'
import { Stats, type AnalyticsTab } from './screens/Stats'
import { Studio, type Tab as StudioTab } from './screens/Studio'
import { Home, type GoTarget } from './screens/Home'
import { Channels, type ChannelsTab } from './screens/Channels'
import { PostDetail } from './components/ItemDetail'
import { PostEditor } from './components/PostEditor'
import { SearchPalette } from './components/SearchPalette'
import { EpisodePeek } from './screens/StudioLibrary'
import type { SearchHit } from '@shared/search'
import { Schedule, type ScheduleMode } from './screens/Schedule'
import { About, Activity, SettingsScreen, type SettingsTab } from './screens/Simple'
import { TikTokDemo } from './screens/TikTokDemo'
import logoWide from './assets/logo-wide.png'

type Screen =
  | 'home'
  | 'channels'
  | 'tiktokDemo'
  | 'calendar'
  | 'queue'
  | 'stats'
  | 'studio'
  | 'schedule'
  | 'activity'
  | 'settings'
  | 'about'
const SHORTCUTS: Partial<Record<Screen, string>> = {
  schedule: '⌘N',
  home: '⌘0',
  calendar: '⌘1',
  queue: '⌘2',
}
/** The menu follows the work: see how things are, create and schedule, make with the Studio, check results, set up. */
const NAV_GROUPS: Array<{ label: string; items: Screen[] }> = [
  { label: '', items: ['home'] },
  { label: 'Create and schedule', items: ['schedule', 'calendar', 'queue'] },
  { label: 'Make', items: ['studio'] },
  { label: 'Results', items: ['stats'] },
  { label: 'Set up', items: ['channels', 'settings'] },
  { label: 'Records', items: ['activity'] },
]

function Shell() {
  const [screen, setScreenRaw] = useState<Screen>('home')
  const [studioTab, setStudioTab] = useState<StudioTab>('overview')
  const [channelsTab, setChannelsTab] = useState<ChannelsTab>('setup')
  const [studioKey, setStudioKey] = useState(0)
  const [detailPost, setDetailPost] = useState<number | null>(null)
  const [editPost, setEditPost] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [peekEpisode, setPeekEpisode] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [statsTab, setStatsTab] = useState<AnalyticsTab>('numbers')
  const [scheduleKey, setScheduleKey] = useState(0)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('one')
  const [scheduleWhen, setScheduleWhen] = useState<string | null>(null)
  /** Opens the Schedule screen fresh, optionally on a time (from the calendar). */
  const openSchedule = (mode: ScheduleMode = 'one', when: string | null = null) => {
    setScheduleMode(mode)
    setScheduleWhen(when)
    setScheduleKey((k) => k + 1)
    setScreenRaw('schedule')
  }
  const setScreen = (s: Screen | 'connections' | 'brands' | 'newPost' | 'bulk') => {
    if (s === 'connections' || s === 'brands') {
      setChannelsTab(s === 'connections' ? 'connections' : 'setup')
      setScreenRaw('channels')
      return
    }
    if (s === 'newPost' || s === 'bulk') return openSchedule(s === 'bulk' ? 'many' : 'one')
    if (s === 'schedule' && screen !== 'schedule') return openSchedule('one')
    setScreenRaw(s)
  }
  const pick = (h: SearchHit) => {
    setSearching(false)
    const t = h.target
    if (t.settingsTab) setSettingsTab(t.settingsTab as SettingsTab)
    if (t.channelsTab) setChannelsTab(t.channelsTab as ChannelsTab)
    if (t.statsTab) setStatsTab(t.statsTab as AnalyticsTab)
    go({ screen: t.screen as GoTarget['screen'], studioTab: t.studioTab })
    if (t.episodeId) setPeekEpisode(t.episodeId)
    if (t.postId) setDetailPost(t.postId)
  }
  const go = (t: GoTarget) => {
    if (t.channelsTab) setChannelsTab(t.channelsTab as ChannelsTab)
    if (t.settingsTab) setSettingsTab(t.settingsTab as SettingsTab)
    if (t.statsTab) setStatsTab(t.statsTab as AnalyticsTab)
    if (t.screen === 'studio') {
      setStudioTab((t.studioTab as StudioTab) ?? 'overview')
      setStudioKey((k) => k + 1)
    }
    setScreen(t.screen)
  }
  const { data: settings } = useLoad(() => api.settings.get())
  const { data: status } = useLoad(() => api.scheduler.status())
  const { data: meta } = useLoad(() => api.meta.status())
  const { data: report } = useLoad(() => api.backup.report())
  const { data: studio } = useLoad(() => api.studio.overview())
  const { data: home } = useLoad(() => api.home.summary())
  const badge: Partial<Record<Screen, number>> = {
    studio: home?.badges.studio,
    queue: home?.badges.queue,
    channels: home?.badges.channels,
  }

  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const t = settings?.theme ?? 'dark'
      root.dataset.theme =
        t === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : t
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  // Keyboard shortcuts: Command+N new post, Shift+Command+N bulk upload, Command+1 calendar, Command+2 queue.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setSearching(true)
        return
      }
      if (k === 'n' && !e.shiftKey) {
        e.preventDefault()
        openSchedule('one')
      } else if (k === 'n' && e.shiftKey) {
        e.preventDefault()
        openSchedule('many')
      } else if (k === '0' && !e.shiftKey) {
        e.preventDefault()
        setScreenRaw('home')
      } else if (k === '1' && !e.shiftKey) {
        e.preventDefault()
        setScreenRaw('calendar')
      } else if (k === '2' && !e.shiftKey) {
        e.preventDefault()
        setScreenRaw('queue')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Hidden: Command+Shift+D opens the TikTok demo screen used to record the review video.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setScreenRaw('tiktokDemo')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="flex h-full">
      <aside className="drag flex w-[228px] shrink-0 flex-col border-r border-line bg-surface pt-9">
        <div className="no-drag px-4 pb-4">
          <img src={logoWide} alt="Expect Less Output" className="w-full" />
          <div className="mt-2 text-center text-[11px] font-semibold tracking-wide text-muted">
            {COPY.tagline}
          </div>
        </div>
        <button
          onClick={() => setSearching(true)}
          className="no-drag mx-3 mb-2 flex items-center justify-between rounded-md border border-line px-3 py-1.5 text-left text-[12px] text-muted hover:bg-surface2"
        >
          <span>Search everything</span>
          <span className="text-[11px] opacity-70">⌘K</span>
        </button>
        <nav className="no-drag flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV_GROUPS.flatMap((g) => [
            g.label ? (
              <div
                key={`h-${g.label}`}
                className="px-3 pb-0.5 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted"
              >
                {g.label}
              </div>
            ) : null,
            ...g.items.map((s) => (
              <button
                key={s}
                onClick={() => setScreen(s)}
                aria-current={screen === s ? 'page' : undefined}
                className={`w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold ${screen === s ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
              >
                <span className="flex items-center justify-between">
                  {COPY.nav[s]}
                  <span className="flex items-center gap-2">
                    {!!badge[s] && (
                      <span
                        title="Needs a look"
                        className="dot-pulse flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                      >
                        {badge[s]}
                      </span>
                    )}
                    {SHORTCUTS[s] && (
                      <span className="text-[11px] font-normal opacity-60">{SHORTCUTS[s]}</span>
                    )}
                  </span>
                </span>
              </button>
            )),
          ])}
        </nav>
        {meta?.connected && meta.expiringSoon && (
          <button
            onClick={() => setScreen('connections')}
            className="no-drag mx-3 mb-2 rounded-md border border-warn p-2 text-left text-[11px] font-semibold text-warn"
          >
            {meta.status === 'needs_reauth' || (meta.daysLeft !== null && meta.daysLeft < 0)
              ? 'Meta needs you to sign in again. Click to fix.'
              : `Meta login runs out in ${meta.daysLeft} day${meta.daysLeft === 1 ? '' : 's'}. Click to reconnect.`}
          </button>
        )}
        <div className="no-drag border-t border-line p-3 text-[11px] text-muted">
          {studio && (
            <button
              className={`mb-1 block w-full rounded-md border px-2 py-1 text-left text-[11px] font-semibold ${studio.paused ? 'border-warn text-warn' : 'border-line text-muted'}`}
              onClick={async () => {
                await api.studio.pauseAll(!studio.paused)
              }}
              title="Stops every studio agent from starting new work"
            >
              {studio.paused ? 'Studio paused. Click to resume.' : 'Pause everything'}
              {studio.mockMode ? ' (mock mode)' : ''}
            </button>
          )}
          <div className={status?.paused ? 'font-bold text-warn' : ''}>
            {status?.paused
              ? 'Scheduler paused'
              : `Scheduler running, ${status?.pendingCount ?? 0} waiting`}
          </div>
          <button className="mt-1 text-accent" onClick={() => setScreen('about')}>
            {COPY.nav.about}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {report && (
          <div className="mx-8 mt-3 flex items-center justify-between gap-4 rounded-md border border-warn p-3 text-[13px]">
            <div>
              <b>Restored from backup.</b>{' '}
              {report.accountsToReconnect.length
                ? `Reconnect these accounts: ${report.accountsToReconnect.map((a) => `${a.brandName} ${a.platform}`).join(', ')}.`
                : 'No accounts were connected.'}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                className="font-semibold text-accent"
                onClick={() => setScreen('connections')}
              >
                Go to Connections
              </button>
              <button className="text-muted" onClick={() => api.backup.dismissReport()}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        {screen === 'home' && <Home go={go} openPost={setDetailPost} />}
        {screen === 'calendar' && <Calendar onNewPost={(when) => openSchedule('one', when)} />}
        {screen === 'queue' && <Queue />}
        {screen === 'stats' && <Stats key={statsTab} initialTab={statsTab} />}
        {screen === 'studio' && <Studio key={studioKey} initialTab={studioTab} />}
        {screen === 'schedule' && (
          <Schedule
            key={scheduleKey}
            initialMode={scheduleMode}
            initialWhen={scheduleWhen}
            onDone={() => setScreen('calendar')}
          />
        )}
        {screen === 'channels' && <Channels key={channelsTab} initialTab={channelsTab} />}
        {screen === 'activity' && <Activity />}
        {screen === 'settings' && <SettingsScreen key={settingsTab} initialTab={settingsTab} />}
        {screen === 'about' && <About />}
        {screen === 'tiktokDemo' && <TikTokDemo onExit={() => setScreen('connections')} />}
      </main>
      {detailPost !== null && (
        <PostDetail
          postId={detailPost}
          onClose={() => setDetailPost(null)}
          onEdit={() => {
            setEditPost(detailPost)
            setDetailPost(null)
          }}
        />
      )}
      {editPost !== null && <PostEditor postId={editPost} onClose={() => setEditPost(null)} />}
      {searching && <SearchPalette onPick={pick} onClose={() => setSearching(false)} />}
      {peekEpisode && <EpisodePeek id={peekEpisode} onClose={() => setPeekEpisode(null)} />}
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
