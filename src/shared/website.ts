/** One card in the website's src/data/channels.json. Fields ELO does not manage are carried through untouched. */
export interface SiteEntry {
  slug: string
  number: number
  name: string
  status: string
  host: string
  tagline: string
  description: string
  youtubeChannelId: string
  youtubeHandle: string
  feeds: string[]
  links: Record<string, string>
  accent: string
  heroImage: string
  cadence: string
  [extra: string]: unknown
}

export type SiteLinkKey = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'bluesky'
export const SITE_LINK_KEYS: SiteLinkKey[] = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'bluesky',
]

export interface WebsiteProfile {
  brandId: number
  addToSite: boolean
  siteSlug: string
  /** The name shown on the site. Can be longer than the channel name. */
  title: string
  host: string
  tagline: string
  description: string
  youtubeChannelId: string
  youtubeHandle: string
  links: Partial<Record<SiteLinkKey, string>>
  accent: string
  /** The site path of the hero image, like /brand/whw-hero.png. */
  heroImage: string
  /** True when a new image is picked in ELO and not on the site yet. */
  heroPending: boolean
  /** ELO has a change the site does not have yet. */
  dirty: boolean
  syncedAt: string | null
  /** What a card still needs before ELO will put it on the site. Empty when ready. */
  missing: string[]
}

export type WebsiteProfilePatch = Partial<
  Pick<
    WebsiteProfile,
    | 'addToSite'
    | 'siteSlug'
    | 'title'
    | 'host'
    | 'tagline'
    | 'description'
    | 'youtubeChannelId'
    | 'youtubeHandle'
    | 'links'
    | 'accent'
  >
>

export interface WebsiteConfig {
  repoUrl: string
  branch: string
  /** Publish a little after any change, and once a day. */
  autoPublish: boolean
}

export interface WebsiteStatus {
  lastPullAt: string | null
  lastPublishAt: string | null
  lastError: string | null
  /** Channels with a change not on the site yet. */
  waiting: number
  /** Channels that are ticked for the site but cannot go yet, with what each lacks. */
  incomplete: Array<{ brandId: number; name: string; missing: string[] }>
}

export interface WebsiteResult {
  ok: boolean
  /** Plain words for the owner. */
  message: string
  added: string[]
  updated: string[]
  removed: string[]
  skipped: Array<{ name: string; why: string }>
}

const strip = (s: string) => s.replace(/^the-/, '')

/** Finds the site card that belongs to a channel: same slug, or one slug is the other plus more words. */
export function matchEntry(
  brand: { slug: string | null; name: string },
  entries: SiteEntry[],
): SiteEntry | undefined {
  const slug = (brand.slug ?? '').toLowerCase()
  if (slug) {
    const exact = entries.find((e) => e.slug === slug)
    if (exact) return exact
    const a = strip(slug)
    const near = entries.filter((e) => {
      const b = strip(e.slug)
      return b === a || b.startsWith(a + '-') || a.startsWith(b + '-')
    })
    if (near.length === 1) return near[0]
  }
  const n = brand.name.trim().toLowerCase()
  const byName = entries.filter(
    (e) => e.name.toLowerCase() === n || e.name.toLowerCase().startsWith(n + ' '),
  )
  return byName.length === 1 ? byName[0] : undefined
}

/** What a card still needs before it can go on the site. */
export function missingFor(p: {
  title: string
  siteSlug: string
  description: string
  tagline: string
  youtubeChannelId: string
  heroImage: string
}): string[] {
  const out: string[] = []
  if (!p.title.trim()) out.push('title')
  if (!p.siteSlug.trim()) out.push('web address name')
  if (!p.tagline.trim()) out.push('tagline')
  if (!p.description.trim()) out.push('description')
  if (!p.youtubeChannelId.trim()) out.push('YouTube channel id')
  if (!p.heroImage.trim()) out.push('hero image')
  return out
}

export interface BrandForSite {
  name: string
  archived: boolean
  color: string
}

export interface ProfileForSite {
  addToSite: boolean
  siteSlug: string
  title: string
  host: string
  tagline: string
  description: string
  youtubeChannelId: string
  youtubeHandle: string
  links: Partial<Record<SiteLinkKey, string>>
  accent: string
  heroImage: string
}

/** The channel card for one profile, keeping every field of the old card that ELO does not manage. */
export function buildEntry(
  brand: BrandForSite,
  p: ProfileForSite,
  old: SiteEntry | undefined,
  nextNumber: number,
): SiteEntry {
  const links: Record<string, string> = { ...(old?.links ?? {}) }
  for (const k of SITE_LINK_KEYS) {
    if (!(k in p.links)) continue
    const v = (p.links[k] ?? '').trim()
    if (v) links[k] = v
    else delete links[k]
  }
  if (!links.youtube && p.youtubeChannelId)
    links.youtube = p.youtubeHandle
      ? `https://www.youtube.com/${p.youtubeHandle.startsWith('@') ? p.youtubeHandle : '@' + p.youtubeHandle}`
      : `https://www.youtube.com/channel/${p.youtubeChannelId}`
  return {
    cadence: '',
    feeds: ['shorts', 'long'],
    ...old,
    slug: p.siteSlug,
    number: old?.number ?? nextNumber,
    name: p.title.trim() || brand.name,
    status: 'live',
    host: p.host.trim(),
    tagline: p.tagline.trim(),
    description: p.description.trim(),
    youtubeChannelId: p.youtubeChannelId.trim(),
    youtubeHandle: p.youtubeHandle.trim(),
    links,
    accent: p.accent.trim() || brand.color,
    heroImage: p.heroImage.trim(),
  }
}

/** Collapses short string lists onto one line, the way the site's own formatter writes them. */
export function formatChannels(entries: SiteEntry[]): string {
  const text = JSON.stringify(entries, null, 2)
  const tidy = text.replace(
    /\[\n\s+("(?:[^"\\\n]|\\.)*"(?:,\n\s+"(?:[^"\\\n]|\\.)*")*)\n\s+\]/g,
    (_m, inner: string) => `[${inner.replace(/,\n\s+/g, ', ')}]`,
  )
  return tidy + '\n'
}
