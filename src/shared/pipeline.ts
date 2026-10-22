// The bot pipeline sidecar: what a bot writes next to a finished video, and how ELO checks it.
// One zod schema describes it. docs/sidecar.schema.json is generated from it (and a test fails if that file is stale).
import { z } from 'zod'
import { DateTime } from 'luxon'

export const SIDECAR_VERSION = '1.0'

export const PIPELINE_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'] as const

/** Bots the sidecar may name. The allowlist in Settings decides which are accepted. */
export const DEFAULT_SOURCE_BOTS = ['grok-bot', 'kids-comedy', 'beth']

export const TITLE_MAX = 100
export const TAGS_MAX = 30

const ZONED = /(Z|[+-]\d{2}:\d{2})$/i
const zoned = z
  .string()
  .regex(ZONED, 'Give the time with a zone, for example 2026-10-16T15:30:00-04:00.')
  .refine(
    (s) => DateTime.fromISO(s, { setZone: true }).isValid,
    'That is not a valid date and time.',
  )

export const PipelineSidecar = z
  .object({
    schema_version: z.literal(SIDECAR_VERSION).meta({ description: 'Always "1.0".' }),
    channel: z.string().min(1).meta({
      description:
        'The channel slug, for example clock-out-early. It must match the Inbox folder you dropped into.',
    }),
    episode_id: z.string().min(1).meta({
      description:
        'The one episode id, <slug>-<year>-<SSEE>, SS the season and EE the episode, for example clock-out-early-2026-0101 (season 1, episode 1). The video file name must contain it.',
    }),
    title: z.string().min(1).meta({ description: 'Up to 100 characters.' }),
    description: z
      .string()
      .meta({ description: 'The YouTube description and the Instagram and TikTok caption.' }),
    tags: z.array(z.string()).optional().meta({
      description:
        'Up to 30. Sent as YouTube tags and added as hashtags where the caption lacks them.',
    }),
    thumbnail_path: z.string().optional().meta({
      description:
        'JPG or PNG next to the video, under 2 MB. Used as the YouTube thumbnail on long videos.',
    }),
    video_file: z
      .string()
      .min(1)
      .meta({ description: 'The video file name. It must equal the video file you dropped.' }),
    post_type: z.enum(['episode', 'clip']).optional().meta({
      description:
        'episode (the default when missing) is a full video. clip is a vertical clip, 9:16 and 5 to 90 seconds, with its own schedule.',
    }),
    source_episode_id: z.string().optional().meta({
      description:
        'For a clip: the episode it was cut from. Once that episode is live on YouTube, the clip description gets "Full episode on YouTube" and the link.',
    }),
    platforms: z.array(z.enum(PIPELINE_PLATFORMS)).min(1).optional().meta({
      description:
        'Required for an episode. A clip may leave it out and then goes to every platform the show has switched on for clips.',
    }),
    preferred_slot: z.string().optional().meta({
      description:
        'Accepted and ignored. The schedule is set in ELO. A bot never sets, requests or promises a posting time.',
    }),
    approval: z.object({ approved_by: z.string().min(1), approved_at: zoned }).meta({
      description: 'Josh approves outside ELO before the drop. A sidecar without it is rejected.',
    }),
    checksum: z.object({
      algo: z.literal('sha256'),
      value: z.string().regex(/^[a-fA-F0-9]{64}$/, 'The checksum must be 64 hex characters.'),
    }),
    source_bot: z.string().min(1),
    qc: z
      .object({ status: z.enum(['pass', 'fail']), by: z.string().min(1), at: zoned })
      .optional()
      .meta({
        description: 'The quality check result. Needed when "Require QC pass" is on in Settings.',
      }),
    beth_signoff: z
      .object({ by: z.string().min(1), at: zoned })
      .optional()
      .meta({ description: 'B.E.T.H. sign-off. Needed when "Require QC pass" is on in Settings.' }),
    render: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: 'Stored in the drop log only.' }),
    // Extra fields ELO already understands.
    caption_overrides: z.record(z.string(), z.string()).optional(),
    ai_flags: z.record(z.string(), z.boolean()).optional(),
    tiktok: z.record(z.string(), z.unknown()).optional(),
    thumb_offset_ms: z.number().int().min(0).optional(),
  })
  .meta({ description: 'The .json file that goes next to a finished video in a channel Inbox.' })

export type PipelineSidecarInput = z.infer<typeof PipelineSidecar>

export const KNOWN_SIDECAR_KEYS = Object.keys(PipelineSidecar.shape)

/** A sidecar is a pipeline sidecar when it carries schema_version. */
export function isPipelineSidecar(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && 'schema_version' in (raw as object)
}

export type ReasonCode =
  | 'bad_json'
  | 'bad_schema'
  | 'unknown_field'
  | 'wrong_channel'
  | 'bad_episode_id'
  | 'video_file_mismatch'
  | 'no_approval'
  | 'no_qc'
  | 'bad_checksum'
  | 'unknown_bot'
  | 'bad_format'
  | 'bad_duration'
  | 'no_audio'
  | 'duplicate_checksum'
  | 'duplicate_episode'
  | 'filename_missing_id'
  | 'title_mismatch'
  | 'file_changed'
  | 'file_missing'
  | 'bad_thumbnail'
  | 'unreadable'

export interface Reason {
  code: ReasonCode
  field?: string
  message: string
}

/** Old names for channels. Each maps to the one canonical slug. Posted history keeps its old ids. */
export const SLUG_ALIASES: Record<string, string> = {
  'wonder-hollow-workshop': 'wonder-hollow',
  'the-math-of-it': 'math-of-it',
  'the-complaint-department': 'complaint-department',
  'the-trash-panda': 'trash-panda',
}

export const canonicalSlug = (s: string): string =>
  SLUG_ALIASES[s.trim().toLowerCase()] ?? s.trim().toLowerCase()

/** The id every channel uses for an episode: <slug>-<year>-<SSEE> (SS season, EE episode). */
export const episodeIdPattern = (slug: string) => {
  const names = [
    slug,
    ...Object.entries(SLUG_ALIASES)
      .filter(([, v]) => v === slug)
      .map(([k]) => k),
  ]
  return new RegExp(`^(${names.map((n) => n.replace(/[^a-z0-9-]/g, '')).join('|')})-\\d{4}-\\d{4}$`)
}

/** A clip id is a normal episode id, or one with -c1, -c2 and so on, for example clock-out-early-2026-0101-c1. */
export const clipIdPattern = (slug: string) => {
  const base = episodeIdPattern(slug).source.replace(/^\^/, '').replace(/\$$/, '')
  return new RegExp(`^${base}(-c\\d{1,3})?$`)
}

export const CLIP_MIN_SECONDS = 5
export const CLIP_MAX_SECONDS = 90

export interface ValidateOptions {
  strict: boolean
  requireApproval: boolean
  /** Reject a sidecar without a passing QC result and a B.E.T.H. sign-off. */
  requireQc?: boolean
  sourceBots: string[]
  channelSlug: string
}

export interface ValidateResult {
  ok: boolean
  /** Problems that reject the drop. */
  errors: Reason[]
  /** Small things noted in the drop log. Only when strict is off. */
  notes: string[]
  data: PipelineSidecarInput | null
}

/** Checks the sidecar's contents (not the files). The video and checksum are checked by the intake. */
export function validatePipelineSidecar(raw: unknown, o: ValidateOptions): ValidateResult {
  const errors: Reason[] = []
  const notes: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {
      ok: false,
      errors: [{ code: 'bad_json', message: 'The .json file must hold one JSON object.' }],
      notes,
      data: null,
    }
  const obj = { ...(raw as Record<string, unknown>) }
  // With approval not required, a sidecar may leave the block out. Fill it so the rest still checks.
  const approvalMissing = obj.approval === undefined
  if (approvalMissing && !o.requireApproval)
    obj.approval = { approved_by: 'not required', approved_at: '1970-01-01T00:00:00Z' }
  const parsed = PipelineSidecar.safeParse(obj)
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const field = i.path.join('.') || '(top)'
      if (field.startsWith('approval'))
        errors.push({
          code: 'no_approval',
          field,
          message: `approval is missing or wrong (${field}: ${i.message}).`,
        })
      else if (field === 'checksum' || field.startsWith('checksum.'))
        errors.push({ code: 'bad_checksum', field, message: `checksum: ${i.message}` })
      else errors.push({ code: 'bad_schema', field, message: `${field}: ${i.message}` })
    }
    return { ok: false, errors, notes, data: null }
  }
  const d = parsed.data
  for (const k of Object.keys(obj))
    if (!KNOWN_SIDECAR_KEYS.includes(k)) {
      if (o.strict)
        errors.push({ code: 'unknown_field', field: k, message: `${k} is not a field ELO knows.` })
      else notes.push(`Ignored unknown field ${k}.`)
    }
  if (canonicalSlug(d.channel) !== o.channelSlug)
    errors.push({
      code: 'wrong_channel',
      field: 'channel',
      message: `The sidecar says channel "${d.channel}" but this is the ${o.channelSlug} Inbox.`,
    })
  const isClip = d.post_type === 'clip'
  if (!isClip && (!d.platforms || d.platforms.length === 0))
    errors.push({
      code: 'bad_schema',
      field: 'platforms',
      message: 'platforms: an episode needs at least one platform.',
    })
  if (
    d.source_episode_id !== undefined &&
    !episodeIdPattern(o.channelSlug).test(d.source_episode_id)
  ) {
    const m = `source_episode_id "${d.source_episode_id}" must be the id of an episode of this channel, like ${o.channelSlug}-2026-0101.`
    if (o.strict) errors.push({ code: 'bad_episode_id', field: 'source_episode_id', message: m })
    else notes.push(m)
  }
  if (d.source_episode_id !== undefined && !isClip)
    notes.push('source_episode_id is only used for clips, so it was ignored.')
  if (
    !(isClip ? clipIdPattern(o.channelSlug) : episodeIdPattern(o.channelSlug)).test(d.episode_id)
  ) {
    const m = `episode_id "${d.episode_id}" must look like ${o.channelSlug}-2026-0101${isClip ? ' or ' + o.channelSlug + '-2026-0101-c1' : ''} (season 01, episode 01).`
    if (o.strict) errors.push({ code: 'bad_episode_id', field: 'episode_id', message: m })
    else notes.push(m)
  }
  if (d.title.length > TITLE_MAX) {
    const m = `The title is ${d.title.length} characters. The limit is ${TITLE_MAX}.`
    if (o.strict) errors.push({ code: 'bad_schema', field: 'title', message: m })
    else notes.push(m)
  }
  if ((d.tags?.length ?? 0) > TAGS_MAX) {
    const m = `There are ${d.tags!.length} tags. The limit is ${TAGS_MAX}.`
    if (o.strict) errors.push({ code: 'bad_schema', field: 'tags', message: m })
    else notes.push(m)
  }
  if (!o.sourceBots.includes(d.source_bot)) {
    const m = `source_bot "${d.source_bot}" is not on the allowed list (${o.sourceBots.join(', ')}).`
    if (o.strict) errors.push({ code: 'unknown_bot', field: 'source_bot', message: m })
    else notes.push(m)
  }
  if (d.video_file !== d.video_file.split('/').pop() || d.video_file.includes('..'))
    errors.push({
      code: 'video_file_mismatch',
      field: 'video_file',
      message: 'video_file must be a plain file name, with no folders.',
    })
  if (d.thumbnail_path && (d.thumbnail_path.startsWith('/') || d.thumbnail_path.includes('..')))
    errors.push({
      code: 'bad_thumbnail',
      field: 'thumbnail_path',
      message: 'thumbnail_path must be relative to the sidecar, with no "..".',
    })
  if (o.requireQc && (d.qc?.status !== 'pass' || !d.beth_signoff))
    errors.push({
      code: 'no_qc',
      field: 'qc',
      message:
        'This channel needs a passing QC result (qc.status "pass") and a beth_signoff block before a drop is taken.',
    })
  if (d.preferred_slot !== undefined) notes.push('Ignored: the schedule is set in ELO.')
  return { ok: errors.length === 0, errors, notes, data: errors.length ? null : d }
}

// ---------- drops ----------

export type DropResult = 'accepted' | 'rejected' | 'duplicate' | 'held'

export interface DropRow {
  id: number
  dropId: string
  receivedAt: string
  sourceBot: string | null
  fileName: string
  filePath: string
  fileSize: number | null
  sha256: string | null
  brandId: number | null
  channel: string | null
  episodeId: string | null
  title: string | null
  sidecarValid: boolean
  result: DropResult
  reason: string | null
  scheduledSlot: string | null
  postId: number | null
  approvedBy: string | null
  approvedAt: string | null
  postType: 'episode' | 'clip'
  render: unknown
  notes: string | null
}

export interface DropFilter {
  channel?: string
  bot?: string
  result?: DropResult
  limit?: number
}

// ---------- what the Inbox screen shows ----------

export interface ScheduleOutcome {
  ok: boolean
  /** Plain words about what happened or why it did not. */
  message: string
  scheduledAtUtc?: string
  held?: boolean
}

export interface InboxItem {
  postId: number
  brandId: number
  brandName: string
  brandColor: string
  channel: string | null
  episodeId: string | null
  postType: 'episode' | 'clip'
  title: string
  sourceBot: string | null
  /** When the drop arrived (UTC). */
  droppedAt: string
  durationSeconds: number | null
  posterUrl: string | null
  status: string
  /** Why it waits (no account, paused, auto-schedule off) or why it is held. */
  reason: string | null
  fileName: string
  paused: boolean
}

export interface InboxCounts {
  waiting: number
  held: number
  issues: number
  /** The number on the menu badge. */
  badge: number
}

export interface ChannelRules {
  /** Not producing or scheduling while a decision is made. Drops wait. */
  onHold: boolean
  maxPerDay: number
  blackoutDates: string[]
  lowQueueDays: number | null
  minSeconds: number | null
  maxSeconds: number | null
}

export interface IssueRow {
  id: number
  key: string
  kind: string
  brandId: number | null
  postId: number | null
  detail: string
  firstSeen: string
  lastSeen: string
}

export interface AuditRow {
  id: number
  at: string
  actor: string
  action: string
  target: string
  before: unknown
  after: unknown
}

// ---------- bots ----------

export interface BotInfo {
  id: number
  name: string
  channels: string[]
  role: 'writer' | 'orchestrator'
  createdAt: string
  revokedAt: string | null
}

/** The JSON Schema files in docs/ are generated from the zod schemas above. */
export function buildSidecarSchema(): Record<string, unknown> {
  const j = z.toJSONSchema(PipelineSidecar, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >
  return {
    ...j,
    title: 'ELO pipeline sidecar',
    $id: 'https://expectlessmedia.com/schemas/sidecar-1.0.json',
  }
}

// ---------- fresh start ----------

export interface FreshStartInfo {
  episodes: number
  episodesKept: number
  ideas: number
  tasks: number
  upcoming: number
  unpostedPosts: number
  postedKept: number
  runningTasks: number
  bundleDir: string
}

export interface FreshStartDone extends FreshStartInfo {
  verified: boolean
  checks: string[]
  revision: number
  updatedAt: string
  switchedOff: string[]
}
