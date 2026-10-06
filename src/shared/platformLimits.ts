// Every platform number lives here. Verified against official docs, see CHANGELOG.md.
export type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok'

export const PLATFORMS: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok']

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
}

export const PLATFORM_LIMITS = {
  youtube: { minSeconds: 0, maxSeconds: 180, titleMax: 100, descriptionMax: 5000 },
  facebook: { minSeconds: 3, maxSeconds: 90 },
  instagram: { minSeconds: 3, maxSeconds: 900, captionMax: 2200, hashtagsMax: 30 },
  // TikTok max duration comes from creator_info at post time; this is a loose default.
  tiktok: { minSeconds: 1, maxSeconds: 600, captionMax: 2200 },
} as const

export const ASPECT_TARGET = 9 / 16
export const ASPECT_TOLERANCE = 0.03
export const RECOMMENDED_VIDEO_CODEC = 'h264'
export const RECOMMENDED_AUDIO_CODEC = 'aac'
export const ACCEPTED_EXTENSIONS = ['.mp4', '.mov']
export const SOFT_WARN_POSTS_PER_BRAND_PER_DAY = 4

export interface VideoMeta {
  durationSeconds: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
  sizeBytes: number
  fps: number
  container: string
}

export interface ValidationWarning {
  platform: Platform | 'all'
  message: string
}

export function validateVideo(meta: VideoMeta, fileName: string): ValidationWarning[] {
  const out: ValidationWarning[] = []
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    out.push({ platform: 'all', message: `Container ${ext || 'unknown'} is not MP4 or MOV.` })
  }
  if (meta.videoCodec !== RECOMMENDED_VIDEO_CODEC) {
    out.push({
      platform: 'all',
      message: `Video codec is ${meta.videoCodec}. H.264 is recommended.`,
    })
  }
  if (meta.audioCodec && meta.audioCodec !== RECOMMENDED_AUDIO_CODEC) {
    out.push({ platform: 'all', message: `Audio codec is ${meta.audioCodec}. AAC is recommended.` })
  }
  if (meta.width > 0 && meta.height > 0) {
    const ratio = meta.width / meta.height
    if (Math.abs(ratio - ASPECT_TARGET) > ASPECT_TOLERANCE) {
      out.push({
        platform: 'all',
        message: `Video is ${meta.width}x${meta.height}. Vertical 9:16 is expected.`,
      })
    }
  }
  const d = meta.durationSeconds
  const fb = PLATFORM_LIMITS.facebook
  if (d < fb.minSeconds || d > fb.maxSeconds) {
    out.push({
      platform: 'facebook',
      message: `Facebook Reels must be ${fb.minSeconds} to ${fb.maxSeconds} seconds. This is ${d.toFixed(1)}.`,
    })
  }
  if (d > PLATFORM_LIMITS.youtube.maxSeconds) {
    out.push({
      platform: 'youtube',
      message: `YouTube Shorts treatment needs ${PLATFORM_LIMITS.youtube.maxSeconds / 60} minutes or less.`,
    })
  }
  const ig = PLATFORM_LIMITS.instagram
  if (d < ig.minSeconds || d > ig.maxSeconds) {
    out.push({
      platform: 'instagram',
      message: `Instagram Reels must be ${ig.minSeconds} seconds to ${ig.maxSeconds / 60} minutes.`,
    })
  }
  return out
}

export interface CounterInfo {
  label: string
  count: number
  max: number
  over: boolean
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[^\s#]+/g) ?? []).length
}

export function captionCounters(title: string, caption: string): Record<Platform, CounterInfo[]> {
  const yt = PLATFORM_LIMITS.youtube
  const ig = PLATFORM_LIMITS.instagram
  const tt = PLATFORM_LIMITS.tiktok
  const c = (label: string, count: number, max: number): CounterInfo => ({
    label,
    count,
    max,
    over: count > max,
  })
  return {
    youtube: [
      c('Title', title.length, yt.titleMax),
      c('Description', caption.length, yt.descriptionMax),
    ],
    facebook: [],
    instagram: [
      c('Caption', caption.length, ig.captionMax),
      c('Hashtags', countHashtags(caption), ig.hashtagsMax),
    ],
    tiktok: [c('Caption', caption.length, tt.captionMax)],
  }
}
