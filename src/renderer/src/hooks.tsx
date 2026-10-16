import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { nextDraft, type DraftMemory } from '@shared/draftSync'
import type { AppEvent } from '@shared/types'

interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  headline: string
  detail?: string
}

interface Ctx {
  version: number
  toasts: ToastItem[]
  toast: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

const AppCtx = createContext<Ctx>({ version: 0, toasts: [], toast: () => {}, dismiss: () => {} })

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = next.current++
      setToasts((list) => [...list.slice(-3), { ...t, id }])
      setTimeout(() => dismiss(id), t.kind === 'error' ? 12000 : 5000)
    },
    [dismiss],
  )

  useEffect(
    () =>
      window.elo.on((e: AppEvent) => {
        if (e.type === 'changed') setVersion((v) => v + 1)
        if (e.type === 'toast' && e.toast) toast(e.toast)
      }),
    [toast],
  )

  return <AppCtx.Provider value={{ version, toasts, toast, dismiss }}>{children}</AppCtx.Provider>
}

export const useApp = () => useContext(AppCtx)

/** Loads data and reloads it whenever the main process says something changed. */
export function useLoad<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; reload: () => void; error: string | null } {
  const { version } = useApp()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetcher()
      .then((d) => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps])
  return { data, reload: () => setTick((t) => t + 1), error }
}

/**
 * Form state that survives the app's background reloads. The data behind a form is reloaded all the time (every
 * change anywhere in the app triggers it), so a form must not be reset to the saved copy while you are typing.
 * The draft follows the saved data only while you have not edited it, or when you switch to another record (`id`).
 */
export function useDraft<T>(fresh: T | null, id: number | string | null = null) {
  const mem = useRef<DraftMemory>({ id: null, json: '' })
  const [draft, setDraft] = useState<T | null>(null)
  const key = id === null ? null : typeof id === 'number' ? id : id.length
  const freshJson = fresh ? JSON.stringify(fresh) : ''
  useEffect(() => {
    const prev = mem.current
    mem.current = nextDraft(prev, key, fresh, null).memory
    setDraft((cur) => nextDraft(prev, key, fresh, cur).draft)
    // The saved data counts as changed only when its content changed, not when it was loaded again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshJson, key])
  const dirty = !!draft && JSON.stringify(draft) !== mem.current.json
  return { draft, setDraft, dirty }
}
