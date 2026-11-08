/** Upload-Post: a paid service that holds the logins and talks to TikTok (and later comments and stats). */

/** Every network Upload-Post can connect. The label is what the screen shows. */
export const UPLOAD_POST_PLATFORMS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'bluesky', label: 'Bluesky' },
  { key: 'x', label: 'X' },
  { key: 'threads', label: 'Threads' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'google_business', label: 'Google Business' },
  { key: 'discord', label: 'Discord' },
  { key: 'telegram', label: 'Telegram' },
]

/** The one platform ELO posts through Upload-Post. Everything else is comments, first comments and stats. */
export const UPLOAD_POST_POSTS_TO = 'tiktok'

export const UPLOAD_POST_KEY = 'uploadpost.apiKey'

export interface UploadPostLink {
  brandId: number
  brandName: string
  /** The profile name on Upload-Post. Empty until set. */
  profile: string
  /** Ticked platforms. A missing key is off. */
  platforms: Record<string, boolean>
}

export interface UploadPostState {
  hasKey: boolean
  masked: string
  links: UploadPostLink[]
}

/** What Upload-Post says about one profile when the key is tested. */
export interface UploadPostProfileInfo {
  username: string
  /** Platforms that profile has a login for on Upload-Post. */
  connected: string[]
}

export interface UploadPostTest {
  ok: boolean
  message: string
  profiles: UploadPostProfileInfo[]
}
