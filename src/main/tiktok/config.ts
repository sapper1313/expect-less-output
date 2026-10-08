export const TT_SECRET_KEY = 'tiktok.client_key'
export const TT_SECRET_SECRET = 'tiktok.client_secret'
export const TT_SECRET_REDIRECT = 'tiktok.redirect_uri'
export const ttTokensKey = (accountId: number) => `tiktok.tokens.${accountId}`

/** The page on the owner's website that bounces the login back to the app (SETUP_D). */
export const DEFAULT_REDIRECT_URI = 'https://expectlessmedia.com/oauth/tiktok/'
export const APP_CALLBACK_PREFIX = 'expectless://oauth/tiktok'

export const SCOPES_BASE = ['user.info.basic', 'video.upload']
export const SCOPE_PUBLISH = 'video.publish'
export const SCOPE_STATS = 'video.list'

/** Chunk rules from TikTok's media transfer guide. */
export const MIN_CHUNK = 5 * 1024 * 1024
export const MAX_CHUNK = 64 * 1024 * 1024
export const DEFAULT_CHUNK = 10 * 1024 * 1024
export const MAX_CHUNKS = 1000
export const MAX_FILE = 4 * 1024 * 1024 * 1024

export interface TikTokUrls {
  authorize: string
  api: string // no trailing slash
  isFake: boolean
}

/**
 * Real TikTok addresses. ELO_TIKTOK_BASE (for example http://127.0.0.1:5557) points everything at a
 * local fake server for tests. It is read from the environment only, never from the UI.
 */
export function tiktokUrls(env: NodeJS.ProcessEnv = process.env): TikTokUrls {
  const base = env['ELO_TIKTOK_BASE']
  if (base) {
    const b = base.replace(/\/$/, '')
    return { authorize: `${b}/v2/auth/authorize/`, api: b, isFake: true }
  }
  return {
    authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    api: 'https://open.tiktokapis.com',
    isFake: false,
  }
}

/**
 * Splits a file into the chunk plan TikTok expects. A file up to 64 MB goes up whole: chunk_size is the full
 * size and there is one chunk (a 14 MB video sent as one 10 MB chunk was refused as "chunk size invalid").
 * Bigger files use 5 to 64 MB chunks and the last chunk takes the remainder.
 */
export function planChunks(size: number): { chunkSize: number; count: number } {
  if (size <= 0) throw new Error('The video file is empty.')
  if (size <= MAX_CHUNK) return { chunkSize: size, count: 1 }
  let chunk = DEFAULT_CHUNK
  while (Math.floor(size / chunk) > MAX_CHUNKS && chunk < MAX_CHUNK) chunk *= 2
  chunk = Math.min(chunk, MAX_CHUNK)
  return { chunkSize: chunk, count: Math.floor(size / chunk) }
}
