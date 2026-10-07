export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
]

export const SECRET_CLIENT_ID = 'google.client_id'
export const SECRET_CLIENT_SECRET = 'google.client_secret'
export const refreshTokenKey = (accountId: number) => `youtube.refresh.${accountId}`

export const STUDIO_URL = 'https://studio.youtube.com'
export const LOCKED_MESSAGE =
  'Google has not approved your app yet. YouTube switched this to private. Use Manual assist until SETUP_A step 9 is approved.'

export interface GoogleUrls {
  authBase: string
  tokenUrl: string
  revokeUrl: string
  /** Root for the googleapis client, with a trailing slash. */
  apiRoot: string
  uploadUrl: string
  /** True only when pointed at a local fake server for tests. */
  isFake: boolean
}

/**
 * Real Google addresses. ELO_GOOGLE_BASE (for example http://127.0.0.1:5555) points everything at a
 * local fake server so tests never touch Google. It is read from the environment only, never from the UI.
 */
export function googleUrls(env: NodeJS.ProcessEnv = process.env): GoogleUrls {
  const base = env['ELO_GOOGLE_BASE']
  if (base) {
    const b = base.replace(/\/$/, '')
    return {
      authBase: `${b}/o/oauth2/v2/auth`,
      tokenUrl: `${b}/token`,
      revokeUrl: `${b}/revoke`,
      apiRoot: `${b}/`,
      uploadUrl: `${b}/upload/youtube/v3/videos`,
      isFake: true,
    }
  }
  return {
    authBase: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    apiRoot: 'https://youtube.googleapis.com/',
    uploadUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
    isFake: false,
  }
}
