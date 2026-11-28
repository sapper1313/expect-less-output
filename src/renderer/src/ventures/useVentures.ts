import { useEffect, useState } from 'react'
import type { Api } from '@shared/api'

/**
 * What the ELS Ventures pages read. The Mac passes `api.ventures`. The phone page passes a version that fetches
 * from the Mac over the secret link. Pages never know the difference, and the phone version has no way to write.
 */
export type VenturesData = Pick<
  Api['ventures'],
  'storefronts' | 'status' | 'dashboard' | 'listings' | 'listing' | 'orders' | 'reviews' | 'notifications'
> & {
  /** Missing on the phone. Pages hide the buttons that need it. */
  markRead?: Api['ventures']['markRead']
  syncNow?: Api['ventures']['syncNow']
}

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fn()
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
  }, [tick, ...deps])
  return { data, error, reload: () => setTick((t) => t + 1) }
}
