/** A table as CSV text that opens correctly in Excel and Numbers (quotes doubled, a byte order mark for accents). */
export function toCsv(
  columns: string[],
  rows: Array<Record<string, string | number | null | undefined>>,
): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return (
    '﻿' +
    [
      columns.map(cell).join(','),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(',')),
    ].join('\r\n') +
    '\r\n'
  )
}
