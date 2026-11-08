import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Draws its children inside a shadow page with the given CSS. This is how Home gets the dark glass look without the rest
 * of the app's styles leaking in. Dialogs should be rendered outside it, so they keep the app's own look.
 */
export function ThemedHost({ css, children }: { css: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${css}</style>`
    const m = document.createElement('div')
    root.appendChild(m)
    setMount(m)
    return () => {
      setMount(null)
      root.innerHTML = ''
    }
  }, [css])
  return <div ref={host} className="min-h-full">{mount && createPortal(children, mount)}</div>
}
