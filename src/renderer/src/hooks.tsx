import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
