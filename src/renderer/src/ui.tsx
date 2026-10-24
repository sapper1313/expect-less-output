import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import type { CounterInfo, Platform } from '@shared/platformLimits'
import type { PostStatus, TargetStatus } from '@shared/types'
import { useApp } from './hooks'

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ')

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'fine' | 'primary' | 'secondary' | 'danger' | 'ghost'
}
export function Button({ variant = 'secondary', className, ...p }: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed no-drag'
  const styles = {
    fine: 'bg-fine text-[#111] hover:brightness-110 px-6 py-2.5 text-[15px]',
    primary: 'bg-accent text-[#111] hover:brightness-110',
    secondary: 'bg-surface2 text-ink border border-line hover:brightness-110',
    danger: 'bg-transparent text-bad border border-bad hover:bg-bad/10',
    ghost: 'bg-transparent text-muted hover:text-ink',
  }[variant]
  return <button {...p} className={cx(base, styles, className)} />
}

const field =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-accent'
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(field, p.className)} />
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(field, 'min-h-[84px] resize-y', p.className)} />
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, p.className)} />
}

const to12 = (h24: number) => (h24 % 12 === 0 ? 12 : h24 % 12)
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Pick a time of day with three drop-downs (hour, minute, AM or PM) instead of typing it.
 * The value is 24 hour "HH:MM", the same as a time input, so it can replace one directly.
 */
export function TimeSelect({
  value,
  onChange,
  step = 5,
  disabled,
  label = 'Time',
  className,
}: {
  value: string
  onChange: (v: string) => void
  step?: number
  disabled?: boolean
  label?: string
  className?: string
}) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  const h24 = m ? Number(m[1]) % 24 : 12
  const min = m ? Number(m[2]) : 0
  const pm = h24 >= 12
  const emit = (hour12: number, minute: number, isPm: boolean) =>
    onChange(`${pad((hour12 % 12) + (isPm ? 12 : 0))}:${pad(minute)}`)
  // A minute that is not on the step (an older saved time) stays selectable.
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step)
  if (!minutes.includes(min)) {
    minutes.push(min)
    minutes.sort((a, b) => a - b)
  }
  const cell = 'w-auto min-w-[72px] px-2'
  return (
    <div
      className={cx('inline-flex items-center gap-1.5', className)}
      role="group"
      aria-label={label}
    >
      <Select
        className={cell}
        aria-label={`${label}, hour`}
        disabled={disabled}
        value={to12(h24)}
        onChange={(e) => emit(Number(e.target.value), min, pm)}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
      <span className="text-muted">:</span>
      <Select
        className={cell}
        aria-label={`${label}, minute`}
        disabled={disabled}
        value={min}
        onChange={(e) => emit(to12(h24), Number(e.target.value), pm)}
      >
        {minutes.map((x) => (
          <option key={x} value={x}>
            {pad(x)}
          </option>
        ))}
      </Select>
      <Select
        className={cell}
        aria-label={`${label}, AM or PM`}
        disabled={disabled}
        value={pm ? 'PM' : 'AM'}
        onChange={(e) => emit(to12(h24), min, e.target.value === 'PM')}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </Select>
    </div>
  )
}

/**
 * Pick a date (calendar pop-up) and a time (drop-downs). The value is "yyyy-MM-ddTHH:mm", the same as a
 * datetime-local input, so it can replace one directly. Empty until a date is chosen.
 */
export function DateTimeSelect({
  value,
  onChange,
  step = 5,
  disabled,
  label = 'Date and time',
  className,
}: {
  value: string
  onChange: (v: string) => void
  step?: number
  disabled?: boolean
  label?: string
  className?: string
}) {
  const [d, t] = value ? value.split('T') : ['', '']
  const [time, setTime] = useState(t || '12:00')
  const shown = t || time
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <Input
        type="date"
        className="w-auto"
        aria-label={`${label}, date`}
        disabled={disabled}
        value={d}
        onChange={(e) => (e.target.value ? onChange(`${e.target.value}T${shown}`) : onChange(''))}
      />
      <TimeSelect
        value={shown}
        step={step}
        disabled={disabled}
        label={`${label}, time`}
        onChange={(v) => {
          setTime(v)
          if (d) onChange(`${d}T${v}`)
        }}
      />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

export function Check({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-[13px]', disabled && 'opacity-50')}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  )
}

export function Card({
  title,
  children,
  actions,
  className,
}: {
  title?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-xl">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="drag flex items-center justify-between px-8 pb-3 pt-7">
      <h1 className="text-4xl">{title}</h1>
      <div className="no-drag flex items-center gap-3">{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-10 text-center text-muted">
      {children}
    </div>
  )
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className={cx(
          'max-h-[90vh] w-full overflow-auto rounded-xl border border-line bg-bg p-6 shadow-2xl',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-3xl">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** Plain confirmation. No jokes on anything destructive. */
export function Confirm({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
  extra,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  extra?: ReactNode
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="mb-4 text-[14px] leading-relaxed">{message}</p>
      {extra}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Go back</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

const POST_STATUS_STYLE: Record<PostStatus, string> = {
  draft: 'bg-surface2 text-muted',
  scheduled: 'bg-accent/20 text-accent',
  in_progress: 'bg-hot/20 text-hot',
  partial: 'bg-warn/20 text-warn',
  posted: 'bg-ok/20 text-ok',
  failed: 'bg-bad/20 text-bad',
  missed: 'bg-bad/20 text-bad',
  canceled: 'bg-surface2 text-muted line-through',
}
export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cx(
        'rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        POST_STATUS_STYLE[status],
      )}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

const TARGET_STYLE: Record<TargetStatus, string> = {
  pending: 'border-line text-muted',
  handed_off: 'border-hot text-hot',
  uploading: 'border-hot text-hot',
  processing: 'border-hot text-hot',
  posted: 'border-ok text-ok',
  needs_action: 'border-warn text-warn',
  failed: 'border-bad text-bad',
  skipped: 'border-line text-muted line-through',
}
export const PLATFORM_SHORT: Record<Platform, string> = {
  youtube: 'YT',
  facebook: 'FB',
  instagram: 'IG',
  tiktok: 'TT',
  bluesky: 'BS',
  x: 'X',
  linkedin: 'LI',
  pinterest: 'PI',
  snapchat: 'SC',
}
export function TargetChip({
  platform,
  status,
  title,
}: {
  platform: Platform
  status: TargetStatus
  title?: string
}) {
  return (
    <span
      title={title ?? `${PLATFORM_LABELS[platform]}: ${status.replace('_', ' ')}`}
      className={cx('rounded border px-1.5 py-0.5 text-[10px] font-bold', TARGET_STYLE[status])}
    >
      {PLATFORM_SHORT[platform]}
    </span>
  )
}

/** A small tag that marks a short clip, so it is not mistaken for a full episode. */
export function ClipBadge() {
  return (
    <span className="ml-2 rounded border border-accent px-1 text-[10px] font-bold uppercase text-accent">
      Clip
    </span>
  )
}

export function BrandDot({ color, name }: { color: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-3 w-3 rounded-full border border-black/30" style={{ background: color }} />
      {name}
    </span>
  )
}

export function Counter({ c }: { c: CounterInfo }) {
  return (
    <span className={cx('text-[11px]', c.over ? 'font-bold text-bad' : 'text-muted')}>
      {c.label} {c.count}/{c.max}
    </span>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useApp()
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={cx(
            'cursor-pointer rounded-lg border bg-surface p-3 shadow-xl',
            t.kind === 'error' ? 'border-bad' : t.kind === 'success' ? 'border-ok' : 'border-line',
          )}
        >
          <div
            className={cx(
              'display text-xl',
              t.kind === 'error' && 'text-bad',
              t.kind === 'success' && 'text-ok',
            )}
          >
            {t.headline}
          </div>
          {t.detail && <div className="mt-1 text-[12px] leading-snug text-muted">{t.detail}</div>}
        </div>
      ))}
    </div>
  )
}

export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      toast({
        kind: 'error',
        headline: 'That did not work.',
        detail: String((e as Error).message ?? e).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          '',
        ),
      })
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return [busy, run]
}
