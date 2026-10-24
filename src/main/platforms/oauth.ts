import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import type { SecretStore } from '../services/secrets'

export interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  /** When the access token stops working (ms since 1970), or null when it never says. */
  expiresAt: number | null
  /** When the refresh token stops working, or null. */
  refreshExpiresAt?: number | null
}

/** What a platform hands back when a login is made or renewed. Times are seconds from now. */
export interface TokenGrant {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  refreshExpiresIn?: number | null
}

export function toStored(g: TokenGrant, nowMs: number, prev?: StoredTokens | null): StoredTokens {
  return {
    accessToken: g.accessToken,
    refreshToken: g.refreshToken ?? prev?.refreshToken ?? null,
    expiresAt: g.expiresIn ? nowMs + g.expiresIn * 1000 : null,
    refreshExpiresAt: g.refreshExpiresIn
      ? nowMs + g.refreshExpiresIn * 1000
      : (prev?.refreshExpiresAt ?? null),
  }
}

export const pkce = () => {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Logins live in the same encrypted store as the other secrets, one entry per account. */
export class PlatformTokens {
  constructor(private secrets: SecretStore) {}
  private key = (platform: string, accountId: number) => `${platform}.tokens.${accountId}`
  get(platform: string, accountId: number): StoredTokens | null {
    const raw = this.secrets.get(this.key(platform, accountId))
    if (!raw) return null
    try {
      return JSON.parse(raw) as StoredTokens
    } catch {
      return null
    }
  }
  set(platform: string, accountId: number, t: StoredTokens): void {
    this.secrets.set(this.key(platform, accountId), JSON.stringify(t))
  }
  delete(platform: string, accountId: number): void {
    this.secrets.delete(this.key(platform, accountId))
  }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:3rem;max-width:36rem"><h2>${title}</h2><p>${body}</p></body>`

/**
 * Waits for the browser to come back to http://127.0.0.1:<port>/callback after the owner approves. The port is fixed because
 * these platforms only accept a redirect address that was typed into their developer page.
 */
export function waitForCallback(o: {
  port: number
  state: string
  timeoutMs?: number
  /** Called once the server is listening, so the browser can be opened. */
  onReady: () => void | Promise<void>
}): { done: Promise<string>; cancel: () => void } {
  let cancel: () => void = () => {}
  const done = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${o.port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (err) {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            PAGE(
              'Not connected',
              `The platform said: ${url.searchParams.get('error_description') ?? err}. You can close this tab.`,
            ),
          )
        finish(new Error(`The platform said: ${url.searchParams.get('error_description') ?? err}`))
        return
      }
      if (!code || state !== o.state) {
        res
          .writeHead(400, { 'content-type': 'text/html' })
          .end(PAGE('Not connected', 'That sign-in did not match. Start again in ELO.'))
        return
      }
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(PAGE('Connected', 'You can close this tab and go back to Expect Less Output.'))
      finish(null, code)
    })
    const timer = setTimeout(
      () => finish(new Error('The sign-in took too long. Try Connect again.')),
      o.timeoutMs ?? 5 * 60_000,
    )
    function finish(err: Error | null, code?: string) {
      clearTimeout(timer)
      server.close()
      server.closeAllConnections?.()
      if (err) reject(err)
      else resolve(code as string)
    }
    cancel = () => finish(new Error('The sign-in was cancelled.'))
    server.on('error', (e: NodeJS.ErrnoException) =>
      finish(
        new Error(
          e.code === 'EADDRINUSE'
            ? `Port ${o.port} is already in use. Close the other sign-in window and try again.`
            : e.message,
        ),
      ),
    )
    server.listen(
      o.port,
      '127.0.0.1',
      () => void Promise.resolve(o.onReady()).catch((e) => finish(e as Error)),
    )
  })
  return { done, cancel: () => cancel() }
}
