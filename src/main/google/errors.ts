import { AdapterError } from '../adapters/types'

/** Turns a Google API failure into transient (retry) or permanent (stop and tell the owner). */
export function classifyGoogleError(status: number, reason: string, message: string): AdapterError {
  const r = reason.toLowerCase()
  if (
    r === 'quotaexceeded' ||
    r === 'dailylimitexceeded' ||
    r === 'ratelimitexceeded' ||
    r === 'uploadlimitexceeded'
  ) {
    return new AdapterError(
      `YouTube says the daily limit is used up (${reason}). It resets at midnight Pacific. Retry tomorrow.`,
      'permanent',
    )
  }
  if (r === 'youtubesignuprequired' || r === 'channelnotfound') {
    return new AdapterError(
      'This Google account has no YouTube channel. Reconnect with the right account.',
      'permanent',
    )
  }
  if (r === 'forbidden' || r === 'insufficientpermissions' || r === 'autherror') {
    return new AdapterError(
      `Google refused the request (${reason}). Reconnect YouTube and approve every permission.`,
      'permanent',
    )
  }
  if (status === 401)
    return new AdapterError('Google rejected the sign-in token. Trying again.', 'transient')
  if (status === 429 || status >= 500)
    return new AdapterError(`Google had a problem (${status}). ${message}`.trim(), 'transient')
  if (status >= 400 && status < 500) {
    return new AdapterError(
      `Google rejected the request (${status}${reason ? ', ' + reason : ''}). ${message}`.trim(),
      'permanent',
    )
  }
  return new AdapterError(message || 'Unknown Google error.', 'transient')
}

/** Network level failures (offline, reset, timeout) are always worth retrying. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; name?: string; message?: string }
  const code = e?.code ?? e?.cause?.code
  if (
    code &&
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR|ENETUNREACH|ECONNABORTED/.test(
      code,
    )
  )
    return true
  return e?.name === 'TypeError' && /fetch failed|terminated|network/i.test(e?.message ?? '')
}
