import { formatEastern } from '@shared/time'

export type AlertKind =
  'failure' | 'missed' | 'reauth' | 'expiry' | 'cap' | 'media_root' | 'other' | 'test'

export interface AlertItem {
  kind: AlertKind
  headline: string
  detail: string
  platform?: string
  brand?: string
  title?: string
  whenUtc?: string | null
  reason?: string
}

export const MAX_ALERT_CHARS = 300
const OPEN = 'Open Expect Less Output to retry.'

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 3)).trimEnd() + '...'
}

/**
 * One alert as a short message. A post that failed uses the exact format:
 * Could not post. Probably for the best. <platform>, <brand>, "<title>", <time ET>. Reason: <reason>. Open Expect Less Output to retry.
 */
export function formatAlert(a: AlertItem): string {
  if (a.kind === 'failure' && a.platform && a.brand && a.title) {
    const when = a.whenUtc ? `${formatEastern(a.whenUtc, false)} ET` : 'time unknown'
    const head = `${a.headline} ${a.platform}, ${a.brand}, "${a.title}", ${when}. Reason: `
    const tail = ` ${OPEN}`
    const room = MAX_ALERT_CHARS - head.length - tail.length - 1
    if (room < 12) {
      // A very long title: cut the title, keep the rest.
      const shortTitle = clip(a.title, 40)
      return clip(
        `${a.headline} ${a.platform}, ${a.brand}, "${shortTitle}", ${when}. Reason: ${clip(a.reason ?? a.detail, 60)}.${tail}`,
        MAX_ALERT_CHARS,
      )
    }
    const reason = clip((a.reason ?? a.detail).replace(/\.$/, ''), room)
    return `${head}${reason}.${tail}`
  }
  const base = `${a.headline} ${a.detail}`.replace(/\s+/g, ' ').trim()
  const full = `${base} Open Expect Less Output.`
  return full.length <= MAX_ALERT_CHARS
    ? full
    : `${clip(base, MAX_ALERT_CHARS - 26)} Open Expect Less Output.`
}

/** Several alerts as one message. Lists what fits and says how many more there are. */
export function formatBatch(items: AlertItem[], why: 'busy' | 'quiet'): string {
  if (items.length === 1) return formatAlert(items[0])
  const lead =
    why === 'quiet'
      ? `${items.length} alerts while you were away.`
      : `${items.length} alerts in a few minutes.`
  const tail = ' Open Expect Less Output.'
  const lines = items.map((a) => {
    if (a.platform && a.brand)
      return `${a.platform} ${a.brand}${a.title ? ` "${clip(a.title, 24)}"` : ''}`
    return clip(a.headline, 40)
  })
  let out = lead
  let shown = 0
  for (const line of lines) {
    const next = `${out} ${line};`
    const more = items.length - shown - 1
    const reserve = more > 0 ? ` and ${more} more.`.length : 0
    if (next.length + reserve + tail.length > MAX_ALERT_CHARS) break
    out = next
    shown++
  }
  if (shown < items.length) out += ` and ${items.length - shown} more.`
  return clip(out + tail, MAX_ALERT_CHARS)
}
