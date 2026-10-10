import type { AgentTask, EpisodeRow } from './types'

export interface FlagText {
  /** What the agent was doing, in plain words. */
  doing: string
  /** The channel (brand) name, or an empty string. */
  channel: string
  /** The episode, for example "Episode 3, due 2026-10-15". */
  episode: string
  /** Why it stopped, in plain words. */
  why: string
  /** What the owner can do about it. */
  next: string
}

const DOING: Record<string, string> = {
  write_episode: 'Writing a new episode',
  produce_episode: 'Making the video',
  publish_episode: 'Getting the episode ready to post',
  comments_pass: 'Answering comments',
  analytics_daily: 'Checking how the videos did',
}

/** Turns the raw error text into a sentence a non technical owner can act on. */
function plainReason(error: string | null, taskType: string): { why: string; next: string } {
  const e = (error ?? '').trim()
  const retry = 'Press Retry to try again.'
  if (!e) return { why: 'The agent stopped and did not say why.', next: retry }
  if (/cut off/i.test(e))
    return { why: 'The AI started writing but ran out of room before it finished, so the answer was incomplete.', next: `${retry} This is usually fixed by trying again.` }
  if (/timeout|timed out|aborted/i.test(e))
    return { why: 'The AI took too long to answer, so the app gave up waiting.', next: retry }
  if (/after \d+ tries/i.test(e) && /Script QC/i.test(e))
    return { why: `The script was checked ${e.match(/after (\d+) tries/i)?.[1] ?? 'several'} times and still did not pass. ${e.replace(/^.*Last problem:\s*/i, '')}`, next: `${retry} Or press Approve as is to keep the script anyway.` }
  if (/after \d+ tries/i.test(e))
    return { why: e, next: `${retry} Or press Approve as is to keep it anyway.` }
  if (/cap|limit reached|budget/i.test(e))
    return { why: 'A spending limit was reached, so the app stopped before paying for more.', next: 'Raise the cap in Settings, then press Retry.' }
  if (/HTTP 401|HTTP 403|api key|unauthorized|invalid x-api-key/i.test(e))
    return { why: 'The service did not accept the key. It may be missing, wrong or out of credit.', next: 'Check the key in Settings, press Test connection, then press Retry.' }
  if (/HTTP 429|rate limit|overloaded|HTTP 529/i.test(e))
    return { why: 'The service is busy or you are going too fast for it right now.', next: 'Wait a few minutes, then press Retry.' }
  if (/HTTP 400/i.test(e))
    return { why: `The service refused the request. ${e.replace(/\s+/g, ' ').slice(0, 220)}`, next: `${retry} If it keeps happening, tell the Director.` }
  if (/not valid JSON|usable JSON/i.test(e))
    return { why: 'The AI answered in a shape the app could not read.', next: retry }
  return { why: e.replace(/\s+/g, ' ').slice(0, 300), next: taskType === 'produce_episode' ? 'Choose what to do with each clip below.' : retry }
}

export function describeFlag(task: AgentTask, episode: EpisodeRow | null, brandName: string | null): FlagText {
  const { why, next } = plainReason(task.error, task.type)
  const slot = (task.payload?.slotDate as string | undefined) ?? episode?.slotDate ?? null
  const title = episode?.title && !/^writing in progress$/i.test(episode.title) ? `"${episode.title}"` : null
  const number = episode ? `Episode ${episode.number}` : null
  const parts = [title ?? number, slot ? `due ${slot}` : null].filter(Boolean)
  return {
    doing: DOING[task.type] ?? task.type.replaceAll('_', ' '),
    channel: brandName ?? '',
    episode: parts.join(', ') || (task.episodeId ?? ''),
    why,
    next,
  }
}
