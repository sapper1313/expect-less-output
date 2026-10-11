export interface EditPatch {
  title?: string
  description?: string
  tags?: string[]
}

export interface EditCapability {
  canEdit: boolean
  fields: Array<'title' | 'description' | 'tags'>
  /** Plain words for the owner. */
  note: string
}

/** What each platform lets you change after a video is live. Based on each platform's own API. */
export const EDIT_CAPABILITY: Record<string, EditCapability> = {
  youtube: {
    canEdit: true,
    fields: ['title', 'description', 'tags'],
    note: 'You can change the title, description and tags. The video itself stays the same.',
  },
  facebook: {
    canEdit: true,
    fields: ['title', 'description'],
    note: 'You can change the title and the text of a Page video.',
  },
  instagram: {
    canEdit: false,
    fields: [],
    note: 'Instagram does not let any app change a caption after posting. Edit it in the Instagram app, or delete and post again.',
  },
  tiktok: {
    canEdit: false,
    fields: [],
    note: 'TikTok does not let any app change a post after it is live. Edit it in the TikTok app.',
  },
  bluesky: {
    canEdit: false,
    fields: [],
    note: 'Bluesky posts cannot be edited. To fix one you delete it and post again.',
  },
}
