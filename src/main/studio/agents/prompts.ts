/** Every text agent gets its context on the first line as JSON, then plain instructions. Mock mode reads that first line. */
export const ctxLine = (ctx: Record<string, unknown>) => `CTX ${JSON.stringify(ctx)}`

export function readCtx(user: string): Record<string, any> {
  const first = user.split('\n')[0]
  if (!first.startsWith('CTX ')) return {}
  try {
    return JSON.parse(first.slice(4))
  } catch {
    return {}
  }
}

export const STYLE_RULES = [
  'Write like a person wrote it, in the voice of the series bible.',
  'Never use an em dash or a long dash anywhere. Use a comma, a period or a new sentence.',
  'Avoid stock AI phrases such as "delve", "unlock", "game-changer" and "in today\'s fast-paced world".',
  'Never name real brands, real people or celebrities.',
].join('\n')

/**
 * Imported skill files often describe a whole production routine (for example "plan every episode as 12 clips").
 * The bible's own length targets and formats are what the app enforces, so they win over a skill's clip count.
 */
export const LENGTH_PRECEDENCE = [
  'The bible sections "Length targets" and "Formats and templates" decide how long the episode is and how many scenes it has.',
  'If a skill file says something different about length or clip count (for example "12 clips of 12 to 14 seconds"), ignore that part of the skill.',
  "A skill's beat table is a story structure, not a clip count: spread the scenes over its beats in order.",
].join('\n')

/** What Script QC may and may not ask for. It checks the script, not the production work that comes after it. */
export const QC_SCOPE = [
  LENGTH_PRECEDENCE,
  'Never ask for the episode to be regrouped into a different number of clips or scenes, and never ask for a different runtime.',
  'You check the script only. Do not ask for reference image files, asset lists, prompts for making assets, or a separate COUNT PLAN section: the "counted_objects" list is the count plan.',
  'Only fail the script for a real problem: a broken bible rule, a wrong or inconsistent count, anything unsafe for the audience, or a line that is off voice. Do not fail it for taste or for missing production files.',
].join('\n')
