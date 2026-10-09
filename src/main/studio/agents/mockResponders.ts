import type { MockLlm } from './llm'
import { readCtx } from './prompts'

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

const TOPICS: Array<{ title: string; trick: string; summary: string }> = [
  { title: 'Stop retyping the same email', trick: 'save a text shortcut so one short word types your whole reply', summary: 'Use a text shortcut for repeated replies.' },
  { title: 'Silence a noisy group chat in two taps', trick: 'mute the thread without leaving it', summary: 'Mute a busy group chat.' },
  { title: 'Find any file by what is inside it', trick: 'search file contents instead of file names', summary: 'Search inside documents.' },
  { title: 'Make your inbox sort itself', trick: 'set one rule that files newsletters away', summary: 'Auto sort email with a rule.' },
  { title: 'Never miss a meeting link again', trick: 'pin the link to the calendar invite', summary: 'Pin meeting links.' },
  { title: 'Turn a long thread into three bullets', trick: 'ask an assistant to summarize the thread', summary: 'Summarize long threads.' },
  { title: 'Copy from your phone, paste on your laptop', trick: 'turn on the shared clipboard', summary: 'Shared clipboard.' },
  { title: 'Record your screen in one shortcut', trick: 'use the built in screen recorder shortcut', summary: 'Quick screen recording.' },
  { title: 'Fix a blurry scan in seconds', trick: 'use the document scanner mode', summary: 'Clean document scans.' },
  { title: 'Undo a deleted file you thought was gone', trick: 'open the recently deleted folder', summary: 'Recover deleted files.' },
  { title: 'Find the setting everyone forgets', trick: 'search the settings instead of scrolling', summary: 'Search settings.' },
  { title: 'Split a bill without a calculator', trick: 'type the total and the people count into the search bar', summary: 'Split bills in search.' },
  { title: 'Stop the endless password resets', trick: 'let a password manager fill your logins', summary: 'Use a password manager.' },
  { title: 'Rename fifty files at once', trick: 'select them all and rename in one batch', summary: 'Batch rename files.' },
  { title: 'Get a calendar reminder from an email', trick: 'drag the email onto the calendar', summary: 'Email to calendar event.' },
  { title: 'Read a PDF out loud while you cook', trick: 'turn on read aloud', summary: 'Read aloud for PDFs.' },
  { title: 'Translate a menu with your camera', trick: 'point the camera and tap translate', summary: 'Camera translate.' },
  { title: 'Shrink a huge photo before you send it', trick: 'pick a smaller size in the share sheet', summary: 'Resize photos.' },
  { title: 'Dictate a whole page instead of typing', trick: 'press the dictation key and speak', summary: 'Dictation.' },
  { title: 'Keep two windows side by side', trick: 'snap windows to each half of the screen', summary: 'Snap windows.' },
  { title: 'Block the spam calls for good', trick: 'silence unknown callers', summary: 'Silence unknown callers.' },
  { title: 'Back up your phone while you sleep', trick: 'switch on the nightly backup', summary: 'Nightly backup.' },
  { title: 'Share one folder instead of ten files', trick: 'send a single shared folder link', summary: 'Share a folder.' },
  { title: 'Draft a polite no in ten seconds', trick: 'ask an assistant for a kind short refusal', summary: 'Polite refusal.' },
  { title: 'Charge your phone faster without a new cable', trick: 'turn on airplane mode while it charges', summary: 'Charge faster.' },
  { title: 'Make text bigger everywhere', trick: 'raise the text size once in settings', summary: 'Bigger text.' },
  { title: 'Find your lost phone from your laptop', trick: 'use the find my device page', summary: 'Find a lost phone.' },
  { title: 'Scan a code without another app', trick: 'point the camera at the code', summary: 'Scan codes.' },
  { title: 'Clean up your desktop in one click', trick: 'sort files into stacks', summary: 'Desktop stacks.' },
  { title: 'Turn a photo into editable text', trick: 'copy text straight from the picture', summary: 'Copy text from photos.' },
]

const OBJECTS = ['acorns', 'lanterns', 'wooden spoons', 'paper boats', 'seed packets', 'copper keys', 'clay pots', 'ribbon spools', 'bird feathers', 'tin cups']
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function pick<T>(list: T[], ctx: Record<string, any>): T {
  const seed = hash(String(ctx.brand ?? '')) % list.length
  return list[(dayIndex(String(ctx.slotDate ?? '2026-01-01')) * 7 + seed + (ctx.attempt ?? 0) * 11) % list.length]
}

function mockShort(ctx: Record<string, any>) {
  const t = pick(TOPICS, ctx)
  const min = Number(ctx.minSeconds ?? 15)
  const max = Number(ctx.maxSeconds ?? 60)
  const target = Math.round((min + max) / 2)
  const n = Math.max(1, Math.ceil(target / 15))
  const each = Math.min(15, Math.round((target / n) * 10) / 10)
  const sign = (ctx.catchphrases as string[] | undefined)?.[0] ?? 'That is all.'
  const hook = `You can ${t.trick} and it takes seconds.`
  const mathLines = ctx.checks?.math ? ' Quick math: 7 x 8 = 56, so 56 minutes saved in a week of eight daily minutes.' : ''
  const stepLines = ctx.checks?.steps ? ' Step 1: open the settings. Step 2: search for the option. Step 3: switch it on.' : ''
  const clips = Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    seconds: each,
    prompt: `Vertical video, a calm host at a tidy desk, ${i === 0 ? 'looking at the camera while explaining the idea' : 'a close shot of the screen showing the steps'}, soft office light, clear speech.`,
    dialogue: i === 0 ? [hook] : [i === n - 1 ? sign : `Next, ${t.trick}.`],
  }))
  return {
    title: t.title,
    idea: `Show how to ${t.trick}.`,
    hook,
    script: `${hook} Here is the trick: ${t.trick}.${stepLines}${mathLines} ${sign}`,
    clips,
    caption: `${t.title}. ${t.summary}`,
    hashtags: ['#tech', '#timesaver', '#worksmarter'],
    youtube: { title: t.title, description: `${t.summary} A quick trick you can use today.`, tags: ['tech tips', 'time saver'] },
    summary: t.summary,
    tags: ['tip', t.title.split(' ')[0].toLowerCase()],
    key_lines: [hook],
  }
}

function mockHollow(ctx: Record<string, any>) {
  const h = hash(`${ctx.slotDate}${ctx.attempt ?? 0}`)
  const obj = OBJECTS[(dayIndex(String(ctx.slotDate)) + (ctx.attempt ?? 0) * 3) % OBJECTS.length]
  const qty = 3 + (h % 7) // 3 to 9
  const word = WORD[qty]
  const total = 18
  const countScenes = [4, 5, 6, 7]
  // Spread counting one number at a time over the counting scenes.
  const perScene: number[][] = countScenes.map(() => [])
  for (let i = 1; i <= qty; i++) perScene[(i - 1) % countScenes.length].push(i)
  const scenes = Array.from({ length: total }, (_, i) => {
    const n = i + 1
    const ci = countScenes.indexOf(n)
    const counting = ci >= 0
    const nums = counting ? perScene[ci] : []
    const dialogue = counting
      ? nums.map((v) => ({ speaker: 'Pip', line: `${WORD[v][0].toUpperCase()}${WORD[v].slice(1)}!` }))
      : n === total
        ? [{ speaker: 'Crew', line: 'Thank you for visiting. See you next time!' }]
        : [{ speaker: 'Moss', line: 'Let us keep going, friends.' }]
    return {
      n,
      content_seconds: 10,
      generate_seconds: n % 3 === 0 ? 15 : 10,
      setting: 'The cozy Hollow workshop with warm lamps and a long wooden workbench',
      characters: ['Pip', 'Moss', 'Juniper'],
      action:
        n === 4
          ? `The crew finds exactly ${word} ${obj} lined up on the workbench and begins to count them`
          : counting
            ? `The crew keeps counting and the ${obj} stay in frame on the workbench`
            : n === total
              ? 'The crew waves and sings a goodbye as the Hollow logo appears'
              : `The crew works together on the next small step of the project, scene ${n}`,
      dialogue,
      objects_in_frame: counting ? [obj] : [],
      camera: 'gentle push in at eye level',
      transition_in: n === 1 ? 'fade in' : 'continues from the last frame',
      transition_out: n === total ? 'ends on the Hollow logo' : 'smooth handoff to the next scene',
      grok_prompt:
        n === 4
          ? `Soft 3D animated style, three friendly woodland workshop friends at a wooden workbench with exactly ${word} ${obj} placed in a neat row, cheerful counting, warm lamp light.`
          : counting
            ? `Soft 3D animated style, the same woodland friends counting at the workbench while the ${obj} stay clearly in frame, warm light, gentle camera.`
            : `Soft 3D animated style, friendly woodland workshop friends working together in a cozy workshop, scene ${n}, warm light, gentle camera.`,
      extension_note: n % 3 === 0 ? 'Generated at 15 seconds so the next scene can start from the last frame.' : '',
    }
  })
  const title = `Counting ${obj} in the Hollow ${(h % 90) + 10}`
  return {
    title,
    idea: `The crew counts ${obj} to finish a small project.`,
    logline: `The crew counts ${obj} together and learns that sharing makes work lighter.`,
    life_lesson: 'Sharing the work makes it lighter.',
    math_lesson: `Counting to ${qty}, one number at a time.`,
    runtime_target_seconds: 180,
    counted_objects: [{ name: obj, quantity: qty, scenes: countScenes }],
    scenes,
    youtube: { title: `${title} | Wonder Hollow Workshop`, description: `The crew counts ${qty} ${obj}. A gentle story about sharing, with counting practice for little ones.`, tags: ['kids', 'counting', 'learning'] },
    thumbnail_brief: `The three friends smiling over exactly ${word} ${obj} on the workbench, bright warm colors.`,
    summary: `Counting ${qty} ${obj} and sharing the work.`,
    tags: ['counting', 'sharing'],
    key_lines: [`The crew finds exactly ${word} ${obj}`],
  }
}

/** Canned but varied answers for mock mode. They obey the lengths, counts and style rules in the context line. */
export function registerMockResponders(mock: MockLlm): void {
  mock.respond('Show Writer', (req) => {
    const ctx = readCtx(req.user)
    if (ctx.task === 'ideas') {
      const base = TOPICS.slice(0, 10).map((t, i) => `${t.title} ${i + 1 + (ctx.round ?? 0) * 10}`)
      return { ideas: base }
    }
    return ctx.format === 'long' ? mockHollow(ctx) : mockShort(ctx)
  })
  mock.respond('Producer', (req) => ({ prompt: `${String(readCtx(req.user).prompt ?? 'A scene')} Steady, well lit and clearly visible, with clear sound.` }))
  mock.respond('Thumbnail', (req) => {
    const c = readCtx(req.user)
    const title = String(c.title ?? 'New episode')
    const words = title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
    const n = Number(c.count ?? 3)
    const heads = [words.slice(0, 4).join(' '), words.slice(-3).join(' '), `Watch ${words[0] ?? 'this'} now`.split(' ').slice(0, 4).join(' ')]
    return { concepts: Array.from({ length: n }, (_, i) => ({ headline: heads[i % heads.length] || 'Watch this', image_prompt: `A bold clear scene for ${title}, option ${i + 1}`, use_video_frame: i === n - 1 && n > 2 })) }
  })
  mock.respond('Publisher', (req) => {
    const c = readCtx(req.user)
    const platforms = (c.platforms as string[]) ?? []
    const title = String(c.title ?? 'New episode')
    const tags = ((c.hashtags as string[]) ?? []).map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`)).slice(0, 3)
    const base = String(c.caption || c.summary || title)
    const out: Record<string, unknown> = {}
    if (platforms.includes('youtube')) out.youtube = { title: title.slice(0, 100), description: String(c.description || base), tags: tags.map((t) => t.slice(1)) }
    if (platforms.includes('instagram')) out.instagram = { caption: `${base} ${tags.join(' ')}`.trim() }
    if (platforms.includes('facebook')) out.facebook = { caption: `${base} ${tags.slice(0, 2).join(' ')}`.trim() }
    if (platforms.includes('tiktok')) out.tiktok = { caption: `${base} ${tags.join(' ')}`.trim() }
    if (platforms.includes('threads')) out.threads = { text: `${title}. ${String(c.summary ?? '')}`.slice(0, 380) }
    if (platforms.includes('bluesky')) out.bluesky = { text: `${title}. ${String(c.summary ?? '')}`.slice(0, 240) }
    return out
  })
  mock.respond('Script QC', () => ({ pass: true, fixes: [] }))
  mock.respond('Hollow Safety Checker', () => ({ pass: true, issues: [] }))
  mock.respond('Math Checker', () => ({ claims: [], outdated: [] }))
  mock.respond('Repetition Guard', () => ({ similar: false, to: '', reason: '' }))
}
