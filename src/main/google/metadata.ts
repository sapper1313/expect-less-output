import { AdapterError } from '../adapters/types'
import { PLATFORM_LIMITS } from '@shared/platformLimits'

export interface MetadataInput {
  title: string
  caption: string
  categoryId: string
  madeForKids: boolean
  aiFlag: boolean
  appendShorts: boolean
  privacy: 'private' | 'public'
  /** RFC 3339 UTC. Only valid with privacy private. */
  publishAt?: string
}

export interface VideoMetadata {
  snippet: { title: string; description: string; tags: string[]; categoryId: string }
  status: {
    privacyStatus: 'private' | 'public'
    selfDeclaredMadeForKids: boolean
    containsSyntheticMedia: boolean
    publishAt?: string
  }
}

const TAG_TOTAL_LIMIT = 480

/** Hashtags found in the description, without the # symbol, de-duplicated, within YouTube's tag size limit. */
export function tagsFromText(text: string): string[] {
  const found = (text.match(/(?:^|\s)#([\p{L}\p{N}_]+)/gu) ?? []).map((m) => m.trim().slice(1))
  const seen = new Set<string>()
  const out: string[] = []
  let total = 0
  for (const t of found) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    if (total + t.length + 1 > TAG_TOTAL_LIMIT) break
    seen.add(key)
    out.push(t)
    total += t.length + 1
  }
  return out
}

export function buildVideoMetadata(i: MetadataInput): VideoMetadata {
  const title = i.title.trim()
  if (!title)
    throw new AdapterError('The YouTube title is empty. Add a title and retry.', 'permanent')
  if (title.length > PLATFORM_LIMITS.youtube.titleMax) {
    throw new AdapterError(
      `The YouTube title is ${title.length} characters. The limit is ${PLATFORM_LIMITS.youtube.titleMax}.`,
      'permanent',
    )
  }
  if (/[<>]/.test(title)) {
    throw new AdapterError(
      'YouTube does not allow the characters < and > in a title. Remove them and retry.',
      'permanent',
    )
  }
  let description = i.caption.trim()
  if (i.appendShorts && !/#shorts\b/i.test(description))
    description = `${description}${description ? '\n\n' : ''}#Shorts`
  if (description.length > PLATFORM_LIMITS.youtube.descriptionMax) {
    throw new AdapterError(
      `The YouTube description is ${description.length} characters. The limit is ${PLATFORM_LIMITS.youtube.descriptionMax}.`,
      'permanent',
    )
  }
  if (/[<>]/.test(description)) {
    throw new AdapterError(
      'YouTube does not allow the characters < and > in a description. Remove them and retry.',
      'permanent',
    )
  }
  if (i.publishAt && i.privacy !== 'private') {
    throw new AdapterError('A scheduled YouTube video must start as private.', 'permanent')
  }
  const meta: VideoMetadata = {
    snippet: { title, description, tags: tagsFromText(description), categoryId: i.categoryId },
    status: {
      privacyStatus: i.privacy,
      selfDeclaredMadeForKids: i.madeForKids,
      containsSyntheticMedia: i.aiFlag,
    },
  }
  if (i.publishAt) meta.status.publishAt = new Date(i.publishAt).toISOString()
  return meta
}
