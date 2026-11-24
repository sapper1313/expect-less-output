import { execFile } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, extname, join } from 'path'
import { isDeepStrictEqual } from 'util'
import type { Db } from '../db'
import type { ListFile } from '../pipeline/amazonLists'
import {
  SITE_LINK_KEYS,
  buildEntry,
  formatChannels,
  matchEntry,
  missingFor,
  type SiteEntry,
  type SiteLinkKey,
  type WebsiteConfig,
  type WebsiteProfile,
  type WebsiteProfilePatch,
  type WebsiteResult,
  type WebsiteStatus,
} from '@shared/website'

export type GitRun = (args: string[], cwd?: string) => Promise<string>

const CHANNELS_FILE = 'src/data/channels.json'
const DEFAULT_REPO = 'git@github.com:sapper1313/Expectlessmedia.git'
const HERO_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}
/** More than this many cards leaving the site in one publish is almost surely a mistake, so ELO stops and asks. */
const MAX_REMOVALS = 2

export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
        },
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || stdout || err.message).toString().trim()))
        else resolve(stdout.toString())
      },
    )
  })

export interface WebsiteDeps {
  db: Db
  /** ELO's own copy of the website project. Never the owner's working folder. */
  repoDir: string
  /** Where a newly picked hero image waits until it is published. */
  heroDir: string
  git?: GitRun
  now?: () => number
  /** Wait this long after a change before publishing on its own. */
  syncDelayMs?: number
  audit?: (action: string, target: string, after: unknown) => void
  notify?: (headline: string, detail: string) => void
  emit?: () => void
}

interface ProfileRow {
  brand_id: number
  add_to_site: number
  site_slug: string | null
  title: string
  host: string
  tagline: string
  description: string
  youtube_channel_id: string
  youtube_handle: string
  links_json: string
  accent: string
  hero_image: string
  hero_local: string | null
  dirty: number
  synced_at: string | null
}

interface BrandRow {
  id: number
  name: string
  slug: string | null
  color: string
  archived: number
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Plain words for the usual git failures. */
function plainGitError(raw: string): string {
  const t = raw.trim()
  if (/permission denied \(publickey\)|could not read from remote|authentication failed/i.test(t))
    return 'GitHub did not accept this Mac. The Mac needs to be signed in to GitHub with the same key you use in Terminal (ssh -T git@github.com should say Hi).'
  if (/could not resolve host|network is unreachable|timed out/i.test(t))
    return 'Could not reach GitHub. Check the internet and try again.'
  if (/repository not found|does not appear to be a git repository/i.test(t))
    return 'GitHub says that repository does not exist, or this Mac cannot see it. Check the address in the Website card.'
  if (/spawn git|enoent/i.test(t))
    return 'Git is not installed on this Mac. Install the Xcode command line tools.'
  return t.split('\n').slice(-3).join(' ').slice(0, 300) || 'Git failed.'
}

export class WebsiteService {
  private git: GitRun
  private now: () => number
  private chain: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private lastNotified = ''

  constructor(private d: WebsiteDeps) {
    this.git = d.git ?? runGit
    this.now = d.now ?? Date.now
  }

  // ---------- small state ----------

  private getState(key: string): string | null {
    const r = this.d.db.prepare('SELECT value FROM website_state WHERE key = ?').get(key) as
      { value: string } | undefined
    return r?.value ?? null
  }

  private setState(key: string, value: string | null): void {
    if (value === null) this.d.db.prepare('DELETE FROM website_state WHERE key = ?').run(key)
    else
      this.d.db
        .prepare(
          'INSERT INTO website_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value)
  }

  config(): WebsiteConfig {
    return {
      repoUrl: this.getState('repoUrl') ?? DEFAULT_REPO,
      branch: this.getState('branch') ?? 'main',
      autoPublish: (this.getState('autoPublish') ?? '1') === '1',
    }
  }

  setConfig(patch: Partial<WebsiteConfig>): WebsiteConfig {
    if (patch.repoUrl !== undefined) {
      const u = patch.repoUrl.trim()
      if (!/^(git@|ssh:\/\/|https:\/\/|\/)[^\s]+$/.test(u))
        throw new Error('The repository address should look like git@github.com:name/project.git.')
      this.setState('repoUrl', u)
    }
    if (patch.branch !== undefined) {
      const b = patch.branch.trim()
      if (!/^[A-Za-z0-9._/-]+$/.test(b)) throw new Error('That branch name has odd characters.')
      this.setState('branch', b)
    }
    if (patch.autoPublish !== undefined) this.setState('autoPublish', patch.autoPublish ? '1' : '0')
    return this.config()
  }

  // ---------- profiles ----------

  private brands(): BrandRow[] {
    return this.d.db
      .prepare('SELECT id, name, slug, color, archived FROM brands ORDER BY id')
      .all() as BrandRow[]
  }

  private brand(id: number): BrandRow {
    const b = this.d.db
      .prepare('SELECT id, name, slug, color, archived FROM brands WHERE id = ?')
      .get(id) as BrandRow | undefined
    if (!b) throw new Error('Channel not found.')
    return b
  }

  /** The row for a channel, created from what ELO already knows when it is the first time. */
  private row(brandId: number): ProfileRow {
    const have = this.d.db
      .prepare('SELECT * FROM website_profiles WHERE brand_id = ?')
      .get(brandId) as ProfileRow | undefined
    if (have) return have
    const b = this.brand(brandId)
    const yt = this.d.db
      .prepare("SELECT external_id FROM accounts WHERE brand_id = ? AND platform = 'youtube'")
      .get(brandId) as { external_id: string | null } | undefined
    this.d.db
      .prepare(
        `INSERT INTO website_profiles (brand_id, add_to_site, site_slug, title, accent, youtube_channel_id)
         VALUES (?, 0, ?, ?, ?, ?)`,
      )
      .run(brandId, b.slug, b.name, b.color, yt?.external_id ?? '')
    return this.d.db
      .prepare('SELECT * FROM website_profiles WHERE brand_id = ?')
      .get(brandId) as ProfileRow
  }

  private view(r: ProfileRow): WebsiteProfile {
    const links = ((): WebsiteProfile['links'] => {
      try {
        return JSON.parse(r.links_json) as WebsiteProfile['links']
      } catch {
        return {}
      }
    })()
    const base = {
      title: r.title,
      siteSlug: r.site_slug ?? '',
      description: r.description,
      tagline: r.tagline,
      youtubeChannelId: r.youtube_channel_id,
      heroImage: r.hero_image,
    }
    return {
      brandId: r.brand_id,
      addToSite: !!r.add_to_site,
      siteSlug: base.siteSlug,
      title: r.title,
      host: r.host,
      tagline: r.tagline,
      description: r.description,
      youtubeChannelId: r.youtube_channel_id,
      youtubeHandle: r.youtube_handle,
      links,
      accent: r.accent,
      heroImage: r.hero_image,
      heroPending: !!r.hero_local,
      dirty: !!r.dirty,
      syncedAt: r.synced_at,
      missing: missingFor(base),
    }
  }

  profile(brandId: number): WebsiteProfile {
    return this.view(this.row(brandId))
  }

  saveProfile(brandId: number, patch: WebsiteProfilePatch): WebsiteProfile {
    const cur = this.row(brandId)
    const sets: string[] = []
    const args: unknown[] = []
    const put = (col: string, v: unknown) => {
      sets.push(`${col} = ?`)
      args.push(v)
    }
    if (patch.siteSlug !== undefined) {
      const slug = patch.siteSlug.trim().toLowerCase()
      if (!SLUG_RE.test(slug))
        throw new Error('The web address name uses lowercase letters, numbers and single dashes.')
      const other = this.d.db
        .prepare('SELECT brand_id FROM website_profiles WHERE site_slug = ? AND brand_id != ?')
        .get(slug, brandId)
      if (other) throw new Error(`Another channel already uses the web address name ${slug}.`)
      put('site_slug', slug)
    }
    if (patch.addToSite !== undefined) put('add_to_site', patch.addToSite ? 1 : 0)
    for (const [k, col] of [
      ['title', 'title'],
      ['host', 'host'],
      ['tagline', 'tagline'],
      ['description', 'description'],
      ['youtubeChannelId', 'youtube_channel_id'],
      ['youtubeHandle', 'youtube_handle'],
      ['accent', 'accent'],
    ] as const) {
      const v = patch[k]
      if (v !== undefined) put(col, v.trim())
    }
    if (
      patch.accent !== undefined &&
      patch.accent.trim() &&
      !/^#[0-9a-fA-F]{6}$/.test(patch.accent.trim())
    )
      throw new Error('The color should look like #4f9ac8.')
    if (patch.links !== undefined) {
      const clean: Record<string, string> = {}
      for (const k of SITE_LINK_KEYS) {
        const v = (patch.links[k] ?? '').trim()
        if (v && !/^https:\/\//i.test(v))
          throw new Error(`The ${k} link should start with https://.`)
        clean[k] = v
      }
      put('links_json', JSON.stringify(clean))
    }
    if (!sets.length) return this.view(cur)
    sets.push('dirty = 1')
    this.d.db
      .prepare(`UPDATE website_profiles SET ${sets.join(', ')} WHERE brand_id = ?`)
      .run(...args, brandId)
    this.requestSync()
    return this.profile(brandId)
  }

  /** Takes a picked image, keeps a copy, and points the card at /brand/<web address name>-hero.<ext>. */
  setHero(brandId: number, srcPath: string): WebsiteProfile {
    const ext = extname(srcPath).toLowerCase()
    if (!HERO_TYPES[ext]) throw new Error('Pick a PNG, JPG or WebP picture.')
    if (!existsSync(srcPath)) throw new Error('That picture could not be found.')
    if (statSync(srcPath).size > 8 * 1024 * 1024)
      throw new Error('That picture is over 8 MB. Make it smaller first.')
    const cur = this.row(brandId)
    const slug = cur.site_slug || this.brand(brandId).slug
    if (!slug) throw new Error('Set the web address name first, then pick the picture.')
    mkdirSync(this.d.heroDir, { recursive: true })
    const local = join(this.d.heroDir, `${brandId}-${this.now()}${ext}`)
    copyFileSync(srcPath, local)
    if (cur.hero_local && cur.hero_local !== local) rmSync(cur.hero_local, { force: true })
    this.d.db
      .prepare(
        'UPDATE website_profiles SET hero_image = ?, hero_local = ?, site_slug = ?, dirty = 1 WHERE brand_id = ?',
      )
      .run(`/brand/${slug}-hero${ext}`, local, slug, brandId)
    this.requestSync()
    return this.profile(brandId)
  }

  /** The hero image as a data URL for the screen: the waiting upload, else the copy in ELO's clone of the site. */
  heroPreview(brandId: number): string | null {
    const r = this.row(brandId)
    const candidates = [
      r.hero_local,
      r.hero_image ? join(this.d.repoDir, 'public', r.hero_image) : null,
    ]
    for (const p of candidates) {
      if (!p || !existsSync(p)) continue
      const mime = HERO_TYPES[extname(p).toLowerCase()]
      if (!mime || statSync(p).size > 8 * 1024 * 1024) continue
      return `data:${mime};base64,${readFileSync(p).toString('base64')}`
    }
    return null
  }

  status(): WebsiteStatus {
    const rows = this.d.db.prepare('SELECT * FROM website_profiles').all() as ProfileRow[]
    const archived = new Set(
      this.brands()
        .filter((b) => b.archived)
        .map((b) => b.id),
    )
    const names = new Map(this.brands().map((b) => [b.id, b.name]))
    return {
      lastPullAt: this.getState('lastPullAt'),
      lastPublishAt: this.getState('lastPublishAt'),
      lastError: this.getState('lastError'),
      waiting: rows.filter((r) => r.dirty).length,
      incomplete: rows
        .filter((r) => r.add_to_site && !archived.has(r.brand_id))
        .map((r) => ({
          brandId: r.brand_id,
          name: names.get(r.brand_id) ?? '',
          missing: this.view(r).missing,
        }))
        .filter((x) => x.missing.length),
    }
  }

  // ---------- git ----------

  private async ensureRepo(): Promise<void> {
    const { repoUrl, branch } = this.config()
    const dir = this.d.repoDir
    if (!existsSync(join(dir, '.git'))) {
      mkdirSync(join(dir, '..'), { recursive: true })
      rmSync(dir, { recursive: true, force: true })
      await this.git(['clone', '--branch', branch, repoUrl, dir])
      return
    }
    await this.git(['remote', 'set-url', 'origin', repoUrl], dir)
    await this.git(['fetch', 'origin', branch], dir)
    await this.git(['checkout', '-f', '-B', branch, `origin/${branch}`], dir)
    await this.git(['clean', '-fdq'], dir)
  }

  private readEntries(): SiteEntry[] {
    const p = join(this.d.repoDir, CHANNELS_FILE)
    if (!existsSync(p))
      throw new Error(`The website has no ${CHANNELS_FILE}. Check the repository address.`)
    const data = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (!Array.isArray(data)) throw new Error('The website channel list is not a list.')
    return data as SiteEntry[]
  }

  /** Fills every channel that has no change waiting from the site's card, so the two always agree to start with. */
  private importFromSite(entries: SiteEntry[]): string[] {
    const imported: string[] = []
    for (const b of this.brands()) {
      const r = this.row(b.id)
      if (r.dirty) continue
      const e =
        entries.find((x) => r.site_slug && x.slug === r.site_slug) ??
        matchEntry({ slug: b.slug, name: b.name }, entries)
      if (!e) continue
      const links: Record<string, string> = {}
      for (const k of SITE_LINK_KEYS) links[k] = e.links?.[k] ?? ''
      const next = {
        add: e.status === 'live' ? 1 : 0,
        slug: e.slug,
        title: e.name ?? '',
        host: e.host ?? '',
        tagline: e.tagline ?? '',
        description: e.description ?? '',
        id: e.youtubeChannelId ?? '',
        handle: e.youtubeHandle ?? '',
        links: JSON.stringify(links),
        accent: e.accent ?? '',
        hero: e.heroImage ?? '',
      }
      const same =
        r.add_to_site === next.add &&
        r.site_slug === next.slug &&
        r.title === next.title &&
        r.host === next.host &&
        r.tagline === next.tagline &&
        r.description === next.description &&
        r.youtube_channel_id === next.id &&
        r.youtube_handle === next.handle &&
        r.links_json === next.links &&
        r.accent === next.accent &&
        r.hero_image === next.hero &&
        !r.hero_local
      if (same) continue
      this.d.db
        .prepare(
          `UPDATE website_profiles SET add_to_site = ?, site_slug = ?, title = ?, host = ?, tagline = ?, description = ?,
             youtube_channel_id = ?, youtube_handle = ?, links_json = ?, accent = ?, hero_image = ?, hero_local = NULL,
             dirty = 0, synced_at = ? WHERE brand_id = ?`,
        )
        .run(
          next.add,
          next.slug,
          next.title,
          next.host,
          next.tagline,
          next.description,
          next.id,
          next.handle,
          next.links,
          next.accent,
          next.hero,
          new Date(this.now()).toISOString(),
          b.id,
        )
      imported.push(b.name)
    }
    return imported
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private fail(message: string): WebsiteResult {
    this.setState('lastError', message)
    if (this.lastNotified !== message) {
      this.lastNotified = message
      this.d.notify?.('The website did not update.', message)
    }
    this.d.emit?.()
    return { ok: false, message, added: [], updated: [], removed: [], skipped: [] }
  }

  /** Reads the site's channel list and fills ELO with it. Changes nothing on the site. */
  pull(): Promise<WebsiteResult> {
    return this.serial(async () => {
      try {
        await this.ensureRepo()
        const imported = this.importFromSite(this.readEntries())
        this.setState('lastPullAt', new Date(this.now()).toISOString())
        this.setState('lastError', null)
        this.lastNotified = ''
        this.d.audit?.('website.pull', 'channels.json', { imported })
        this.d.emit?.()
        return {
          ok: true,
          message: imported.length
            ? `Filled in ${imported.length} channel${imported.length === 1 ? '' : 's'} from the website.`
            : 'ELO already matches the website.',
          added: [],
          updated: imported,
          removed: [],
          skipped: [],
        }
      } catch (e) {
        return this.fail(plainGitError(e instanceof Error ? e.message : String(e)))
      }
    })
  }

  /** Makes the site's channel list match ELO: add ticked channels, update changed ones, remove archived or unticked. */
  publish(): Promise<WebsiteResult> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.serial(async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await this.publishOnce()
          if (r !== 'retry') return r
        }
        return this.fail('The website changed while ELO was publishing. Try again in a minute.')
      } catch (e) {
        return this.fail(plainGitError(e instanceof Error ? e.message : String(e)))
      }
    })
  }

  private async publishOnce(): Promise<WebsiteResult | 'retry'> {
    await this.ensureRepo()
    const before = this.readEntries()
    this.importFromSite(before)

    const result: WebsiteResult = {
      ok: true,
      message: '',
      added: [],
      updated: [],
      removed: [],
      skipped: [],
    }
    let entries = before.map((e) => ({ ...e }))
    const heroCopies: Array<{ from: string; to: string }> = []
    const touched: number[] = []
    const maxNumber = () => entries.reduce((m, e) => Math.max(m, Number(e.number) || 0), 0)

    for (const b of this.brands()) {
      const r = this.row(b.id)
      const p = this.view(r)
      const idx = entries.findIndex((e) => p.siteSlug && e.slug === p.siteSlug)
      const old = idx >= 0 ? entries[idx] : undefined
      if (p.addToSite && !b.archived) {
        if (p.missing.length) {
          result.skipped.push({ name: b.name, why: `needs: ${p.missing.join(', ')}` })
          continue
        }
        const next = buildEntry(
          { name: b.name, archived: false, color: b.color },
          p,
          old,
          maxNumber() + 1,
        )
        if (r.hero_local)
          heroCopies.push({ from: r.hero_local, to: join('public', next.heroImage) })
        if (!old) {
          entries.push(next)
          result.added.push(b.name)
        } else if (!isDeepStrictEqual(old, next)) {
          entries[idx] = next
          result.updated.push(b.name)
        } else if (!r.hero_local) {
          touched.push(b.id)
          continue
        }
        touched.push(b.id)
      } else if (old && old.status === 'live') {
        entries = entries.filter((e) => e !== old)
        result.removed.push(b.name)
        touched.push(b.id)
      }
    }

    if (result.removed.length > MAX_REMOVALS)
      return this.fail(
        `ELO would take ${result.removed.length} channels off the website at once (${result.removed.join(', ')}). That looks wrong, so nothing was changed.`,
      ) as WebsiteResult

    const changed =
      result.added.length + result.updated.length + result.removed.length + heroCopies.length
    const now = new Date(this.now()).toISOString()
    const markClean = () => {
      for (const id of touched) {
        const r = this.row(id)
        if (r.hero_local) rmSync(r.hero_local, { force: true })
        this.d.db
          .prepare(
            'UPDATE website_profiles SET dirty = 0, hero_local = NULL, synced_at = ? WHERE brand_id = ?',
          )
          .run(now, id)
      }
    }

    if (!changed) {
      markClean()
      this.setState('lastPublishAt', now)
      this.setState('lastError', null)
      result.message = result.skipped.length
        ? 'Nothing to send. Some channels are not ready yet.'
        : 'The website already matches ELO.'
      this.d.emit?.()
      return result
    }

    const dir = this.d.repoDir
    for (const c of heroCopies) {
      mkdirSync(join(dir, 'public', 'brand'), { recursive: true })
      copyFileSync(c.from, join(dir, c.to))
    }
    writeFileSync(join(dir, CHANNELS_FILE), formatChannels(entries))
    const paths = [CHANNELS_FILE, ...heroCopies.map((c) => c.to)]
    await this.git(['add', '--', ...paths], dir)
    const who = (await this.git(['config', 'user.name'], dir).catch(() => '')).trim()
    const ident = who
      ? []
      : ['-c', 'user.name=Expect Less Output', '-c', 'user.email=elo@expectlessmedia.com']
    const bits = [
      result.added.length ? `add ${result.added.join(', ')}` : '',
      result.updated.length ? `update ${result.updated.join(', ')}` : '',
      result.removed.length ? `remove ${result.removed.join(', ')}` : '',
    ].filter(Boolean)
    await this.git([...ident, 'commit', '-m', `channels: ${bits.join('; ')} [elo]`], dir)
    const { branch } = this.config()
    try {
      await this.git(['push', 'origin', `HEAD:${branch}`], dir)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/rejected|fetch first|non-fast-forward/i.test(msg)) return 'retry'
      throw e
    }
    markClean()
    this.setState('lastPublishAt', now)
    this.setState('lastError', null)
    this.lastNotified = ''
    const parts = [
      result.added.length ? `added ${result.added.join(', ')}` : '',
      result.updated.length ? `updated ${result.updated.join(', ')}` : '',
      result.removed.length ? `removed ${result.removed.join(', ')}` : '',
    ].filter(Boolean)
    result.message = `Sent to the website: ${parts.join('; ') || 'a new picture'}. It goes live in about a minute.`
    this.d.audit?.('website.publish', 'channels.json', {
      added: result.added,
      updated: result.updated,
      removed: result.removed,
    })
    this.d.emit?.()
    return result
  }

  /**
   * Sends one Amazon list page to the website: src/data/lists/<episode id>.json. Only that file is touched. If the
   * same file is already on the site with the same content, nothing is sent.
   */
  publishList(file: ListFile): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(file.episodeId))
      return Promise.reject(new Error('The episode id cannot be used in a web address.'))
    return this.changeFile(
      `src/data/lists/${file.episodeId}.json`,
      () => JSON.stringify(file, null, 2) + '\n',
      `list: ${file.episodeId} [elo]`,
      { products: file.products.length },
    )
  }

  /**
   * Fills in the links of a channel's starter picks (src/data/resources/<site slug>.json) from its tracking id.
   * The desk supplies the picks without links. Does nothing when the channel has no starter file.
   */
  fillStarters(siteSlug: string, linkFor: (asin: string) => string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(siteSlug)) return Promise.resolve()
    return this.changeFile(
      `src/data/resources/${siteSlug}.json`,
      (old) => {
        if (old === null) return null
        const data = JSON.parse(old) as { products?: Array<{ asin: string; url?: string }> }
        for (const p of data.products ?? []) p.url = linkFor(p.asin)
        return JSON.stringify(data, null, 2) + '\n'
      },
      `starter picks: ${siteSlug} [elo]`,
      { starters: siteSlug },
    )
  }

  /** Writes one file in the website project and pushes it. `build` gets the file's text (null when missing) and returns the new text, or null for no change. */
  private changeFile(
    rel: string,
    build: (old: string | null) => string | null,
    message: string,
    audit: unknown,
  ): Promise<void> {
    return this.serial(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.ensureRepo()
        const dir = this.d.repoDir
        const full = join(dir, rel)
        const old = existsSync(full) ? readFileSync(full, 'utf8') : null
        const text = build(old)
        if (text === null || text === old) return
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, text)
        await this.git(['add', '--', rel], dir)
        const who = (await this.git(['config', 'user.name'], dir).catch(() => '')).trim()
        const ident = who ? [] : ['-c', 'user.name=Expect Less Output', '-c', 'user.email=elo@expectlessmedia.com']
        await this.git([...ident, 'commit', '-m', message], dir)
        try {
          await this.git(['push', 'origin', `HEAD:${this.config().branch}`], dir)
          this.d.audit?.('website.file', rel, audit)
          return
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (!/rejected|fetch first|non-fast-forward/i.test(msg)) throw new Error(plainGitError(msg), { cause: e })
        }
      }
      throw new Error('The website changed while the file was being sent. It will try again.')
    })
  }

  // ---------- automatic ----------

  /** Called after any change. When auto publish is on, sends the change a little later. */
  requestSync(): void {
    if (!this.config().autoPublish) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.publish()
    }, this.d.syncDelayMs ?? 45_000)
    this.timer.unref?.()
  }

  /** Every half hour: read the site now and then, and send anything waiting. */
  async tick(): Promise<void> {
    const last = this.getState('lastPullAt')
    if (!last || this.now() - Date.parse(last) > 6 * 3_600_000) await this.pull()
    if (this.config().autoPublish && this.status().waiting > 0 && !this.timer) await this.publish()
  }
}

export type { SiteLinkKey }
