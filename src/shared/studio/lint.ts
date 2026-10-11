/** Writing lint for everything the agents produce. No em dashes, no robotic phrases. */

const DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)

export interface LintIssue {
  kind: 'em_dash' | 'robotic_phrase'
  detail: string
}

export function lintText(text: string, roboticPhrases: string[]): LintIssue[] {
  const issues: LintIssue[] = []
  if (text.includes(DASH)) issues.push({ kind: 'em_dash', detail: 'Contains an em dash.' })
  if (text.includes(EN_DASH)) issues.push({ kind: 'em_dash', detail: 'Contains a long dash.' })
  const lower = text.toLowerCase()
  for (const p of roboticPhrases) {
    const phrase = p.trim().toLowerCase()
    if (phrase && lower.includes(phrase))
      issues.push({ kind: 'robotic_phrase', detail: `Uses the phrase "${p.trim()}".` })
  }
  return issues
}

/** Walks any JSON value and lints every string in it. Returns issues with the path they were found at. */
export function lintValue(
  value: unknown,
  roboticPhrases: string[],
  path = '$',
): Array<LintIssue & { path: string }> {
  if (typeof value === 'string') return lintText(value, roboticPhrases).map((i) => ({ ...i, path }))
  if (Array.isArray(value))
    return value.flatMap((v, i) => lintValue(v, roboticPhrases, `${path}[${i}]`))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => lintValue(v, roboticPhrases, `${path}.${k}`))
  return []
}

/** Plain-language instruction sent back to an agent that failed the lint. */
export function lintFeedback(issues: Array<LintIssue & { path: string }>): string {
  const lines = issues.slice(0, 8).map((i) => `- ${i.path}: ${i.detail}`)
  return `Rewrite these parts. Never use an em dash or a long dash (use a comma, a period or a new sentence). Avoid stock AI phrases.\n${lines.join('\n')}`
}

/** Replaces dashes with a comma so a last-resort cleanup never lets one through. */
export function stripDashes(text: string): string {
  return text.replaceAll(` ${DASH} `, ', ').replaceAll(DASH, ', ').replaceAll(EN_DASH, '-')
}
