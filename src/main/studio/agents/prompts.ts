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
