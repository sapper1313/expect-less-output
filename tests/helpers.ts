import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate } from '../src/main/db'
import { seedIfEmpty } from '../src/main/db/seed'
import { ActivityLog } from '../src/main/services/activity'
import { Library } from '../src/main/services/library'
import { BrandService } from '../src/main/services/brands'
import { PostService } from '../src/main/services/posts'
import { SettingsService } from '../src/main/services/settings'
import { Scheduler, type Notifier } from '../src/main/scheduler/scheduler'
import { DryRunAdapter } from '../src/main/adapters/dryRun'
import { PLATFORMS } from '../src/shared/platformLimits'
import type { Account, Platform } from '../src/shared/types'
import type { PlatformAdapter } from '../src/main/adapters/types'

export function makeEnv(
  startMs = Date.UTC(2026, 5, 1, 12, 0, 0),
  opts: {
    adapterFor?: (platform: Platform, account: Account | null) => PlatformAdapter
    media?: import('../src/main/services/media').MediaService | null
    notifier?: Notifier
  } = {},
) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
  const root = mkdtempSync(join(tmpdir(), 'elo-test-'))
  const settings = new SettingsService(db)
  // The app starts with no alert number. The tests use one so the alert paths can be exercised.
  // The retry times are fixed here so the retry tests stay readable. The app's own default is 5, 15 and 60.
  settings.set({
    mediaRoot: root,
    alertIMessageEnabled: true,
    alertIMessageNumber: '+18046340444',
    retryMinutes: [2, 10, 30],
    // Most tests post to every platform on the same minute. The stagger has its own tests.
    staggerEnabled: false,
  })
  const library = new Library(() => settings.get().mediaRoot)
  const log = new ActivityLog(db)
  const clock = { ms: startMs }
  const posts = new PostService(
    db,
    library,
    opts.media ?? null,
    log,
    () => {},
    () => clock.ms,
  )
  const events = {
    failures: [] as string[][],
    successes: [] as string[][],
    missed: [] as string[][],
    told: [] as string[],
  }
  const notifier: Notifier = {
    failure: (h, d) => events.failures.push([h, d]),
    success: (h, d) => events.successes.push([h, d]),
    missed: (h, d) => events.missed.push([h, d]),
  }
  const adapters = Object.fromEntries(
    PLATFORMS.map((p) => [
      p,
      new DryRunAdapter(p, { getSettings: () => settings.get(), sleep: async () => {} }),
    ]),
  ) as unknown as Record<Platform, PlatformAdapter>
  const scheduler = new Scheduler({
    db,
    posts,
    library,
    log,
    getSettings: () => settings.get(),
    adapterFor: opts.adapterFor ?? ((platform) => adapters[platform]),
    notifier: opts.notifier ?? notifier,
    tell: async (text) => void events.told.push(text),
    now: () => clock.ms,
  })
  /** Creates a scheduled post with a real file in the brand Queue. */
  async function makePost(opts: {
    brandId?: number
    whenMs: number
    platforms?: Platform[]
    title?: string
    bytes?: number
  }) {
    const brandId = opts.brandId ?? 1
    const src = join(root, `src-${Math.random().toString(36).slice(2)}.mp4`)
    writeFileSync(src, opts.bytes ? Buffer.alloc(opts.bytes, 7) : 'fake video bytes')
    return posts.create({
      brandId,
      sourcePath: src,
      title: opts.title ?? 'Test Clip',
      caption: 'caption',
      scheduledAtUtc: new Date(opts.whenMs).toISOString(),
      status: 'scheduled',
      targets: (opts.platforms ?? PLATFORMS).map((platform) => ({ platform, aiFlag: false })),
    })
  }
  const brandsSvc = new BrandService(db, (name) => library.ensureBrandFolders(name))
  return {
    db,
    root,
    brands: brandsSvc,
    settings,
    library,
    log,
    posts,
    scheduler,
    clock,
    events,
    makePost,
  }
}
