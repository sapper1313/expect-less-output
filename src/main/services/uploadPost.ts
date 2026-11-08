import type { Db } from '../db'
import type { SecretStore } from './secrets'
import {
  UPLOAD_POST_KEY,
  UPLOAD_POST_POSTS_TO,
  type UploadPostLink,
  type UploadPostState,
  type UploadPostTest,
} from '@shared/uploadPost'
import { mask } from './secrets'
import { UploadPostClient, UploadPostError } from '../uploadpost/client'

const parse = (text: string | null | undefined): Record<string, boolean> => {
  try {
    const v = text ? (JSON.parse(text) as unknown) : null
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, boolean> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = x === true
      return out
    }
  } catch {
    /* fall through */
  }
  return {}
}

/** True when this channel has the platform ticked on the Upload-Post page. Reads the table directly. */
export function uploadPostOn(db: Db, brandId: number, platform: string): boolean {
  const r = db
    .prepare('SELECT platforms FROM upload_post_links WHERE brand_id = ?')
    .get(brandId) as { platforms: string } | undefined
  return !!r && parse(r.platforms)[platform] === true
}

/** The Upload-Post key, the per channel profile names and ticks, and the test button. */
export class UploadPostService {
  constructor(
    private db: Db,
    private secrets: SecretStore,
    private client: UploadPostClient = new UploadPostClient(),
  ) {}

  apiKey(): string | null {
    return this.secrets.get(UPLOAD_POST_KEY)
  }

  profileFor(brandId: number): string {
    const r = this.db.prepare('SELECT profile_user FROM upload_post_links WHERE brand_id = ?').get(brandId) as
      | { profile_user: string }
      | undefined
    return r?.profile_user.trim() ?? ''
  }

  active(brandId: number, platform: string): boolean {
    return uploadPostOn(this.db, brandId, platform)
  }

  state(): UploadPostState {
    const key = this.apiKey()
    const brands = this.db
      .prepare('SELECT id, name FROM brands WHERE archived = 0 ORDER BY id')
      .all() as Array<{ id: number; name: string }>
    const rows = this.db.prepare('SELECT * FROM upload_post_links').all() as Array<{
      brand_id: number
      profile_user: string
      platforms: string
    }>
    const by = new Map(rows.map((r) => [r.brand_id, r]))
    const links: UploadPostLink[] = brands.map((b) => ({
      brandId: b.id,
      brandName: b.name,
      profile: by.get(b.id)?.profile_user ?? '',
      platforms: parse(by.get(b.id)?.platforms),
    }))
    return { hasKey: !!key, masked: key ? mask(key) : '', links }
  }

  setKey(key: string): void {
    const k = key.trim()
    if (!k) throw new Error('Paste the API key first.')
    this.secrets.set(UPLOAD_POST_KEY, k)
  }

  removeKey(): void {
    this.secrets.delete(UPLOAD_POST_KEY)
  }

  /** Saves a channel's profile name and ticks. Turning TikTok on or off also makes or retires its Upload-Post account row. */
  setLink(brandId: number, profile: string, platforms: Record<string, boolean>): void {
    const on: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(platforms)) if (v === true) on[k] = true
    const name = profile.trim()
    if (on[UPLOAD_POST_POSTS_TO] && !name)
      throw new Error('Type the Upload-Post profile name for this channel before turning TikTok on.')
    this.db
      .prepare(
        `INSERT INTO upload_post_links (brand_id, profile_user, platforms) VALUES (?, ?, ?)
         ON CONFLICT(brand_id) DO UPDATE SET profile_user = excluded.profile_user, platforms = excluded.platforms`,
      )
      .run(brandId, name, JSON.stringify(on))
    this.syncAccount(brandId, !!on[UPLOAD_POST_POSTS_TO], name)
  }

  /**
   * ELO treats a channel as able to post to TikTok when it has an account row. A channel with no TikTok login of its
   * own gets a small Upload-Post row. A channel that has its own TikTok row keeps it, so unticking falls back to Drafts.
   */
  private syncAccount(brandId: number, on: boolean, profile: string): void {
    const row = this.db
      .prepare("SELECT id, mode FROM accounts WHERE brand_id = ? AND platform = 'tiktok'")
      .get(brandId) as { id: number; mode: string } | undefined
    if (on) {
      if (!row) {
        this.db
          .prepare(
            "INSERT INTO accounts (brand_id, platform, external_id, display_name, status, mode) VALUES (?, 'tiktok', ?, ?, 'connected', 'uploadpost')",
          )
          .run(brandId, profile, `Upload-Post: ${profile}`)
      } else if (row.mode === 'uploadpost' || row.mode === 'dry_run') {
        this.db
          .prepare("UPDATE accounts SET external_id = ?, display_name = ?, status = 'connected', mode = 'uploadpost' WHERE id = ?")
          .run(profile, `Upload-Post: ${profile}`, row.id)
      }
      return
    }
    if (row?.mode === 'uploadpost') {
      try {
        this.db.prepare('DELETE FROM accounts WHERE id = ?').run(row.id)
      } catch {
        // Old posts still point at it. Keep the row but make it a dry run so nothing posts for real.
        this.db.prepare("UPDATE accounts SET mode = 'dry_run' WHERE id = ?").run(row.id)
      }
    }
  }

  /** Asks Upload-Post for the profiles on this key. Used by the Test button. */
  async test(): Promise<UploadPostTest> {
    const key = this.apiKey()
    if (!key) return { ok: false, message: 'Save the API key first.', profiles: [] }
    try {
      const profiles = await this.client.profiles(key)
      return {
        ok: true,
        message: profiles.length
          ? `The key works. Upload-Post has ${profiles.length} profile${profiles.length === 1 ? '' : 's'}.`
          : 'The key works, but Upload-Post has no profiles yet. Make one on their site and connect your accounts.',
        profiles,
      }
    } catch (err) {
      const e = err as UploadPostError
      if (e.status === 401 || e.status === 403)
        return {
          ok: false,
          message: 'Upload-Post says the key is not valid. Copy it again from their site.',
          profiles: [],
        }
      return { ok: false, message: e.message, profiles: [] }
    }
  }
}
