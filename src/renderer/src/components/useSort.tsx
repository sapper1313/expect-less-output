import { useMemo, useState } from 'react'

type SortDir = 'asc' | 'desc'
/** Click a heading to sort by it. Click again to flip. */
export function useSort<T>(rows: T[] | null | undefined, pick: Record<string, (r: T) => number | string>, first: string, o: { th?: string; btn?: string } = {}) {
  const [key, setKey] = useState(first)
  const [dir, setDir] = useState<SortDir>('desc')
  const sorted = useMemo(() => {
    const f = pick[key]
    if (!rows || !f) return rows
    return [...rows].sort((a, b) => {
      const x = f(a)
      const y = f(b)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return dir === 'asc' ? c : -c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir])
  const th = (k: string, label: string) => (
    <th className={o.th ?? 'p-2'}>
      <button
        type="button"
        className={o.btn ?? 'font-bold uppercase tracking-wider hover:text-ink'}
        aria-label={`Sort by ${label}`}
        onClick={() => {
          if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc')
          else {
            setKey(k)
            setDir(k === 'title' || k === 'platform' || k === 'channel' || k === 'kind' ? 'asc' : 'desc')
          }
        }}
      >
        {label}
        {k === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  return { sorted, th }
}

