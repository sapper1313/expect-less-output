import type { TikTokCreatorInfo, TikTokPostSettings } from './types'

export const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
}

export const MUSIC_USAGE_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
export const BRANDED_CONTENT_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en'

/** Nothing is pre-selected. TikTok's guidelines require the owner to choose. */
export function emptyTikTokSettings(): TikTokPostSettings {
  return {
    privacy: null,
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    commercialOn: false,
    yourBrand: false,
    brandedContent: false,
    consent: false,
  }
}

export type ConsentKind = 'music' | 'branded'

/** Which policies the consent line must name, from the commercial content choices. */
export function consentKind(s: TikTokPostSettings): ConsentKind {
  return s.commercialOn && s.brandedContent ? 'branded' : 'music'
}

/** The label TikTok will put on the video, shown under the commercial content choices. */
export function commercialNotice(s: TikTokPostSettings): string | null {
  if (!s.commercialOn) return null
  if (s.brandedContent) return 'Your video will be labeled as "Paid partnership"'
  if (s.yourBrand) return 'Your video will be labeled as "Promotional content"'
  return null
}

/**
 * Returns a plain message for the first thing wrong with a Direct Post, or null when it is ready.
 * Used by the posting screen, when scheduling, and again right before publishing.
 */
export function tiktokSettingsProblem(
  s: TikTokPostSettings | undefined | null,
  info: TikTokCreatorInfo | null,
  durationSeconds: number,
): string | null {
  if (!s) return 'Choose the TikTok privacy and settings first.'
  if (!s.privacy) return 'Choose who can see this TikTok video. There is no default.'
  if (info && !info.privacyOptions.includes(s.privacy)) {
    return 'The privacy choice is no longer available for this TikTok account. Pick again.'
  }
  if (s.commercialOn && !s.yourBrand && !s.brandedContent) {
    return 'You need to indicate if your content promotes yourself, a third party, or both.'
  }
  if (s.commercialOn && s.brandedContent && s.privacy === 'SELF_ONLY') {
    return 'Branded content visibility cannot be set to private.'
  }
  if (info) {
    if (s.allowComment && info.commentDisabled)
      return 'Comments are turned off for this TikTok account.'
    if (s.allowDuet && info.duetDisabled) return 'Duet is turned off for this TikTok account.'
    if (s.allowStitch && info.stitchDisabled) return 'Stitch is turned off for this TikTok account.'
    if (info.maxDurationSec && durationSeconds > info.maxDurationSec) {
      return `This video is ${durationSeconds.toFixed(0)} seconds. This TikTok account can post up to ${info.maxDurationSec} seconds.`
    }
  }
  if (!s.consent) return 'Tick the TikTok consent line before posting.'
  return null
}
