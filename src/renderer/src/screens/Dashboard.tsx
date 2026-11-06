import { useEffect, useRef } from 'react'
import { api } from '../api'
import { mountDashboard } from '../dashboard/dashboardView'
import pageHtml from '../dashboard/page.html?raw'
import pageCss from '../dashboard/dashboard.css?inline'

/** The As Expected. dashboard: the week at a glance, open slots, channel stats and top videos. Read only. */
export function Dashboard() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${pageCss}</style>${pageHtml}`
    el.classList.add('loading')
    const stop = mountDashboard(root, (force?: boolean) =>
      force ? api.dashboard.refresh() : api.dashboard.snapshot(),
    )
    return () => {
      stop?.()
      root.innerHTML = ''
    }
  }, [])

  return <div ref={host} className="min-h-full" />
}
