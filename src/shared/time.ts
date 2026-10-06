import { DateTime } from 'luxon'

export const ZONE = 'America/New_York'

export function nowUtcIso(): string {
  return new Date().toISOString()
}

export function toEastern(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE)
}

export function formatEastern(iso: string | null | undefined, withZone = true): string {
  if (!iso) return 'No time set'
  return toEastern(iso).toFormat(withZone ? "ccc LLL d, h:mm a 'ET'" : 'ccc LLL d, h:mm a')
}

/** Value for <input type="datetime-local"> in Eastern time. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return toEastern(iso).toFormat("yyyy-LL-dd'T'HH:mm")
}

/** Parse a datetime-local value as Eastern time and return UTC ISO. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const dt = DateTime.fromFormat(value, "yyyy-LL-dd'T'HH:mm", { zone: ZONE })
  return dt.isValid ? dt.toUTC().toISO() : null
}
