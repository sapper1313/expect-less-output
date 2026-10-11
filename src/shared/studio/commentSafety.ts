/** Words that make a comment something the owner must see. A plain screen that runs before any language model answer. */

export type RiskCategory =
  'insult' | 'politics' | 'medical' | 'legal' | 'financial' | 'minor' | 'personal_info' | 'spam'

const LISTS: Record<Exclude<RiskCategory, 'spam' | 'minor'>, string[]> = {
  insult: [
    'idiot',
    'stupid',
    'moron',
    'dumb',
    'hate you',
    'kill yourself',
    'kys',
    'shut up',
    'loser',
    'ugly',
    'pathetic',
    'fraud',
    'garbage person',
  ],
  politics: [
    'trump',
    'biden',
    'election',
    'democrat',
    'republican',
    'liberal',
    'conservative',
    'maga',
    'gop',
    'abortion',
    'immigration',
    'gun control',
    'israel',
    'gaza',
    'ukraine',
    'politics',
    'political',
    'congress',
  ],
  medical: [
    'doctor',
    'diagnos',
    'symptom',
    'medication',
    'medicine',
    'dosage',
    'cancer',
    'diabetes',
    'pregnant',
    'depressed',
    'depression',
    'anxiety',
    'suicide',
    'therapy',
    'disease',
    'prescription',
  ],
  legal: [
    'lawyer',
    'attorney',
    'lawsuit',
    'sue you',
    'legal advice',
    'copyright',
    'trademark',
    'court',
    'illegal',
  ],
  financial: [
    'invest',
    'stock',
    'crypto',
    'bitcoin',
    'loan',
    'mortgage',
    'tax',
    'retire',
    '401k',
    'financial advice',
    'shares',
    'forex',
  ],
  personal_info: [
    'address',
    'phone number',
    'email me',
    'dm me your',
    'where do you live',
    'real name',
    'your number',
    'whatsapp',
    'snapchat',
    'cashapp',
    'venmo',
    'instagram handle',
  ],
}

const SPAM_WORDS = [
  'giveaway',
  'free money',
  'follow me',
  'check my channel',
  'sub4sub',
  'sub for sub',
  'dm to',
  'earn $',
  'promo',
  'telegram',
  'whatsapp me',
  'click my profile',
  'winner',
  'claim your',
]

function has(text: string, word: string): boolean {
  const t = text.toLowerCase()
  const w = word.toLowerCase()
  if (/[a-z0-9]$/.test(w) && !w.includes(' ') && w.length > 4 && !/\d/.test(w))
    return new RegExp(`\\b${w}`).test(t)
  return new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t)
}

/** The first risky category found, or null when the comment looks ordinary. Spam is checked first. */
export function screenComment(text: string): RiskCategory | null {
  const t = text.toLowerCase()
  const links = (t.match(/https?:\/\/|www\./g) ?? []).length
  if (
    (links >= 1 && SPAM_WORDS.some((w) => t.includes(w))) ||
    links >= 3 ||
    /(.)\1{9,}/.test(t) ||
    SPAM_WORDS.filter((w) => t.includes(w)).length >= 2
  )
    return 'spam'
  // a minor: says an age under 18, or talks about their own kid or school
  const age = /\b(?:i am|i'm|im|i m)\s+(\d{1,2})\b/.exec(t)
  if (
    (age && Number(age[1]) < 18) ||
    /\bhow old are you\b/.test(t) ||
    /\bmy (kid|child|son|daughter|students?)\b/.test(t) ||
    /\b(\d{1,2}) years? old\b/.test(t)
  )
    return 'minor'
  for (const [cat, words] of Object.entries(LISTS) as Array<
    [Exclude<RiskCategory, 'spam' | 'minor'>, string[]]
  >)
    if (words.some((w) => has(t, w))) return cat
  return null
}

const INTERNAL = [
  'ai agent',
  'automated',
  'automation',
  'claude',
  'anthropic',
  'prompt',
  'language model',
  'chatbot',
  'bot',
  'script',
  'director',
  'agent',
  'algorithm',
  'as an ai',
  'grok',
  'xai',
]

/** Problems with a drafted reply: links, a long dash, robotic words, giving away how this works, or too long. */
export function replyProblems(reply: string, maxChars: number): string[] {
  const out: string[] = []
  const t = reply.toLowerCase()
  if (/https?:\/\/|www\.|\.com\b/.test(t))
    out.push('The reply has a link. Replies never contain links.')
  if (reply.length > maxChars)
    out.push(`The reply is ${reply.length} characters. Keep it under ${maxChars}.`)
  if (!reply.trim()) out.push('The reply is empty.')
  for (const w of INTERNAL)
    if (new RegExp(`\\b${w}\\b`).test(t))
      out.push(`The reply mentions "${w}". Never reveal how this works.`)
  return out
}
