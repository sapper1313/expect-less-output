import type { Db } from '../db'
import { EDIT_CAPABILITY, type EditPatch } from '@shared/platformEdit'
import { cleanYoutubeText } from '../google/metadata'

export interface EditDeps {
  db: Db
  youtubeUpdate: (accountId: number, videoId: string, patch: EditPatch) => Promise<void>
  facebookUpdate: (
    brandId: number,
    accountId: number | null,
    videoId: string,
    patch: EditPatch,
  ) => Promise<void>
  /** Mock mode: nothing is sent to the platform. */
  mock: () => boolean
  log: (message: string) => void
}

/** Changes the text of a video that is already live, on the platforms whose API allows it. */
export class PlatformEditor {
  constructor(private d: EditDeps) {}

  async edit(postId: number, platform: string, patch: EditPatch): Promise<string> {
    const cap = EDIT_CAPABILITY[platform]
    if (!cap) throw new Error('That platform is not known.')
    if (!cap.canEdit) throw new Error(cap.note)
    const t = this.d.db
      .prepare(
        'SELECT t.id, t.account_id, t.external_id, t.status, t.settings_json, a.mode AS account_mode, p.brand_id, p.title FROM post_targets t JOIN posts p ON p.id = t.post_id LEFT JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ? AND t.platform = ?',
      )
      .get(postId, platform) as
      | {
          id: number
          account_id: number | null
          external_id: string | null
          status: string
          brand_id: number
          title: string
          settings_json: string | null
          account_mode: string | null
        }
      | undefined
    if (!t) throw new Error('This post is not going to that platform.')
    if (t.status !== 'posted' || !t.external_id)
      throw new Error('This video is not live on that platform yet. Edit the post itself instead.')
    const clean: EditPatch = {}
    if (cap.fields.includes('title') && patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) throw new Error('The title cannot be empty.')
      if (platform === 'youtube' && title.length > 100)
        throw new Error('A YouTube title can be at most 100 characters.')
      clean.title = platform === 'youtube' ? cleanYoutubeText(title).trim() : title
    }
    if (cap.fields.includes('description') && patch.description !== undefined)
      clean.description = platform === 'youtube' ? cleanYoutubeText(patch.description) : patch.description
    if (cap.fields.includes('tags') && patch.tags !== undefined)
      clean.tags = patch.tags.map((x) => x.replace(/^#/, '').trim()).filter(Boolean)
    if (!Object.keys(clean).length) throw new Error('Nothing was changed.')

    const fake = (() => {
      try {
        return (JSON.parse(t.settings_json ?? '{}') as { mock?: boolean }).mock === true
      } catch {
        return false
      }
    })()
    const offline = this.d.mock() || fake || !t.account_mode || t.account_mode === 'dry_run'
    if (!offline) {
      if (platform === 'youtube') {
        if (t.account_id === null) throw new Error('No YouTube account is linked to this video.')
        await this.d.youtubeUpdate(t.account_id, t.external_id, clean)
      } else if (platform === 'facebook')
        await this.d.facebookUpdate(t.brand_id, t.account_id, t.external_id, clean)
    }
    // Keep our own copy in step with what is live.
    if (clean.description !== undefined)
      this.d.db
        .prepare('UPDATE post_targets SET caption_override = ? WHERE id = ?')
        .run(clean.description, t.id)
    if (clean.title !== undefined && platform === 'youtube')
      this.d.db.prepare('UPDATE posts SET title = ? WHERE id = ?').run(clean.title, postId)
    this.d.log(
      `Edited the live ${platform} video for post ${postId}: ${Object.keys(clean).join(', ')}.`,
    )
    return offline
      ? 'Saved here. This post is a test or mock post, so nothing was changed on the platform.'
      : 'Changed on the platform.'
  }
}
