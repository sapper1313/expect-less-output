// The one description of the agent API. Requests are validated with these schemas, the OpenAPI file and the
// MCP tools are generated from them, so none of the three can drift apart.
import { z } from 'zod'
import { DateTime } from 'luxon'
import { UPCOMING_STATUSES, UpcomingEntry } from './upcoming'

export const PlatformEnum = z.enum([
  'youtube',
  'facebook',
  'instagram',
  'tiktok',
  'bluesky',
  'x',
  'linkedin',
  'pinterest',
])
export const PostStatusEnum = z.enum([
  'draft',
  'scheduled',
  'in_progress',
  'partial',
  'posted',
  'failed',
  'missed',
  'canceled',
])

const ZONE_RE = /(Z|[+-]\d{2}:\d{2})$/i

/** A time with an explicit zone, for example 2026-06-02T17:00:00-04:00 or 2026-06-02T21:00:00Z. */
export const ZonedTime = z
  .string()
  .regex(
    ZONE_RE,
    'Give the time with a zone, for example 2026-06-02T17:00:00-04:00 or 2026-06-02T21:00:00Z. Times without a zone are rejected.',
  )
  .refine(
    (s) => DateTime.fromISO(s, { setZone: true }).isValid,
    'That is not a valid date and time.',
  )
  .meta({
    description: 'ISO 8601 date and time WITH a zone offset or Z.',
    example: '2026-06-02T17:00:00-04:00',
  })

const id = z.coerce.number().int().positive()
const platformMap = <T extends z.ZodType>(v: T) => z.partialRecord(PlatformEnum, v)

// ---------- shared pieces ----------

export const TikTokInput = z
  .object({
    privacy: z.string().optional().meta({
      description:
        'One of the privacy options TikTok allows for the account, for example SELF_ONLY or PUBLIC_TO_EVERYONE.',
    }),
    allow_comment: z.boolean().optional(),
    allow_duet: z.boolean().optional(),
    allow_stitch: z.boolean().optional(),
    commercial_content: z
      .object({ your_brand: z.boolean().optional(), branded_content: z.boolean().optional() })
      .strict()
      .optional(),
    consent: z.boolean().optional().meta({
      description:
        "True only if the owner has agreed to TikTok's consent line (Music Usage Confirmation). Do not set this on the owner's behalf.",
    }),
  })
  .strict()
  .meta({ description: 'Choices for a TikTok Direct Post. Not needed for Drafts mode.' })

export const CreatePostBody = z
  .object({
    brand_id: id.meta({ description: 'Brand to post for. See GET /v1/brands.' }),
    file_path: z.string().min(1).meta({
      description:
        'Absolute path to an .mp4 or .mov file on this Mac. It is COPIED into the brand Queue folder. The original is never moved or deleted.',
    }),
    title: z
      .string()
      .max(200)
      .optional()
      .meta({ description: 'Defaults to the file name, cleaned up.' }),
    caption: z.string().max(5000).optional().meta({
      description:
        "Shared caption. Defaults to the brand's caption template filled in with the title and the default hashtag set.",
    }),
    platforms: z
      .array(PlatformEnum)
      .min(1)
      .optional()
      .meta({ description: 'Defaults to every platform that is connected for the brand.' }),
    caption_overrides: platformMap(z.string())
      .optional()
      .meta({ description: 'Per-platform caption that replaces the shared one.' }),
    ai_flags: platformMap(z.boolean()).optional().meta({
      description: "AI-generated disclosure per platform. Defaults to the brand's defaults.",
    }),
    first_comment: z.string().max(2000).optional().meta({
      description:
        'A question or call to action posted as the first comment once the video is live. Uses Upload-Post, so the platform must be ticked on the Upload-Post card for the channel. Instagram cannot take one. YouTube already posts pinned_comment itself, so it skips this one when both are sent.',
    }),
    products: z
      .array(
        z.object({
          asin: z.string().regex(/^[A-Za-z0-9]{10}$/).meta({ description: 'The Amazon ASIN, 10 letters and numbers.' }),
          name: z.string().min(1).max(70).meta({ description: 'Short display name, written by the desk. Not copied Amazon text.' }),
          note: z.string().max(240).default('').meta({ description: 'One plain sentence on why it is in this video\'s list.' }),
        }),
      )
      .max(5)
      .optional()
      .meta({
        description:
          'Amazon picks for this video, 0 to 5. ELO builds each link from the ASIN and the channel tracking id, makes the list page on the website and adds the lines to the description. Nobody types a link.',
      }),
    first_comments: platformMap(z.string().max(2000)).optional().meta({
      description: 'A first comment for one platform. It replaces first_comment for that platform.',
    }),
    tiktok: TikTokInput.optional(),
    thumb_offset_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .meta({ description: 'Instagram cover frame, milliseconds from the start.' }),
    scheduled_at: ZonedTime.optional().meta({
      description:
        'An exact date and time for every platform, with a UTC offset. It is used as it is, on or off a posting slot, and must be in the future.',
    }),
    platform_times: platformMap(ZonedTime).optional().meta({
      description:
        'An exact time for one platform. A platform left out uses scheduled_at, or (with neither) its own first open slot.',
    }),
    next_slot: z.boolean().optional().meta({
      description:
        "Every platform takes its own next open slot. This is also what status scheduled does when no time is given. Not allowed while agents are limited to drafts.",
    }),
    status: z.enum(['draft', 'scheduled']).default('draft').meta({
      description:
        'draft (default) or scheduled. Scheduled with no scheduled_at or platform_times goes to the first open slot of every platform. Scheduled is refused with 403 while agents are limited to drafts.',
    }),
  })
  .strict()
  .refine((b) => !(b.scheduled_at && b.next_slot), {
    message: 'Use scheduled_at or next_slot, not both.',
    path: ['next_slot'],
  })
  .refine((b) => !(b.next_slot && b.platform_times), {
    message: 'Use platform_times or next_slot, not both.',
    path: ['next_slot'],
  })

export const UpdatePostBody = z
  .object({
    title: z.string().max(200).optional(),
    caption: z.string().max(5000).optional(),
    platforms: z.array(PlatformEnum).min(1).optional(),
    caption_overrides: platformMap(z.string()).optional(),
    first_comment: z.string().max(2000).nullable().optional(),
    first_comments: platformMap(z.string().max(2000)).optional(),
    ai_flags: platformMap(z.boolean()).optional(),
    tiktok: TikTokInput.optional(),
    thumb_offset_ms: z.number().int().min(0).optional(),
    scheduled_at: ZonedTime.nullable()
      .optional()
      .meta({
        description:
          'New time for every platform that is still waiting, or null to clear it. Used as it is, on or off a slot.',
      }),
    platform_times: platformMap(ZonedTime).optional().meta({
      description: 'A new exact time for one platform. The others keep their own times.',
    }),
    status: z.enum(['draft', 'scheduled']).optional().meta({
      description: 'Changing to scheduled is refused with 403 while agents are limited to drafts.',
    }),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' })

export const ListPostsQuery = z.object({
  brand_id: id.optional(),
  status: PostStatusEnum.optional(),
  from: ZonedTime.optional(),
  to: ZonedTime.optional(),
  search: z.string().max(200).optional(),
  origin: z.enum(['manual', 'inbox', 'api']).optional().meta({
    description: 'inbox lists the posts that arrived through an Inbox folder (bot drops).',
  }),
  post_type: z.enum(['episode', 'clip']).optional(),
  past_due: z.enum(['true', 'false']).optional().meta({
    description:
      'true lists scheduled posts whose time has passed and that have not posted (missed slots).',
  }),
  held: z.enum(['true', 'false']).optional().meta({
    description: 'true lists only posts held back from posting. false leaves them out.',
  }),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const NextOpenQuery = z
  .object({
    brand_id: id.optional(),
    channel: z.string().min(1).optional().meta({
      description: 'The channel slug, for example clock-out-early. Use this or brand_id.',
    }),
    count: z.coerce.number().int().min(1).max(60).default(3),
    days: z.coerce.number().int().min(1).max(60).optional().meta({
      description: 'Only slots in the next N days (the most that fit in count).',
    }),
    from: ZonedTime.optional().meta({
      description: 'Start looking after this time. Defaults to now.',
    }),
    platform: PlatformEnum.optional().meta({
      description:
        'Only that platform\'s own open times. Each platform of a channel has its own weekday and weekend times. Left out, any time one of the channel\'s platforms can use.',
    }),
  })
  .refine((q) => q.brand_id !== undefined || q.channel !== undefined, {
    message: 'Give brand_id or channel.',
    path: ['channel'],
  })

export const CalendarQuery = z.object({
  brand_id: id.optional(),
  from: ZonedTime.optional(),
  to: ZonedTime.optional(),
})
export const ActivityQuery = z.object({
  since: ZonedTime.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})
export const IdParams = z.object({ id })

// ---------- ELS Ventures: Etsy draft listings ----------
// There is deliberately no `state` field: a draft stays a draft until a person activates it on Etsy.
// Etsy accepts letters, digits, spaces, hyphens, apostrophes and a few marks in tags. A comma would split one tag in two.
const tag = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[\p{L}\p{Nd}\p{Zs}\-'\u2122\u00a9\u00ae]+$/u, 'Tags can use letters, numbers, spaces, hyphens and apostrophes.')
const draftFields = {
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(10000),
  tags: z.array(tag).max(13),
  priceCents: z.number().int().min(20).max(100_000_00),
  images: z.array(z.string().min(1).max(1000)).max(10),
  digitalFile: z.string().min(1).max(1000).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  taxonomyId: z.number().int().min(1).optional(),
  shippingProfileId: z.number().int().min(1).optional(),
}
export const DraftListingBody = z
  .object({ ...draftFields, tags: draftFields.tags.default([]), images: draftFields.images.default([]) })
  .strict()
// Pictures and the digital file are set when the draft is made. Changing them later is done on Etsy.
export const UpdateDraftBody = z
  .object({
    title: draftFields.title,
    description: draftFields.description,
    tags: draftFields.tags,
    priceCents: draftFields.priceCents,
    quantity: draftFields.quantity,
    taxonomyId: draftFields.taxonomyId,
    shippingProfileId: draftFields.shippingProfileId,
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' })
export const DraftParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) })
export const DraftOut = z.object({ id: z.string(), state: z.literal('draft'), pending: z.boolean() })
export type DraftListingInput = z.infer<typeof DraftListingBody>
export type UpdateDraftInput = z.infer<typeof UpdateDraftBody>

// ---------- responses ----------

export const ErrorBody = z.object({
  error: z.object({
    code: z.enum([
      'unauthorized',
      'forbidden',
      'drafts_only',
      'studio_locked',
      'not_found',
      'validation',
      'bad_request',
      'conflict',
      'method_not_allowed',
      'server_error',
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

const SlotOut = z.object({
  day_type: z.enum(['weekday', 'weekend']),
  time_local: z.string().meta({ example: '17:00' }),
  enabled: z.boolean(),
})

export const BrandOut = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z
    .string()
    .nullable()
    .meta({ description: 'Short stable name bots use for the channel, like clock-out-early.' }),
  color: z.string(),
  archived: z.boolean(),
  paused: z.boolean(),
  state: z.enum(['active', 'paused', 'on-hold', 'archived']).meta({
    description:
      'active may be scheduled. paused is temporarily not posting. on-hold is not scheduling while a decision is made. archived is permanently out of service. archived beats on-hold beats paused.',
  }),
  on_hold: z.boolean(),
  clip_post_days: z.array(z.number().int()).meta({
    description: 'Weekdays clips post, 1 = Monday to 7 = Sunday. Empty means no clip slots.',
  }),
  clip_time: z.string().meta({ description: 'Time of day clips post, Eastern, HH:MM.' }),
  clip_platforms: z.array(z.string()).meta({ description: 'Platforms clips go to by default.' }),
  post_days: z.array(z.number().int()).nullable().meta({
    description: 'Weekdays a post may land on, 1 = Monday to 7 = Sunday. Null means every day.',
  }),
  daily_cap: z
    .number()
    .int()
    .meta({ description: 'Most posts a day for this channel. 0 means no limit.' }),
  blackout_dates: z
    .array(z.string())
    .meta({ description: 'Dates (Eastern) this channel never posts, plus the global ones.' }),
  aliases: z.array(z.string()).meta({ description: 'Old names that map to this slug.' }),
  inbox_enabled: z.boolean(),
  slots: z.array(SlotOut).meta({
    description:
      'The channel combined posting times, in Eastern time (the earliest time of each position across platforms). Use platform_slots for each platform.',
  }),
  platform_slots: z
    .array(
      z.object({
        platform: PlatformEnum,
        kind: z.enum(['short', 'long']),
        day_type: z.enum(['weekday', 'weekend']),
        time_local: z.string().meta({ description: 'HH:MM Eastern.' }),
        enabled: z.boolean(),
      }),
    )
    .meta({ description: 'Posting times for each platform and kind. Each platform has its own.' }),
  defaults: z.object({
    caption_template: z.string(),
    default_hashtags: z.string(),
    youtube_category_id: z.string(),
    youtube_made_for_kids: z.boolean(),
    youtube_append_shorts: z.boolean(),
    instagram_share_to_feed: z.boolean(),
    ai_flags: z.record(z.string(), z.boolean()),
  }),
  hashtag_sets: z.array(z.object({ id: z.number().int(), name: z.string(), tags: z.string() })),
  platforms: z.array(
    z.object({
      platform: PlatformEnum,
      connected: z.boolean().meta({
        description: 'True when a real account is connected. False means a dry run placeholder.',
      }),
      mode: z.string(),
      account_name: z.string().nullable(),
      needs_reauth: z.boolean(),
    }),
  ),
})

const TargetOut = z.object({
  id: z.number().int(),
  platform: PlatformEnum,
  status: z.string(),
  caption_override: z.string().nullable(),
  ai_flag: z.boolean(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  external_url: z.string().nullable(),
  progress: z.number().nullable(),
  scheduled_at: z.string().nullable().meta({ description: 'When this platform posts (UTC). Each platform has its own time.' }),
})

export const PostOut = z.object({
  id: z.number().int(),
  brand_id: z.number().int(),
  brand_name: z.string(),
  title: z.string(),
  caption: z.string(),
  status: PostStatusEnum,
  scheduled_at: z.string().nullable().meta({ description: 'UTC.' }),
  scheduled_at_eastern: z.string().nullable(),
  file_name: z.string(),
  duration_seconds: z.number().nullable(),
  post_type: z
    .enum(['episode', 'clip'])
    .meta({ description: 'clip is a short vertical clip with its own schedule.' }),
  source_episode_id: z
    .string()
    .nullable()
    .meta({ description: 'For a clip: the episode it was cut from.' }),
  related_video: z
    .object({ episode_id: z.string(), url: z.string().nullable(), done: z.boolean() })
    .nullable()
    .meta({
      description:
        'For a clip with a YouTube Short: the Related video to set by hand in YouTube Studio (the YouTube API cannot). url is the episode link, or null until it is live.',
    }),
  origin: z.enum(['manual', 'inbox', 'api']),
  episode_id: z
    .string()
    .nullable()
    .meta({ description: 'The id a bot gave this episode (pipeline posts).' }),
  source_bot: z.string().nullable(),
  hold_reason: z.string().nullable().meta({ description: 'Why the post is held back, or null.' }),
  targets: z.array(TargetOut),
  warnings: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const NextOpenOut = z.object({
  brand_id: z.number().int(),
  channel: z.string().nullable(),
  slots: z.array(z.object({ at: z.string().meta({ description: 'UTC' }), eastern: z.string() })),
})

export const CalendarOut = z.object({
  events: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      brand_id: z.number().int(),
      brand_name: z.string(),
      start: z.string(),
      status: PostStatusEnum,
      platforms: z.array(z.object({ platform: PlatformEnum, status: z.string() })),
    }),
  ),
})

export const ActivityOut = z.object({
  entries: z.array(
    z.object({
      id: z.number().int(),
      at: z.string(),
      level: z.enum(['info', 'warn', 'error']),
      message: z.string(),
      post_id: z.number().int().nullable(),
      platform: z.string().nullable(),
    }),
  ),
})

export const HealthOut = z.object({
  app_version: z.string(),
  scheduler: z.object({
    running: z.boolean(),
    paused: z.boolean(),
    pending_posts: z.number().int(),
    next_post: z
      .object({ post_id: z.number().int(), brand: z.string(), title: z.string(), at: z.string() })
      .nullable(),
  }),
  agents: z.object({ drafts_only: z.boolean() }),
  accounts: z.array(
    z.object({
      brand: z.string(),
      platform: PlatformEnum,
      account: z.string().nullable(),
      status: z.string(),
      mode: z.string(),
      last_checked_at: z.string().nullable(),
      login_expires_at: z.string().nullable(),
    }),
  ),
  youtube_quota: z.object({
    uploads_used: z.number().int(),
    uploads_limit: z.number().int(),
    other_used: z.number().int(),
    other_limit: z.number().int(),
  }),
})

export const ResubmitBody = z.object({
  platform: PlatformEnum.meta({ description: 'The platform entry to send again.' }),
})
export const ResubmitOut = z.object({ post: PostOut, resubmitted_target: z.number().int() })

export const RetryOut = z.object({ post: PostOut, retried_targets: z.array(z.number().int()) })

export type CreatePostInput = z.infer<typeof CreatePostBody>
export type UpdatePostInput = z.infer<typeof UpdatePostBody>

// ---------- stats ----------

const StatNumbersOut = z.object({
  views: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  comments: z.number().int().nullable(),
  shares: z.number().int().nullable(),
})

export const BrandStatsQuery = z.object({
  range: z.enum(['7d', '30d']).default('7d'),
})

export const PostStatsOut = z.object({
  post_id: z.number().int(),
  targets: z.array(
    z.object({
      platform: PlatformEnum,
      state: z.enum(['ok', 'unavailable', 'pending']).meta({
        description:
          'ok means numbers are present. unavailable means the platform gave none (see reason). pending means not read yet.',
      }),
      reason: z.string().nullable(),
      fetched_at: z.string().nullable(),
      approximate: z.array(z.string()),
      numbers: StatNumbersOut,
    }),
  ),
  totals: StatNumbersOut,
})

export const BrandStatsOut = z.object({
  brand_id: z.number().int(),
  range: z.enum(['7d', '30d']),
  posts: z.number().int(),
  platforms: z.array(
    StatNumbersOut.extend({
      platform: PlatformEnum,
      videos: z.number().int(),
      unavailable: z.number().int(),
      reason: z.string().nullable(),
    }),
  ),
  totals: StatNumbersOut,
})

// ---------- studio library (read only, for Grok Bot and other agents) ----------

export const EpisodeStatusEnum = z.enum([
  'Idea',
  'Written',
  'Checking',
  'Ready for production',
  'In production',
  'Awaiting video',
  'Video received',
  'Checking video',
  'Scheduled',
  'Posted',
  'Flagged',
  'Failed',
  'Archived',
])

export const EpisodeIdParams = z.object({
  id: z
    .string()
    .min(1)
    .meta({ description: 'Episode id, for example wonder-hollow-workshop-2026-0003.' }),
})

export const ListEpisodesQuery = z.object({
  brand_id: id.optional(),
  status: EpisodeStatusEnum.optional().meta({
    description:
      'Wonder Hollow episodes ready for you to produce have status "Ready for production".',
  }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const EpisodeSummaryOut = z.object({
  id: z.string(),
  brand_id: z.number().int(),
  brand_name: z.string(),
  series: z.string(),
  episode_number: z.number().int(),
  title: z.string(),
  summary: z.string(),
  status: EpisodeStatusEnum,
  slot_date: z.string().nullable(),
  updated_at: z.string(),
})

export const EpisodesOut = z.object({ episodes: z.array(EpisodeSummaryOut) })

export const EpisodeOut = z.object({
  episode: EpisodeSummaryOut,
  package: z.record(z.string(), z.unknown()).nullable().meta({
    description:
      'The full episode package: scenes with grok_prompt, dialogue, counted objects, YouTube title and description, thumbnail brief. When the finished video is ready, put a video_url and a JSON file with episode_id in the brand Inbox folder.',
  }),
})

// ---------- studio ----------

const CapAmount = z.number().min(0).max(9999).nullable().meta({
  description: 'Dollars per month (0 to 9999). null means no cap.',
})

export const SetStudioCapsBody = z
  .object({
    global_monthly: CapAmount.optional(),
    ai_text_monthly: CapAmount.optional(),
    per_episode_default: CapAmount.optional(),
    brands: z
      .array(
        z
          .object({
            brand_id: id,
            monthly: CapAmount.optional(),
            per_episode: CapAmount.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one cap to change.' })

export const StudioSpendOut = z.object({
  month: z.string(),
  total_dollars: z.number(),
  mock_dollars: z.number().meta({ description: 'Simulated spend. It never counts against caps.' }),
  caps: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      limit: z.number().nullable().meta({ description: 'null means no cap.' }),
      spent: z.number(),
      remaining: z.number().nullable(),
    }),
  ),
  by_brand: z.array(
    z.object({
      brand_id: z.number().int().nullable(),
      brand_name: z.string(),
      dollars: z.number(),
    }),
  ),
  by_vendor: z.array(z.object({ vendor: z.string(), dollars: z.number() })),
})

const SkillOut = z.object({ id: z.number().int(), name: z.string(), characters: z.number().int() })

export const SkillsOut = z.object({ skills: z.array(SkillOut) })

export const AddSkillBody = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .meta({ description: 'File name shown in the Bible, for example SKILL.md.' }),
    text: z.string().min(1).max(200000),
  })
  .strict()

export const SkillParams = z.object({ id, skill_id: id })

export const RemoveSkillOut = z.object({
  removed: SkillOut,
  backup_file: z.string().meta({
    description: 'The removed skill was saved here first, so it can be imported again.',
  }),
  skills: z.array(SkillOut),
})

export const FlaggedOut = z.object({
  tasks: z.array(
    z.object({
      task_id: z.number().int(),
      type: z.string(),
      brand_id: z.number().int().nullable(),
      episode_id: z.string().nullable(),
      episode_title: z.string().nullable(),
      status: z.string(),
      attempts: z.number().int(),
      error: z.string().nullable(),
      finished_at: z.string().nullable(),
    }),
  ),
})

export const TaskParams = z.object({ task_id: id })
export const EpisodeParams = z.object({ episode_id: z.string().min(1).max(100) })
export const TaskOut = z.object({ task_id: z.number().int(), ok: z.boolean() })
export const RebuildBody = z
  .object({
    note: z.string().max(2000).optional().meta({
      description: 'What to change when the episode is written again.',
    }),
  })
  .strict()

export const PauseBody = z.object({ paused: z.boolean() }).strict()
export const PauseOut = z.object({ brand_id: z.number().int(), paused: z.boolean() })

// ---------- bot pipeline ----------

export const DropOut = z.object({
  drop_id: z.string(),
  received_at: z.string(),
  source_bot: z.string().nullable(),
  file_name: z.string(),
  file_size: z.number().nullable(),
  sha256: z.string().nullable(),
  channel: z.string().nullable(),
  episode_id: z.string().nullable(),
  title: z.string().nullable(),
  sidecar_valid: z.boolean(),
  result: z.enum(['accepted', 'rejected', 'duplicate', 'held']),
  reason: z.string().nullable(),
  scheduled_slot: z.string().nullable(),
  post_id: z.number().nullable(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  post_type: z.enum(['episode', 'clip']),
  notes: z.string().nullable(),
})

export const ListDropsQuery = z.object({
  channel: z.string().optional(),
  bot: z.string().optional(),
  result: z.enum(['accepted', 'rejected', 'duplicate', 'held']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const ThumbnailBody = z
  .object({
    image_path: z.string().min(1).optional().meta({
      description:
        'Absolute path to a .jpg or .png under 2 MB on this Mac. It is copied next to the post. Not posted yet: it is used when the video uploads. Already inside YouTube or posted: it replaces the live thumbnail with thumbnails.set.',
    }),
    title: z.string().max(200).optional().meta({
      description:
        'A new title, 1 to 100 characters. Only for a post that has not gone out. A video already posted keeps its title.',
    }),
  })
  .strict()

export const ThumbnailOut = z.object({
  post_id: z.number().int(),
  title: z.string(),
  saved_image: z.string().nullable(),
  applied: z.array(
    z.object({
      platform: z.string(),
      how: z.enum(['saved_for_upload', 'set_on_youtube', 'title_updated_on_youtube', 'skipped']),
      detail: z.string(),
    }),
  ),
  notes: z.array(z.string()),
})

export const ReplaceMediaBody = z
  .object({
    file_path: z.string().min(1).optional().meta({
      description:
        'Absolute path to the new .mp4 or .mov. It must fit the channel rules (a clip is 9:16 and 5 to 90 seconds). It is copied into the channel Queue under the episode id. The old file is moved to the channel Replaced folder, never deleted.',
    }),
    checksum: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional()
      .meta({
        description: 'SHA-256 of the new file. If you send it, ELO checks it matches.',
      }),
    title: z.string().max(200).optional().meta({ description: 'New title, 1 to 100 characters.' }),
    description: z.string().max(5000).optional().meta({
      description: 'New description. It replaces the caption on every platform.',
    }),
  })
  .strict()

export const ReplaceMediaOut = z.object({
  post_id: z.number().int(),
  status: z.string(),
  scheduled_at: z.string().nullable().meta({ description: 'Unchanged. The post keeps its slot.' }),
  title: z.string(),
  caption: z.string(),
  file_name: z.string(),
  sha256: z.string(),
  old_sha256: z.string().nullable(),
  old_file_moved_to: z.string(),
  duration_seconds: z.number().nullable(),
})

export const DropParams = z.object({ id: z.string().min(1) })

export const CreateDropBody = z
  .object({
    sidecar: z.record(z.string(), z.unknown()).meta({
      description:
        'The pipeline sidecar (see docs/sidecar.schema.json). Its channel decides the Inbox. It may carry video_url instead of a file.',
    }),
    file_path: z.string().min(1).optional().meta({
      description:
        'Absolute path to the finished .mp4 on this Mac. It is copied into the channel Inbox. The original stays.',
    }),
  })
  .strict()
  .meta({
    description:
      'A drop is the same as putting the video and the sidecar in the channel Inbox. The schedule is whatever is set in the app. A drop never sets, asks for or promises a time.',
  })

export const CreateDropOut = z.object({
  received: z.boolean(),
  drop: DropOut.nullable().meta({
    description:
      'The decision, when it is made by the time the call returns. Otherwise read GET /v1/drops.',
  }),
})

export const ReconcileOut = z.object({
  issues: z.array(
    z.object({
      kind: z.string(),
      channel: z.string().nullable(),
      post_id: z.number().nullable(),
      detail: z.string(),
      first_seen: z.string(),
      last_seen: z.string(),
    }),
  ),
})

// ---------- upcoming episodes ----------

export const UpcomingQuery = z.object({
  channel: z.string().optional(),
  status: z.enum(UPCOMING_STATUSES).optional(),
  source_bot: z
    .string()
    .optional()
    .meta({ description: "A bot name, or josh for the owner's own ideas." }),
  updated_after: ZonedTime.optional().meta({
    description: 'Only entries changed after this time. Cheap polling.',
  }),
})

export const UpcomingParams = z.object({
  channel: z.string().min(1),
  episode_id: z.string().min(1),
})

export const UpcomingOut = z.object({
  revision: z.number().int(),
  updated_at: z.string().nullable(),
  episodes: z.array(UpcomingEntry),
})

const AirDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({ description: 'Planned day, YYYY-MM-DD in Eastern time. Only the production tracker reads it.' })

export const AddUpcomingBody = z
  .object({
    channel: z.string().min(1).meta({ description: 'The channel slug.' }),
    working_title: z.string().min(1).max(200),
    premise: z.string().max(5000).optional(),
    notes: z.string().max(5000).optional(),
    status: z
      .enum(UPCOMING_STATUSES)
      .optional()
      .meta({ description: 'Defaults to idea. Only ELO sets dropped.' }),
    episode_id: z
      .string()
      .optional()
      .meta({ description: 'Leave out and ELO picks the next free id, <slug>-<year>-<nnnn>.' }),
    script_path: z.string().nullable().optional(),
    air_date: AirDate.optional(),
    post_type: z.enum(['episode', 'clip']).optional(),
    source_episode_id: z.string().optional(),
  })
  .strict()

export const PatchUpcomingBody = z
  .object({
    working_title: z.string().min(1).max(200).optional(),
    premise: z.string().max(5000).optional(),
    notes: z.string().max(5000).optional(),
    script_path: z.string().nullable().optional(),
    air_date: AirDate.optional(),
    status: z.enum(UPCOMING_STATUSES).optional(),
    post_type: z.enum(['episode', 'clip']).optional(),
    source_episode_id: z.string().optional(),
    entry_revision: z.number().int().optional().meta({
      description:
        'The entry_revision you read. If the entry changed since, different fields are merged and the same field makes a conflict (409).',
    }),
  })
  .strict()

export const SyncOut = z.object({
  app_version: z.string(),
  mechanism: z.string(),
  server_time: z.string().meta({ description: 'Now, in America/New_York with the offset.' }),
  upcoming: z.object({
    revision: z.number().int(),
    updated_at: z.string().nullable(),
    entries: z.number().int(),
  }),
  last_change_id: z.number().int().meta({ description: 'Use as since_id on GET /v1/changes.' }),
  claude_api_enabled: z.boolean(),
  studio_production_enabled: z.boolean(),
  agent_may_schedule: z.boolean(),
  scheduler_paused: z.boolean(),
  open_reconcile_issues: z.number().int(),
})

export const ChangesQuery = z.object({
  since_id: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const ChangesOut = z.object({
  cursor: z.number().int().meta({ description: 'Send this as since_id next time.' }),
  events: z.array(
    z.object({
      id: z.number().int(),
      at: z.string(),
      actor: z.string(),
      action: z.string(),
      target: z.string(),
      detail: z.string(),
    }),
  ),
})

export const LearningsOut = z.object({
  markdown: z.string(),
  lessons: z.array(
    z.object({
      channel: z.string().nullable(),
      episode_id: z.string().nullable(),
      text: z.string(),
      at: z.string(),
    }),
  ),
})

export const SeoQuery = z.object({ q: z.string().min(2).max(100) })
export const SeoOut = z.object({ query: z.string(), phrases: z.array(z.string()) })

export const BriefOut = z.object({ markdown: z.string() })

export const RetractParams = z.object({ episode_id: z.string().min(1) })
export const RetractOut = z.object({
  episode_id: z.string(),
  post_ids: z.array(z.number().int()),
  results: z.array(
    z.object({
      platform: z.string(),
      outcome: z.enum(['hidden', 'manual', 'skipped', 'failed']),
      detail: z.string(),
      url: z.string().nullable(),
    }),
  ),
})
