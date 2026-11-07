import { useEffect, useRef } from 'react'
import { api } from '../api'
import { mountDashboard } from '../dashboard/dashboardView'
import pageHtml from '../dashboard/page.html?raw'
import pageCss from '../dashboard/dashboard.css?inline'

/** Where a click can send you. App.tsx maps older names to where things live now. */
export type GoTarget = {
  screen: string
  studioTab?: string
  channelsTab?: string
  settingsTab?: string
  statsTab?: string
}

/** What a tile on Home opens. */
const TILE_TARGET: Record<string, GoTarget> = {
  inbox: { screen: 'inbox' },
  schedule: { screen: 'schedule' },
  queue: { screen: 'queue' },
  stats: { screen: 'stats' },
  flagged: { screen: 'aiStudio', studioTab: 'flagged' },
}

/** Home: every number in one colorful place. Pipeline strip, last 7 days, best videos, channels, week map. Read only. */
export function Home({ go }: { go: (t: GoTarget) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const goRef = useRef(go)
  goRef.current = go

  useEffect(() => {
    const el = host.current
    if (!el) return
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${pageCss}</style>${pageHtml}`
    el.classList.add('loading')
    const stop = mountDashboard(
      root,
      (force?: boolean) => (force ? api.dashboard.refresh() : api.dashboard.snapshot()),
      () => api.home.summary(),
      (where) => goRef.current(TILE_TARGET[where] ?? { screen: 'home' }),
      (offset: number) => api.dashboard.week(offset),
    )
    return () => {
      stop?.()
      root.innerHTML = ''
    }
  }, [])

  return <div ref={host} className="min-h-full" />
}
