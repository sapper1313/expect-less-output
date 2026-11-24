import type { ProductInput } from '@shared/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, Field, Input } from '../ui'

const MAX = 5

/**
 * Up to five Amazon picks for a video. The same box on the manual New Post page; bot drops send the same fields.
 * Nobody types a link: ELO builds it from the ASIN and the channel's tracking id.
 */
export function AmazonProducts({
  brandId,
  value,
  onChange,
}: {
  brandId: number | null
  value: ProductInput[]
  onChange: (next: ProductInput[]) => void
}) {
  const { data: ch } = useLoad(() => (brandId ? api.amazon.channel(brandId) : Promise.resolve(null)), [brandId])
  const set = (i: number, patch: Partial<ProductInput>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Amazon picks (optional)</div>
      <p className="mb-2 text-[12px] text-muted">
        Up to {MAX}. Type the ASIN, a short name and one plain sentence. ELO makes the link, the list page on the website
        and the lines in the description.
      </p>
      {value.length > 0 && ch?.blocked && (
        <p className="mb-2 rounded-md border border-line px-3 py-2 text-[12px] text-muted">
          Saved, but the list will wait: {ch.blocked} The post still goes out.
        </p>
      )}
      <div className="grid gap-3">
        {value.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-3 md:grid-cols-[130px_1fr_2fr_auto]">
            <Field label="ASIN">
              <Input
                value={p.asin}
                maxLength={10}
                onChange={(e) => set(i, { asin: e.target.value.toUpperCase() })}
                placeholder="B000000000"
              />
            </Field>
            <Field label="Name">
              <Input value={p.name} maxLength={70} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label="Why it is in this video">
              <Input value={p.note} maxLength={240} onChange={(e) => set(i, { note: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      {value.length < MAX && (
        <button
          className="mt-2 text-[12px] font-semibold text-accent"
          onClick={() => onChange([...value, { asin: '', name: '', note: '' }])}
        >
          + Add a pick
        </button>
      )}
    </div>
  )
}
