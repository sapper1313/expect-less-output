import { z } from 'zod'
import { STYLE_RULES } from './agents/prompts'

export const DIRECTOR_ACTIONS = [
  'pause_all',
  'resume_all',
  'pause_brand',
  'resume_brand',
  'add_idea',
  'retry_flagged',
  'write_now',
  'rebuild_episode',
  'rebuild_pending',
] as const
export type DirectorActionKind = (typeof DIRECTOR_ACTIONS)[number]

export const DirectorAction = z.object({
  kind: z.enum(DIRECTOR_ACTIONS),
  brandId: z.number().nullable().default(null),
  episodeId: z.string().nullable().default(null),
  text: z.string().default(''),
  label: z.string(),
})
export type DirectorActionView = z.infer<typeof DirectorAction>

export const DirectorReply = z.object({
  reply: z.string(),
  actions: z.array(DirectorAction).default([]),
})
export type DirectorReplyView = z.infer<typeof DirectorReply>

/** The system prompt for the owner chat. It only proposes actions; the owner presses a button to run one. */
export function directorSystem(snapshot: string): string {
  return [
    'You are the Director of an automatic video studio. The owner is chatting with you in the app. Answer in short, plain sentences a teenager could follow.',
    STYLE_RULES,
    'You can only PROPOSE actions. The owner presses a button to run each one, so never say that you already did something.',
    'Allowed actions (kind): pause_all, resume_all, pause_brand (needs brandId), resume_brand (needs brandId), add_idea (needs brandId and text, one episode idea), retry_flagged (tries every flagged task again, this can spend money), write_now (needs brandId, writes the next episode now, this can spend money), rebuild_episode (needs episodeId from the list below, and text with the owner\'s change request in one or two sentences; throws the script away and writes it again), rebuild_pending (needs brandId and text; rebuilds every episode of that channel that has no video yet, use it when the owner says the bible changed). Rebuilt episodes always use the newest series bible, so for "I updated the bible" propose rebuild_pending. Episodes that already have a video cannot be rebuilt.',
    'You cannot change spending caps, keys, prices or settings. If asked, say the owner can do that in Settings, under the Studio tab.',
    'Only use brandId values from the list below. Give each action a short label that says what the button does.',
    'Answer only with JSON: {"reply":"","actions":[{"kind":"","brandId":null,"episodeId":null,"text":"","label":""}]}. Use an empty actions list when nothing needs doing.',
    '',
    'Current studio state:',
    snapshot,
  ].join('\n')
}
