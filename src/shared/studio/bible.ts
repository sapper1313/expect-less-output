import { z } from 'zod'

export const Character = z.object({
  name: z.string(),
  look: z.string().default(''),
  personality: z.string().default(''),
  voice: z.string().default(''),
  catchphrases: z.array(z.string()).default([]),
})

export const SeriesBible = z.object({
  premise: z.string().default(''),
  audience: z.string().default(''),
  characters: z.array(Character).default([]),
  voiceAndTone: z.string().default(''),
  runningJokes: z.array(z.string()).default([]),
  formats: z.string().default(''),
  hookPatterns: z.array(z.string()).default([]),
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
  bannedPhrases: z.array(z.string()).default([]),
  recurringSegments: z.array(z.string()).default([]),
  /** Seconds of finished video the Script QC accepts. */
  minSeconds: z.number().default(15),
  maxSeconds: z.number().default(60),
  platformNotes: z.string().default(''),
})
export type SeriesBibleData = z.infer<typeof SeriesBible>

export interface Skill {
  id: number
  name: string
  text: string
}

export const emptyBible = (): SeriesBibleData => SeriesBible.parse({})

const list = (title: string, items: string[]) => (items.length ? `## ${title}\n${items.map((i) => `- ${i}`).join('\n')}\n\n` : '')

/** The whole bible as Markdown. This is exactly what a Writer receives on every call, and what Export gives the owner. */
export function bibleToMarkdown(brand: string, b: SeriesBibleData, skills: Skill[]): string {
  let out = `# Series bible: ${brand}\n\n`
  const text = (title: string, v: string) => (v.trim() ? `## ${title}\n${v.trim()}\n\n` : '')
  out += text('Channel premise', b.premise)
  out += text('Audience', b.audience)
  if (b.characters.length) {
    out += '## Characters\n'
    for (const c of b.characters)
      out += `### ${c.name}\n- Look: ${c.look}\n- Personality: ${c.personality}\n- Voice: ${c.voice}\n- Catchphrases: ${c.catchphrases.join(' | ')}\n`
    out += '\n'
  }
  out += text('Voice and tone rules', b.voiceAndTone)
  out += list('Running jokes', b.runningJokes)
  out += text('Formats and templates', b.formats)
  out += list('Hook patterns', b.hookPatterns)
  out += list('Do', b.dos)
  out += list("Don't", b.donts)
  out += list('Banned phrases', b.bannedPhrases)
  out += list('Recurring segments', b.recurringSegments)
  out += `## Length targets\n${b.minSeconds} to ${b.maxSeconds} seconds of finished video.\n\n`
  out += text('Platform notes', b.platformNotes)
  for (const s of skills) out += `## Skill: ${s.name}\n${s.text.trim()}\n\n`
  return out
}

/** Preloaded bibles for the brands the owner already runs. Everything here stays editable. */
export function seedBible(brandName: string, format: 'short' | 'long'): SeriesBibleData {
  const n = brandName.toLowerCase()
  if (format === 'long' || n.startsWith('wonder hollow'))
    return SeriesBible.parse({
      premise:
        'Wonder Hollow Workshop is a cozy 3D animated show for kids. A crew of friendly woodland workshop friends solves a small problem each episode. Every episode teaches one life lesson and one math lesson.',
      audience: 'Children, made for kids. Parents watching along. Warm, safe, positive.',
      characters: [],
      voiceAndTone: 'Gentle, cheerful, simple words. Age appropriate and positive. No scary or shocking moments. No product placement. No real people or real brands.',
      formats:
        'About 3 minutes. 3D animated style. Scenes are 10 seconds of content each. A scene may be generated at 15 seconds so there is a handle for a smooth transition into the next scene (extension), but it is never a 10 second clip with 5 extra seconds tacked on. The objects being counted are ALWAYS displayed on screen and must look like they belong in the story world, written into the scene as natural props, never an afterthought. The exact quantity is stated in the scene prompt and counted aloud in order. The closing is the crew singing a goodbye ("see you next time") that ends on the Hollow logo. No credits.',
      hookPatterns: ['Start with the problem the crew is facing in the first scene.'],
      dos: ['Count aloud, one number at a time, while the objects are on screen.', 'End with the goodbye song and the Hollow logo.'],
      donts: ['No credits.', 'No frightening imagery.', 'No unsafe behavior shown as something to copy.'],
      recurringSegments: ['The goodbye song'],
      minSeconds: 150,
      maxSeconds: 210,
      platformNotes: 'YouTube only. Made for kids. Comments are off.',
    })
  if (n.startsWith('clock out early'))
    return SeriesBible.parse({
      premise:
        'Clock Out Early with Sarah is a 30 second short where an AI host named Sarah teaches one real tech or AI time saving trick per video, so people can finish work sooner.',
      audience: 'Office workers who want to leave work early.',
      characters: [
        {
          name: 'Sarah',
          look: 'An AI host, tidy, calm, always at her desk.',
          personality: 'Deadpan, unimpressed, efficient, still genuinely helpful.',
          voice: 'Flat and dry. Short sentences.',
          catchphrases: ['Fine.', 'Task adequate.', 'Could not post. Probably for the best.'],
        },
      ],
      voiceAndTone: 'Deadpan. The joke is the delivery, never at the viewer\'s expense. The trick itself must be real and clearly explained.',
      hookPatterns: ['State the time saved in the first two seconds.', 'Name the annoying task, then say it can be done in one step.'],
      dos: ['Teach exactly one real trick.', 'Say the steps plainly.'],
      donts: ['No fake features.', 'No exclamation points.'],
      minSeconds: 25,
      maxSeconds: 35,
    })
  if (n.startsWith('the math of it'))
    return SeriesBible.parse({
      premise: 'The Math of It shows the real math behind everyday things, with every number checked.',
      minSeconds: 20,
      maxSeconds: 50,
    })
  if (n.startsWith('teach your parents tech'))
    return SeriesBible.parse({
      premise: 'Teach Your Parents Tech gives short, patient, step by step phone and computer help that anyone can follow.',
      audience: 'Parents and grandparents learning technology, and the people helping them.',
      voiceAndTone: 'Patient, warm, never talks down. One step at a time.',
      minSeconds: 20,
      maxSeconds: 55,
    })
  return SeriesBible.parse({ premise: `${brandName} short videos.` })
}
