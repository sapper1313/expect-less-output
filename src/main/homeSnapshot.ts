import type { HomeSummary } from '@shared/home'
import { formatEastern } from '@shared/time'

const n = (v: number | null) => (v === null ? 'unknown' : String(v))

/** The studio in plain lines. This is all a chat assistant is allowed to know, and it never holds a secret. */
export function homeSnapshotText(s: HomeSummary): string {
  const lines: string[] = [`Now (Eastern time): ${formatEastern(s.generatedUtc)}`, 'Channels:']
  for (const c of s.channels) {
    const p = c.pipeline
    lines.push(
      `- ${c.name}${c.paused ? ' (paused)' : ''}: ${c.runwayDays} days of episodes ahead, next episode due ${c.nextDue ?? 'not set'}. ` +
        `Being written ${p.writing}, ready for video ${p.ready}, video in progress ${p.making}, scheduled ${p.scheduled}, flagged ${p.flagged}. ` +
        `Logins: ${c.connections.map((x) => `${x.label} ${x.state === 'ok' ? 'fine' : x.note}`).join(', ')}.`,
    )
    if (c.latest)
      lines.push(
        `  Latest post: "${c.latest.title}" on ${c.latest.platforms.join(', ')}, posted ${c.latest.postedAtUtc ? formatEastern(c.latest.postedAtUtc, false) : 'at an unknown time'}. ` +
          `Views ${n(c.latest.views)}, likes ${n(c.latest.likes)}, comments ${n(c.latest.comments)}, shares ${n(c.latest.shares)}.`,
      )
    else lines.push('  Nothing has been posted yet.')
  }
  lines.push('Coming up:')
  for (const p of s.upcoming.slice(0, 6))
    lines.push(
      `- ${p.brandName}: "${p.title}" on ${p.platforms.join(', ')} at ${p.whenUtc ? formatEastern(p.whenUtc, false) : 'no time'}`,
    )
  if (!s.upcoming.length) lines.push('- nothing scheduled')
  lines.push('Recently posted:')
  for (const p of s.recent.slice(0, 5))
    lines.push(
      `- ${p.brandName}: "${p.title}" at ${p.whenUtc ? formatEastern(p.whenUtc, false) : 'unknown'}`,
    )
  if (!s.recent.length) lines.push('- nothing yet')
  lines.push(
    `Spend in ${s.spend.month}: $${s.spend.total.toFixed(2)}${s.spend.capValue === null ? ' (no cap)' : ` of a $${s.spend.capValue} cap`}, on pace for about $${s.spend.projected.toFixed(2)}.${s.spend.mock ? ' Mock mode is on.' : ''}`,
  )
  lines.push('Pipeline: ' + s.stages.map((x) => `${x.label} ${x.count}`).join(', '))
  lines.push(
    s.needsYou.length
      ? 'Needs the owner: ' + s.needsYou.join('; ')
      : 'Nothing needs the owner right now.',
  )
  return lines.join('\n')
}

export function latestLines(s: HomeSummary): string {
  return s.channels
    .map((c) =>
      c.latest
        ? `${c.name}: "${c.latest.title}" has ${n(c.latest.views)} views, ${n(c.latest.likes)} likes, ${n(c.latest.comments)} comments.`
        : `${c.name}: nothing posted yet.`,
    )
    .join('\n')
}
