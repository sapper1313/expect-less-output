export class SocialError extends Error {
  constructor(
    message: string,
    public kind: 'transient' | 'permanent',
    public retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'SocialError'
  }
}

/** Maps an HTTP answer to a transient or permanent problem with a plain message. */
export async function httpError(vendor: string, res: Response): Promise<SocialError> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 300)
  } catch {
    // ignore
  }
  const ra = Number(res.headers.get('retry-after'))
  if (res.status === 429 || res.status >= 500)
    return new SocialError(
      `${vendor} is busy or slow (HTTP ${res.status}). ${body}`.trim(),
      'transient',
      ra > 0 ? ra * 1000 : undefined,
    )
  if (res.status === 401 || res.status === 403)
    return new SocialError(
      `${vendor} refused the login or token (HTTP ${res.status}). Check the connection in Settings, under the Studio tab. ${body}`.trim(),
      'permanent',
    )
  return new SocialError(`${vendor} said no (HTTP ${res.status}). ${body}`.trim(), 'permanent')
}
