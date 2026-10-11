import { createHash, createHmac } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import type { SecretStore } from '../../services/secrets'
import type { StudioConfigService } from '../configService'

export const R2_KEY_ID = 'r2.accessKeyId'
export const R2_SECRET = 'r2.secretAccessKey'

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest()

export interface SignInput {
  method: string
  /** Path starting with a slash, already URI encoded. */
  path: string
  query?: Record<string, string>
  /** Headers to sign. Names are lowercased. Must include host, x-amz-content-sha256 and x-amz-date. */
  headers: Record<string, string>
  payloadHash: string
  region: string
  service: string
  accessKey: string
  secretKey: string
  /** yyyymmddThhmmssZ */
  amzDate: string
}

/** AWS Signature Version 4. Checked against the vector in the AWS documentation (see tests). */
export function signV4(i: SignInput): { authorization: string; signedHeaders: string } {
  const names = Object.keys(i.headers)
    .map((h) => h.toLowerCase())
    .sort()
  const lower = Object.fromEntries(
    Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]),
  )
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('')
  const signedHeaders = names.join(';')
  const q = Object.entries(i.query ?? {})
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const canonical = [i.method, i.path, q, canonicalHeaders, signedHeaders, i.payloadHash].join('\n')
  const date = i.amzDate.slice(0, 8)
  const scope = `${date}/${i.region}/${i.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256(canonical)].join('\n')
  const kDate = hmac(`AWS4${i.secretKey}`, date)
  const kRegion = hmac(kDate, i.region)
  const kService = hmac(kRegion, i.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
  }
}

const amz = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

/**
 * A temporary public home for files a platform must download (an Instagram cover). Uses any S3 compatible
 * bucket, Cloudflare R2 in the setup guide. Files are deleted by the caller as soon as the platform has them.
 */
export class PublicHost {
  constructor(
    private cfg: StudioConfigService,
    private secrets: SecretStore,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  configured(): boolean {
    const h = this.cfg.get().publicHost
    return !!(
      h.endpoint &&
      h.bucket &&
      h.publicBase &&
      this.secrets.has(R2_KEY_ID) &&
      this.secrets.has(R2_SECRET)
    )
  }

  private async send(
    method: 'PUT' | 'DELETE' | 'GET',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const h = this.cfg.get().publicHost
    const url = new URL(h.endpoint)
    const path = `/${h.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amz(this.now()),
    }
    const { authorization } = signV4({
      method,
      path,
      headers,
      payloadHash: 'UNSIGNED-PAYLOAD',
      region: h.region || 'auto',
      service: 's3',
      accessKey: this.secrets.get(R2_KEY_ID) as string,
      secretKey: this.secrets.get(R2_SECRET) as string,
      amzDate: headers['x-amz-date'],
    })
    return this.fetchImpl(`${url.origin}${path}`, {
      method,
      headers: {
        ...headers,
        authorization,
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body: body as unknown as BodyInit,
      signal: AbortSignal.timeout(10 * 60_000),
    })
  }

  /** Uploads a file and returns its public address. */
  async upload(file: string, key?: string): Promise<{ url: string; key: string }> {
    if (!this.configured())
      throw new Error(
        'The public host is not set up. Add the Cloudflare R2 details in Settings, under the Studio tab.',
      )
    const k = key ?? `elo/${this.now()}-${basename(file)}`
    const size = statSync(file).size
    if (size > 1024 * 1024 * 1024) throw new Error('The file is bigger than 1 GB.')
    const type = /\.png$/i.test(file)
      ? 'image/png'
      : /\.jpe?g$/i.test(file)
        ? 'image/jpeg'
        : 'video/mp4'
    const res = await this.send('PUT', k, readFileSync(file), type)
    if (!res.ok) throw new Error(`The public host refused the upload (HTTP ${res.status}).`)
    const base = this.cfg.get().publicHost.publicBase.replace(/\/+$/, '')
    return { url: `${base}/${k}`, key: k }
  }

  async remove(key: string): Promise<void> {
    if (!this.configured()) return
    try {
      await this.send('DELETE', key)
    } catch {
      // The bucket has a lifecycle rule as a safety net.
    }
  }
}
