// Upcoming episodes: the shared planning list that bots and ELO both read and write.
// One zod schema describes the file. docs/upcoming.schema.json is generated from it (a test fails if that file is stale).
import { z } from 'zod'

export const UPCOMING_VERSION = '1.0'

export const UPCOMING_STATUSES = [
  'idea',
  'scripted',
  'queued',
  'rendering',
  'needs-review',
  'dropped',
] as const
export type UpcomingStatus = (typeof UPCOMING_STATUSES)[number]

const rank = (s: string) => UPCOMING_STATUSES.indexOf(s as UpcomingStatus)

export const UpcomingEntry = z
  .object({
    channel: z
      .string()
      .min(1)
      .meta({ description: 'The channel slug, for example clock-out-early.' }),
    episode_id: z
      .string()
      .min(1)
      .meta({ description: 'Unique per channel: <slug>-<year>-<nnnn>.' }),
    working_title: z.string().min(1),
    premise: z.string().default(''),
    status: z.enum(UPCOMING_STATUSES),
    source_bot: z
      .string()
      .min(1)
      .meta({ description: 'Who the idea came from: a bot name or josh.' }),
    created_by: z.string().min(1),
    created_at: z.string(),
    updated_by: z.string().min(1),
    updated_at: z.string(),
    entry_revision: z.number().int().min(1),
    notes: z.string().default(''),
    script_path: z.string().nullable().default(null),
    drop_id: z.string().nullable().default(null),
    conflict: z.boolean().optional(),
    conflict_detail: z.string().optional(),
  })
  .passthrough()
  .meta({ description: 'One planned episode.' })

export type UpcomingEntryT = z.infer<typeof UpcomingEntry>

export const UpcomingFile = z
  .object({
    schema_version: z.literal(UPCOMING_VERSION),
    revision: z.number().int().min(0).meta({ description: 'Goes up by one with every write.' }),
    updated_at: z.string(),
    episodes: z.array(UpcomingEntry),
  })
  .passthrough()
  .meta({
    description: 'The shared list of episodes in flight. Unknown fields are kept when ELO writes.',
  })

export type UpcomingFileT = z.infer<typeof UpcomingFile>

/** The editable fields of an entry. Everything else is set by the system. */
export const EDITABLE = ['working_title', 'premise', 'notes', 'script_path'] as const

/** The fields a change touched, comparing two versions of an entry. */
export function changedFields(
  a: Record<string, unknown> | null,
  b: Record<string, unknown>,
): string[] {
  const skip = new Set(['updated_by', 'updated_at', 'entry_revision'])
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b)])
  return [...keys].filter((k) => !skip.has(k) && JSON.stringify(a?.[k]) !== JSON.stringify(b[k]))
}

export interface Actor {
  /** josh, system, or a bot name such as grok-bot. */
  name: string
  role?: 'writer' | 'orchestrator'
  /** Channels the bot may work on. */
  channels?: string[]
}

export interface ChangeVerdict {
  ok: boolean
  reason?: string
}

/**
 * Who may change what (section 6.4). prev is null for a new entry.
 * - Josh may add and edit anything.
 * - system (ELO) makes one change only: needs-review to dropped, with the drop_id.
 * - A bot adds entries on its own channels. It may edit the title, premise and notes only of entries it created.
 *   It may advance any entry on its own channels, and set script_path and notes there, but cannot delete or reword
 *   another actor's title or premise.
 * - An orchestrator (B.E.T.H.) may advance any entry forward, scripted to queued to rendering to needs-review.
 * - Backward moves need Josh or an orchestrator, and a note.
 */
export function mayChange(
  actor: Actor,
  prev: Record<string, any> | null,
  next: Record<string, any>,
): ChangeVerdict {
  if (actor.name === 'josh') return { ok: true }
  if (actor.name === 'system') {
    if (
      prev &&
      prev.status === 'needs-review' &&
      next.status === 'dropped' &&
      changedFields(prev, next).every((f) => f === 'status' || f === 'drop_id')
    )
      return { ok: true }
    return { ok: false, reason: 'ELO only moves an entry from needs-review to dropped.' }
  }
  const own = actor.channels?.includes(next.channel) ?? false
  const orchestrator = actor.role === 'orchestrator'
  if (!prev) {
    if (!own && !orchestrator)
      return { ok: false, reason: `${actor.name} may not add entries to ${next.channel}.` }
    if (next.status === 'dropped') return { ok: false, reason: 'Only ELO sets dropped.' }
    if (next.created_by !== actor.name)
      return { ok: false, reason: 'created_by must be the caller.' }
    return { ok: true }
  }
  const fields = changedFields(prev, next)
  if (!fields.length) return { ok: true }
  if (
    fields.includes('channel') ||
    fields.includes('episode_id') ||
    fields.includes('created_by') ||
    fields.includes('created_at') ||
    fields.includes('drop_id')
  )
    return {
      ok: false,
      reason: 'The channel, episode id, creator and drop link cannot be changed.',
    }
  if (fields.includes('conflict') || fields.includes('conflict_detail'))
    return { ok: false, reason: 'Only the owner clears a conflict.' }
  const forward = rank(next.status) > rank(prev.status)
  const backward = rank(next.status) < rank(prev.status)
  if (next.status === 'dropped' && prev.status !== 'dropped')
    return { ok: false, reason: 'Only ELO sets dropped.' }
  if (prev.status === 'dropped')
    return { ok: false, reason: 'A dropped entry is finished and cannot change.' }
  if (backward) {
    if (!orchestrator) return { ok: false, reason: 'Moving an entry back needs Josh or B.E.T.H.' }
    if (!String(next.notes ?? '').trim() || next.notes === prev.notes)
      return { ok: false, reason: 'Moving an entry back needs a note saying why.' }
  }
  if (forward && !orchestrator && !own)
    return { ok: false, reason: `${actor.name} may not advance entries on ${prev.channel}.` }
  if (forward && orchestrator && rank(prev.status) < rank('scripted'))
    return {
      ok: false,
      reason: 'B.E.T.H. moves entries from scripted onward. A bot scripts the idea first.',
    }
  for (const f of fields) {
    if (f === 'status') continue
    if (f === 'working_title' || f === 'premise') {
      if (prev.created_by !== actor.name)
        return {
          ok: false,
          reason: `${actor.name} cannot change the ${f.replace('_', ' ')} of an entry created by ${prev.created_by}.`,
        }
      continue
    }
    if (f === 'notes' || f === 'script_path' || f === 'source_bot') {
      if (!own && !orchestrator)
        return { ok: false, reason: `${actor.name} may not change entries on ${prev.channel}.` }
      continue
    }
    return { ok: false, reason: `${actor.name} may not change ${f}.` }
  }
  if (!own && !orchestrator)
    return { ok: false, reason: `${actor.name} may not change entries on ${prev.channel}.` }
  return { ok: true }
}

export function nextEpisodeId(slug: string, year: number, used: Iterable<string>): string {
  const re = new RegExp(`^${slug}-${year}-(\\d{4})$`)
  let max = 0
  for (const u of used) {
    const m = re.exec(u)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${slug}-${year}-${String(max + 1).padStart(4, '0')}`
}

export interface UpcomingRow extends UpcomingEntryT {
  channelName: string
  channelColor: string
  paused: boolean
  /** The Queue post a dropped entry became. */
  postId: number | null
  /** Why the entry cannot be edited right now (a duplicate id or a conflict). */
  readOnly: boolean
  staleDays: number
}

export interface UpcomingView {
  enabled: boolean
  revision: number
  /** Set when the file could not be read; the last good copy is shown. */
  invalidReason: string | null
  readOnly: boolean
  rows: UpcomingRow[]
  filePath: string
}

export function buildUpcomingSchema(): Record<string, unknown> {
  const j = z.toJSONSchema(UpcomingFile, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return { ...j, title: 'ELO upcoming episodes', $id: 'https://expectlessmedia.com/schemas/upcoming-1.0.json' }
}
