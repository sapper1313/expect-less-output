// The one description of the agent API. Requests are validated with these schemas, the OpenAPI file and the
// MCP tools are generated from them, so none of the three can drift apart.
import { z } from 'zod'
import { DateTime } from 'luxon'

export const PlatformEnum = z.enum(['youtube', 'facebook', 'instagram', 'tiktok'])
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
    tiktok: TikTokInput.optional(),
    thumb_offset_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .meta({ description: 'Instagram cover frame, milliseconds from the start.' }),
    scheduled_at: ZonedTime.optional(),
    next_slot: z.boolean().optional().meta({
      description:
        "Use the brand's next open slot. Not allowed while agents are limited to drafts.",
    }),
    status: z.enum(['draft', 'scheduled']).default('draft').meta({
      description:
        'draft (default) or scheduled. Scheduled is refused with 403 while agents are limited to drafts.',
    }),
  })
  .strict()
  .refine((b) => !(b.scheduled_at && b.next_slot), {
    message: 'Use scheduled_at or next_slot, not both.',
    path: ['next_slot'],
  })
  .refine((b) => b.status !== 'scheduled' || !!b.scheduled_at || !!b.next_slot, {
    message: 'A scheduled post needs scheduled_at or next_slot: true.',
    path: ['status'],
  })

export const UpdatePostBody = z
  .object({
    title: z.string().max(200).optional(),
    caption: z.string().max(5000).optional(),
    platforms: z.array(PlatformEnum).min(1).optional(),
    caption_overrides: platformMap(z.string()).optional(),
    ai_flags: platformMap(z.boolean()).optional(),
    tiktok: TikTokInput.optional(),
    thumb_offset_ms: z.number().int().min(0).optional(),
    scheduled_at: ZonedTime.nullable()
      .optional()
      .meta({ description: 'New time, or null to clear it.' }),
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
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const NextOpenQuery = z.object({
  brand_id: id,
  count: z.coerce.number().int().min(1).max(50).default(3),
  from: ZonedTime.optional().meta({
    description: 'Start looking after this time. Defaults to now.',
  }),
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

// ---------- responses ----------

export const ErrorBody = z.object({
  error: z.object({
    code: z.enum([
      'unauthorized',
      'forbidden',
      'drafts_only',
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
  color: z.string(),
  archived: z.boolean(),
  paused: z.boolean(),
  inbox_enabled: z.boolean(),
  slots: z.array(SlotOut).meta({ description: 'Posting times, in Eastern time.' }),
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
  targets: z.array(TargetOut),
  warnings: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const NextOpenOut = z.object({
  brand_id: z.number().int(),
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
