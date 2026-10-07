import { useState } from 'react'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, useBusy } from '../ui'

/**
 * A Suggest button for a title, caption or hashtags. It is hidden while text assist is off.
 * Clicking shows a few ideas from the local model. Click one to use it.
 */
export function Suggest({
  kind,
  brandId,
  title,
  caption,
  onPick,
}: {
  kind: 'title' | 'caption' | 'hashtags'
  brandId: number | null
  title: string
  caption: string
  onPick: (text: string) => void
}) {
  const { data: st } = useLoad(() => api.textAssist.status())
  const [busy, run] = useBusy()
  const [options, setOptions] = useState<string[] | null>(null)
  if (!st?.available || !brandId) return null
  const label =
    kind === 'title'
      ? 'Suggest titles'
      : kind === 'caption'
        ? 'Suggest captions'
        : 'Suggest hashtags'
  return (
    <div className="inline-block">
      <Button
        disabled={busy}
        onClick={async () => {
          const r = await run(() => api.textAssist.suggest(kind, brandId, title, caption))
          if (r) setOptions(r)
        }}
      >
        {busy ? 'Thinking...' : label}
      </Button>
      {options && (
        <div
          className="mt-2 w-full max-w-xl space-y-1 rounded-md border border-line bg-surface p-2"
          role="listbox"
          aria-label={label}
        >
          {options.length === 0 && (
            <div className="p-1 text-[12px] text-muted">The model gave no ideas. Try again.</div>
          )}
          {options.map((o, i) => (
            <button
              key={i}
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface2"
              onClick={() => {
                onPick(o)
                setOptions(null)
              }}
            >
              {o}
            </button>
          ))}
          <button className="px-2 text-[11px] text-muted" onClick={() => setOptions(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
