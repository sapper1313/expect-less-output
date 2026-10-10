import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchKind } from '@shared/search'
import { api } from '../api'

const KIND_LABEL: Record<SearchKind, string> = { episode: 'Episode', post: 'Post', idea: 'Idea', comment: 'Comment', bible: 'Bible', log: 'Log', page: 'Page' }

/** Command K: one box that finds anything in the app. */
export function SearchPalette({ onPick, onClose }: { onPick: (h: SearchHit) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      api.search.query(q).then((r) => {
        if (alive) {
          setHits(r)
          setSel(0)
        }
      })
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(hits.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter' && hits[sel]) onPick(hits[sel])
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="glass w-full max-w-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={key}
          placeholder="Search episodes, posts, ideas, comments, the bible, settings..."
          className="w-full bg-transparent px-5 py-4 text-[16px] outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto border-t border-white/10">
          {q.trim().length >= 2 && hits.length === 0 && <div className="p-5 text-[13px] glass-dim">Nothing found for "{q}".</div>}
          {q.trim().length < 2 && <div className="p-5 text-[13px] glass-dim">Type at least 2 letters. Try a channel name, an episode title, or "spend caps".</div>}
          {hits.map((h, i) => (
            <button
              key={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(h)}
              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left ${i === sel ? 'bg-white/15' : ''}`}
            >
              <span className="w-[74px] shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-center text-[10px] font-bold uppercase">{KIND_LABEL[h.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{h.title}</span>
                <span className="block truncate text-[11px] glass-dim">{h.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
