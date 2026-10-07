import { useEffect, useState } from 'react'
import { COPY } from '@shared/copy'
import { api } from './api'
import { AppProvider, useLoad } from './hooks'
import { Toasts } from './ui'
import { Calendar } from './screens/Calendar'
import { Queue } from './screens/Queue'
import { NewPost } from './screens/NewPost'
import { Bulk } from './screens/Bulk'
import { Brands } from './screens/Brands'
import { About, Activity, SettingsScreen } from './screens/Simple'
import { Connections } from './screens/Connections'
import { TikTokDemo } from './screens/TikTokDemo'
import logoWide from './assets/logo-wide.png'

type Screen =
  | 'tiktokDemo'
  | 'calendar'
  | 'queue'
  | 'newPost'
  | 'bulk'
  | 'brands'
  | 'connections'
  | 'activity'
  | 'settings'
  | 'about'
const SHORTCUTS: Partial<Record<Screen, string>> = {
  newPost: '⌘N',
  bulk: '⇧⌘N',
  calendar: '⌘1',
  queue: '⌘2',
}
const NAV: Screen[] = [
  'calendar',
  'queue',
  'newPost',
  'bulk',
  'brands',
  'connections',
  'activity',
  'settings',
]

function Shell() {
  const [screen, setScreenRaw] = useState<Screen>('calendar')
  const [newPostKey, setNewPostKey] = useState(0)
  const setScreen = (s: Screen) => {
    if (s === 'newPost' && screen !== 'newPost') setNewPostKey((k) => k + 1)
    setScreenRaw(s)
  }
  const { data: settings } = useLoad(() => api.settings.get())
  const { data: status } = useLoad(() => api.scheduler.status())
  const { data: meta } = useLoad(() => api.meta.status())
  const { data: report } = useLoad(() => api.backup.report())

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
      if (k === 'n' && !e.shiftKey) {
        e.preventDefault()
        setNewPostKey((n) => n + 1)
        setScreenRaw('newPost')
      } else if (k === 'n' && e.shiftKey) {
        e.preventDefault()
        setScreenRaw('bulk')
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
        <nav className="no-drag flex-1 space-y-0.5 px-3">
          {NAV.map((s) => (
            <button
              key={s}
              onClick={() => setScreen(s)}
              className={`w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold ${screen === s ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
            >
              <span className="flex items-center justify-between">
                {COPY.nav[s]}
                {SHORTCUTS[s] && (
                  <span className="text-[11px] font-normal opacity-60">{SHORTCUTS[s]}</span>
                )}
              </span>
            </button>
          ))}
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
        {screen === 'calendar' && <Calendar />}
        {screen === 'queue' && <Queue />}
        {screen === 'newPost' && <NewPost key={newPostKey} onDone={() => setScreen('calendar')} />}
        {screen === 'bulk' && <Bulk onDone={() => setScreen('calendar')} />}
        {screen === 'brands' && <Brands />}
        {screen === 'connections' && <Connections />}
        {screen === 'activity' && <Activity />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'about' && <About />}
        {screen === 'tiktokDemo' && <TikTokDemo onExit={() => setScreenRaw('connections')} />}
      </main>
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
