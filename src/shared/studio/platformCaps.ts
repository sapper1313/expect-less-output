/**
 * What each platform allows. Filled from the official docs read on 2026-10-09 and editable in Settings, under the Studio tab.
 * Where a number could not be confirmed it is marked in `notes` and the Publisher also checks live where an API
 * exists (Bluesky getUploadLimits, TikTok creator_info).
 */
export type CapKey = 'youtube_long' | 'youtube_shorts' | 'instagram_reels' | 'facebook_reels' | 'tiktok' | 'bluesky'

export type CoverSupport = 'custom_upload' | 'frame_select' | 'auto_frame' | 'cover_url_or_frame' | 'none'

export interface PlatformCap {
  label: string
  formats: string[]
  /** Allowed width divided by height, as a [min, max] range. */
  aspect: [number, number]
  maxDurationSeconds: number
  minDurationSeconds: number
  maxFileMB: number
  titleMax: number | null
  /** Caption, description or post text. */
  textMax: number
  hashtagsMax: number | null
  /** What the platform does with hashtags, for the writer. */
  hashtagNote: string
  cover: CoverSupport
  /** Thumbnail size, when the platform takes a custom image. */
  thumbSize: { width: number; height: number; maxMB: number } | null
  comments: boolean
  notes: string
}

export const DEFAULT_PLATFORM_CAPS: Record<CapKey, PlatformCap> = {
  youtube_long: {
    label: 'YouTube (long form)',
    formats: ['mp4', 'mov'],
    aspect: [1.2, 2.4],
    maxDurationSeconds: 43_200,
    minDurationSeconds: 0,
    maxFileMB: 262_144,
    titleMax: 100,
    textMax: 5000,
    hashtagsMax: 15,
    hashtagNote: 'Up to 3 hashtags show above the title. More than 15 are ignored.',
    cover: 'custom_upload',
    thumbSize: { width: 1280, height: 720, maxMB: 2 },
    comments: true,
    notes: 'thumbnails.set needs a verified channel. The API accepts up to 50 MB, the 2 MB guideline is YouTube Help.',
  },
  youtube_shorts: {
    label: 'YouTube Shorts',
    formats: ['mp4', 'mov'],
    aspect: [0.4, 1.01],
    maxDurationSeconds: 180,
    minDurationSeconds: 0,
    maxFileMB: 262_144,
    titleMax: 100,
    textMax: 5000,
    hashtagsMax: 15,
    hashtagNote: 'Add #Shorts to the description or title.',
    cover: 'auto_frame',
    thumbSize: null,
    comments: true,
    notes: 'Custom thumbnails are NOT supported through the API. YouTube picks a frame, so the opening frame is designed.',
  },
  instagram_reels: {
    label: 'Instagram Reels',
    formats: ['mp4', 'mov'],
    aspect: [0.4, 1.01],
    maxDurationSeconds: 900,
    minDurationSeconds: 3,
    maxFileMB: 1024,
    titleMax: null,
    textMax: 2200,
    hashtagsMax: 30,
    hashtagNote: 'Up to 30 hashtags. 3 to 5 work best.',
    cover: 'cover_url_or_frame',
    thumbSize: { width: 1080, height: 1920, maxMB: 8 },
    comments: true,
    notes: 'cover_url needs a public address, else thumb_offset picks a frame. The profile grid shows a centered 1080x1080 square. API publishing limit: 100 per 24 hours (docs also say 50 for carousels).',
  },
  facebook_reels: {
    label: 'Facebook Reels',
    formats: ['mp4', 'mov'],
    aspect: [0.4, 1.01],
    maxDurationSeconds: 90,
    minDurationSeconds: 3,
    maxFileMB: 1024,
    titleMax: null,
    textMax: 2200,
    hashtagsMax: 30,
    hashtagNote: 'A few relevant hashtags.',
    cover: 'auto_frame',
    thumbSize: null,
    comments: true,
    notes: 'Cover upload through the API was not confirmed. 30 API Reels per Page per 24 hours.',
  },
  tiktok: {
    label: 'TikTok',
    formats: ['mp4', 'mov'],
    aspect: [0.4, 1.01],
    maxDurationSeconds: 600,
    minDurationSeconds: 1,
    maxFileMB: 4096,
    titleMax: null,
    textMax: 2200,
    hashtagsMax: null,
    hashtagNote: 'Hashtags go in the caption, separated by spaces.',
    cover: 'frame_select',
    thumbSize: null,
    comments: false,
    notes: 'Cover is a frame only, video_cover_timestamp_ms, Direct Post only. The real maximum length comes from creator_info at post time. The Content Posting API has no comment endpoints.',
  },
  bluesky: {
    label: 'Bluesky',
    formats: ['mp4'],
    aspect: [0.1, 10],
    maxDurationSeconds: 600,
    minDurationSeconds: 1,
    maxFileMB: 300,
    titleMax: null,
    textMax: 300,
    hashtagsMax: null,
    hashtagNote: 'Hashtags count toward the 300 character limit.',
    cover: 'none',
    thumbSize: null,
    comments: true,
    notes: 'Limits were raised in 2026 (reported as 10 minutes and 300 MB). The Publisher reads app.bsky.video.getUploadLimits for the live daily allowance. Account email must be verified.',
  },
}

export interface CapProblem {
  platform: string
  reason: string
}

/** Which capability row applies to a studio platform for a given brand format and video shape. */
export function capKeyFor(platform: string, isShort: boolean): CapKey | null {
  if (platform === 'youtube') return isShort ? 'youtube_shorts' : 'youtube_long'
  if (platform === 'instagram') return 'instagram_reels'
  if (platform === 'facebook') return 'facebook_reels'
  if (platform === 'tiktok' || platform === 'bluesky') return platform
  return null
}

/** Does this video fit the platform? Returns a plain reason when it does not. */
export function limitProblem(
  cap: PlatformCap,
  video: { durationSeconds: number; width: number; height: number; sizeBytes: number },
): string | null {
  if (video.durationSeconds > cap.maxDurationSeconds)
    return `${cap.label} allows ${cap.maxDurationSeconds} seconds at most. This video is ${Math.round(video.durationSeconds)}.`
  if (video.durationSeconds < cap.minDurationSeconds)
    return `${cap.label} needs at least ${cap.minDurationSeconds} seconds. This video is ${video.durationSeconds.toFixed(1)}.`
  if (video.sizeBytes > cap.maxFileMB * 1024 * 1024)
    return `${cap.label} allows ${cap.maxFileMB} MB at most. This file is ${Math.round(video.sizeBytes / 1024 / 1024)} MB.`
  const ratio = video.width / (video.height || 1)
  if (ratio < cap.aspect[0] || ratio > cap.aspect[1])
    return `${cap.label} does not take this shape (${video.width}x${video.height}).`
  return null
}

export const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu

export function hashtagCount(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length
}
