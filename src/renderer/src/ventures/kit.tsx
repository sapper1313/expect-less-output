import type { ReactNode } from 'react'
import { formatEastern } from '@shared/time'

/** Small building blocks for the ELS Ventures pages. Plain Tailwind so the phone page can use them too. */
export const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)

export const when = (iso: string) => formatEastern(iso, false)

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 ${className}`}>
      {title && <h2 className="mb-3 text-lg">{title}</h2>}
      {children}
    </section>
  )
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${active ? 'border-accent bg-accent text-[#111]' : 'border-line text-ink'}`}
    >
      {children}
    </button>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-muted">{children}</div>
}

export function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} out of 5 stars`} className="tracking-wider text-warn">
      {'★'.repeat(n)}
      <span className="text-muted">{'★'.repeat(Math.max(0, 5 - n))}</span>
    </span>
  )
}

export function LinkOut({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="font-semibold text-accent underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
