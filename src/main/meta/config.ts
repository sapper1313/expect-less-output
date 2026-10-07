export const GRAPH_VERSION = 'v25.0'
/** Fixed so the owner can add one redirect address to the Meta app (SETUP_B step 4). */
export const META_PORT = 53682
export const META_CALLBACK_PATH = '/meta/callback'

export const META_SECRET_APP_ID = 'meta.app_id'
export const META_SECRET_APP_SECRET = 'meta.app_secret'
export const META_SECRET_USER_TOKEN = 'meta.user_token'
export const pageTokenKey = (pageId: string) => `meta.page.${pageId}`

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'read_insights',
  'instagram_manage_insights',
]

/** Permissions this phase cannot work without. The insights ones are only needed in Phase 7. */
export const META_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
]

/** Facebook only accepts a scheduled publish time 10 or more minutes away. Keep a safety margin. */
export const FB_MIN_SCHEDULE_LEAD_MS = 15 * 60_000
export const FB_REELS_PER_DAY = 30
export const IG_POLL_TIMEOUT_MS = 15 * 60_000
export const EXPIRY_WARN_DAYS = 7

export interface MetaUrls {
  graph: string // includes the version, no trailing slash
  rupload: string // no trailing slash
  dialog: string
  port: number
  isFake: boolean
}

/**
 * Real Meta addresses. ELO_META_BASE (for example http://127.0.0.1:5556) and ELO_META_PORT point everything
 * at a local fake server for tests. They are read from the environment only, never from the UI.
 */
export function metaUrls(env: NodeJS.ProcessEnv = process.env): MetaUrls {
  const base = env['ELO_META_BASE']
  const port = env['ELO_META_PORT'] ? Number(env['ELO_META_PORT']) : META_PORT
  if (base) {
    const b = base.replace(/\/$/, '')
    return {
      graph: `${b}/${GRAPH_VERSION}`,
      rupload: b,
      dialog: `${b}/dialog/oauth`,
      port,
      isFake: true,
    }
  }
  return {
    graph: `https://graph.facebook.com/${GRAPH_VERSION}`,
    rupload: 'https://rupload.facebook.com',
    dialog: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    port,
    isFake: false,
  }
}
