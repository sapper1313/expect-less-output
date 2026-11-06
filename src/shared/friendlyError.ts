/** Turns a raw error into plain words a person can act on. The raw text is never lost: callers keep it for the tooltip. */

const FIXES: Array<[RegExp, string]> = [
  [
    /not in the status to upload/i,
    'Instagram closed the earlier upload. Try again and ELO will start a fresh one.',
  ],
  [
    /request processing failed|ProcessingFailed/i,
    'Instagram could not process this video. Very large or very high quality files often fail this way. Try again, or use a smaller copy.',
  ],
  [/SQLITE_CONSTRAINT.*UNIQUE|UNIQUE constraint/i, 'That already exists, so it was not added again.'],
  [/SQLITE_BUSY|database is locked/i, 'ELO was busy for a moment. Try again.'],
  [
    /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|network (error|request failed)|socket hang up/i,
    'ELO could not reach the internet. Check the connection and try again.',
  ],
  [
    /invalid_grant|token (has )?expired|unauthorized|\b401\b|invalid (oauth )?access token|session has expired/i,
    'The login for this account ran out. Reconnect it in Setup Channels, then Connections.',
  ],
  [
    /quota|rate limit|too many requests|\b429\b/i,
    'The platform says it hit its daily limit. Wait a while and try again.',
  ],
]

/** Names like "ProcessingFailedError" or "TypeError" at the end or start are noise to a person. */
const NAME_NOISE = /\s*\(([A-Z][A-Za-z]+(Error|Exception))\)\s*$/
const JSON_BLOB = /\{[\s\S]*\}/

export function friendlyError(raw: unknown): string {
  let t = String((raw as { message?: string })?.message ?? raw ?? '').trim()
  if (!t) return 'Something went wrong. Try again.'
  t = t.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
  t = t.replace(/^(Type|Range|Syntax)?Error:\s*/, '')

  for (const [re, plain] of FIXES) if (re.test(t)) return withStep(t, plain)

  // A JSON answer from a platform: keep only its message.
  const blob = t.match(JSON_BLOB)
  if (blob) {
    let msg = ''
    try {
      const j = JSON.parse(blob[0]) as { error?: { message?: string } | string; message?: string }
      msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')
    } catch {
      msg = ''
    }
    t = t.replace(JSON_BLOB, msg ? msg : '').trim()
  }
  t = t.replace(NAME_NOISE, '').trim()
  t = t.replace(/the Connections screen/gi, 'Setup Channels, then Connections')
  t = t.replace(/Meta rejected the request \(code (\d+)\)\.?\s*/i, 'Meta turned this down. ')
  t = withStep(t, t)
  t = t.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim()
  if (!t) return 'Something went wrong. Try again.'
  t = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(t) ? t : t + '.'
}

/** "Step: uploading the video to Instagram. Meta said X" becomes "While uploading the video to Instagram: X". */
function withStep(original: string, body: string): string {
  const m = original.match(/^Step:\s*([^.]+)\.\s*/i)
  if (!m) return body
  const rest = (body === original ? original.slice(m[0].length) : body).trim()
  const stepText = m[1].trim()
  return `While ${stepText}: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`
}
