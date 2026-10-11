import type { Db } from '../db'
import type { StudioConfigService } from './configService'
import type { AuditLog } from './agents/framework'

export interface Metrics {
  impressions: number
  ctr: number
  avgViewSeconds: number | null
}

/** Reads thumbnail results for a video between two times. The real one calls the YouTube Analytics API. */
export interface AnalyticsReader {
  read(accountId: number | null, videoId: string, fromUtc: string, toUtc: string): Promise<Metrics>
}

/** Puts a thumbnail on a video. The real one is YoutubeClient.setThumbnail. */
export interface ThumbnailSetter {
  set(accountId: number | null, videoId: string, file: string): Promise<void>
}

/** Mock mode: simulated numbers where candidate B does a little better, unless a test says otherwise. */
export class MockAnalytics implements AnalyticsReader {
  ctr: Record<string, number> = { A: 0.041, B: 0.058 }
  impressions = 1200
  private current = 'A'
  setCurrent(v: string) {
    this.current = v
  }
  async read(): Promise<Metrics> {
    return {
      impressions: this.impressions,
      ctr: this.ctr[this.current] ?? 0.04,
      avgViewSeconds: 95,
    }
  }
}

export interface TestDeps {
  db: Db
  cfg: StudioConfigService
  audit: AuditLog
  reader: () => AnalyticsReader
  setter: () => ThumbnailSetter
  /** Mock mode only: tells the simulated reader which variant is on screen. */
  onShow?: (variant: string) => void
  now?: () => number
}

/**
 * The thumbnail A/B swap test for YouTube long form. Publish with candidate A, read click through rate after a window
 * (default 48 hours and a minimum number of impressions), swap to B, compare, keep the winner, record both results.
 * YouTube's own Test and Compare feature is not in the public API, so this swap test is what runs.
 */
export class ThumbnailTester {
  constructor(private d: TestDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** Called when a long form episode is scheduled: remembers the candidates and waits for the video id. */
  register(
    episodeId: string,
    brandId: number,
    postId: number | null,
    variants: Array<{ id: string; file: string; headline: string; score: number }>,
  ): void {
    if (variants.length < 2) return
    this.d.db
      .prepare(
        "INSERT OR REPLACE INTO thumb_tests (episode_id, brand_id, state, extensions) VALUES (?, ?, 'pending', 0)",
      )
      .run(episodeId, brandId)
    const ins = this.d.db.prepare(
      'INSERT INTO thumb_variants (episode_id, post_id, brand_id, variant, file_path, headline, score, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    // The best candidate is shown first and called A, the runner up is B, whatever their picture ids were.
    variants
      .slice(0, 2)
      .forEach((v, i) =>
        ins.run(
          episodeId,
          postId,
          brandId,
          i === 0 ? 'A' : 'B',
          v.file,
          v.headline,
          v.score,
          new Date(this.now()).toISOString(),
        ),
      )
  }

  private variants(episodeId: string) {
    return this.d.db
      .prepare('SELECT * FROM thumb_variants WHERE episode_id = ? ORDER BY id')
      .all(episodeId) as Array<{ id: number; variant: string; file_path: string }>
  }

  /** One pass over every unfinished test. Safe to call often. */
  async tick(): Promise<void> {
    const cfg = this.d.cfg.get().thumbnailEngine
    const delayMs = cfg.abDelayHours * 3_600_000
    const tests = this.d.db
      .prepare("SELECT * FROM thumb_tests WHERE state IN ('pending','running_a','running_b')")
      .all() as Array<any>
    for (const t of tests) {
      try {
        if (t.state === 'pending') await this.start(t)
        else if (t.state === 'running_a' && this.now() >= Date.parse(t.swap_after_utc))
          await this.swap(t, delayMs, cfg.abMinImpressions)
        else if (t.state === 'running_b' && this.now() >= Date.parse(t.finish_after_utc))
          await this.finish(t, cfg.abMinImpressions)
      } catch (e) {
        this.skip(t, `Test stopped: ${(e as Error).message}`)
      }
    }
  }

  private skip(t: { episode_id: string; brand_id: number }, note: string) {
    this.d.db
      .prepare("UPDATE thumb_tests SET state = 'skipped', note = ? WHERE episode_id = ?")
      .run(note, t.episode_id)
    this.d.audit.write({
      agent: 'Thumbnail',
      action: 'ab_skipped',
      brandId: t.brand_id,
      episodeId: t.episode_id,
      detail: { note },
    })
  }

  /** The video is up on YouTube. Candidate A is already the thumbnail. Start the clock. */
  private async start(t: any): Promise<void> {
    const post = this.d.db
      .prepare(
        `SELECT p.id, pt.external_id AS video, pt.account_id AS account FROM episodes e JOIN posts p ON p.id = e.post_id
         JOIN post_targets pt ON pt.post_id = p.id AND pt.platform = 'youtube'
         WHERE e.id = ? AND pt.status = 'posted' AND pt.external_id IS NOT NULL`,
      )
      .get(t.episode_id) as { id: number; video: string; account: number } | undefined
    if (!post) return
    const startedAt = new Date(this.now()).toISOString()
    const delay = this.d.cfg.get().thumbnailEngine.abDelayHours * 3_600_000
    this.d.db
      .prepare(
        "UPDATE thumb_tests SET state = 'running_a', video_id = ?, account_id = ?, started_utc = ?, swap_after_utc = ? WHERE episode_id = ?",
      )
      .run(
        post.video,
        post.account,
        startedAt,
        new Date(this.now() + delay).toISOString(),
        t.episode_id,
      )
    this.d.db
      .prepare(
        "UPDATE thumb_variants SET shown_from_utc = ?, post_id = ?, video_id = ? WHERE episode_id = ? AND variant = 'A'",
      )
      .run(startedAt, post.id, post.video, t.episode_id)
    this.d.onShow?.('A')
    this.d.audit.write({
      agent: 'Thumbnail',
      action: 'ab_started',
      brandId: t.brand_id,
      episodeId: t.episode_id,
      detail: { videoId: post.video },
    })
  }

  private async swap(t: any, delayMs: number, minImpressions: number): Promise<void> {
    const a = this.d.db
      .prepare("SELECT * FROM thumb_variants WHERE episode_id = ? AND variant = 'A'")
      .get(t.episode_id) as any
    const now = new Date(this.now()).toISOString()
    const m = await this.d.reader().read(t.account_id, t.video_id, a.shown_from_utc, now)
    if (m.impressions < minImpressions) {
      if (t.extensions >= 2)
        return this.skip(
          t,
          `Only ${m.impressions} impressions after three windows, so the test was dropped. Candidate A stays.`,
        )
      this.d.db
        .prepare(
          'UPDATE thumb_tests SET swap_after_utc = ?, extensions = extensions + 1 WHERE episode_id = ?',
        )
        .run(new Date(this.now() + delayMs).toISOString(), t.episode_id)
      return
    }
    this.d.db
      .prepare(
        'UPDATE thumb_variants SET impressions = ?, ctr = ?, avg_view_seconds = ?, shown_until_utc = ? WHERE id = ?',
      )
      .run(m.impressions, m.ctr, m.avgViewSeconds, now, a.id)
    const b = this.d.db
      .prepare("SELECT * FROM thumb_variants WHERE episode_id = ? AND variant = 'B'")
      .get(t.episode_id) as any
    await this.d.setter().set(t.account_id, t.video_id, b.file_path)
    this.d.onShow?.('B')
    this.d.db.prepare('UPDATE thumb_variants SET shown_from_utc = ? WHERE id = ?').run(now, b.id)
    this.d.db
      .prepare(
        "UPDATE thumb_tests SET state = 'running_b', finish_after_utc = ? WHERE episode_id = ?",
      )
      .run(new Date(this.now() + delayMs).toISOString(), t.episode_id)
    this.d.audit.write({
      agent: 'Thumbnail',
      action: 'ab_swapped',
      brandId: t.brand_id,
      episodeId: t.episode_id,
      detail: { a: m },
    })
  }

  private async finish(t: any, minImpressions: number): Promise<void> {
    const rows = this.variants(t.episode_id)
    const a = this.d.db
      .prepare("SELECT * FROM thumb_variants WHERE episode_id = ? AND variant = 'A'")
      .get(t.episode_id) as any
    const b = this.d.db
      .prepare("SELECT * FROM thumb_variants WHERE episode_id = ? AND variant = 'B'")
      .get(t.episode_id) as any
    const now = new Date(this.now()).toISOString()
    const m = await this.d.reader().read(t.account_id, t.video_id, b.shown_from_utc, now)
    this.d.db
      .prepare(
        'UPDATE thumb_variants SET impressions = ?, ctr = ?, avg_view_seconds = ?, shown_until_utc = ? WHERE id = ?',
      )
      .run(m.impressions, m.ctr, m.avgViewSeconds, now, b.id)
    const bWins = m.impressions >= minImpressions && m.ctr > (a.ctr ?? 0)
    const winner = bWins ? b : a
    if (!bWins) {
      await this.d.setter().set(t.account_id, t.video_id, a.file_path)
      this.d.onShow?.('A')
    }
    this.d.db.prepare('UPDATE thumb_variants SET winner = 1 WHERE id = ?').run(winner.id)
    this.d.db
      .prepare("UPDATE thumb_tests SET state = 'done', note = ? WHERE episode_id = ?")
      .run(
        `Winner ${winner.variant}. A: ${((a.ctr ?? 0) * 100).toFixed(1)} percent, B: ${(m.ctr * 100).toFixed(1)} percent.`,
        t.episode_id,
      )
    this.d.audit.write({
      agent: 'Thumbnail',
      action: 'ab_done',
      brandId: t.brand_id,
      episodeId: t.episode_id,
      detail: { winner: winner.variant, a: a.ctr, b: m.ctr, variants: rows.length },
    })
  }

  /** What each style earned, per brand. Fed back to the Thumbnail agent as a hint. */
  winnersFor(brandId: number): Array<{ headline: string; ctr: number }> {
    return this.d.db
      .prepare(
        'SELECT headline, ctr FROM thumb_variants WHERE brand_id = ? AND winner = 1 AND ctr IS NOT NULL ORDER BY id DESC LIMIT 10',
      )
      .all(brandId) as Array<{ headline: string; ctr: number }>
  }
}
