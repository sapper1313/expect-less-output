// Sends an iMessage through the Messages app with AppleScript. This file imports nothing from the app
// so it can also be run on its own for a quick test.
import { execFile } from 'child_process'

export interface IMessageResult {
  ok: boolean
  message: string
}

export type ScriptRunner = (
  script: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: ScriptRunner = (script, args) =>
  new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], { timeout: 25_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })

/** Two ways Messages has described "send to this phone number". macOS versions differ, so both are tried. */
const SCRIPTS = {
  participant: `on run argv
  set theNumber to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant theNumber of targetService
    send theText to targetBuddy
  end tell
end run`,
  buddy: `on run argv
  set theNumber to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy theNumber of targetService
    send theText to targetBuddy
  end tell
end run`,
} as const

type Syntax = keyof typeof SCRIPTS

export const PERMISSION_HELP =
  'macOS has not allowed Expect Less Output to control Messages. Open System Settings, then Privacy and Security, then Automation. Find Expect Less Output and switch on Messages. Then press Send test alert again.'
export const SIGNED_OUT_HELP =
  'Messages is not signed in to iMessage on this Mac. Open Messages, choose Settings, then iMessage, and sign in with your Apple ID.'

let working: Syntax | null = null

export function normalizeNumber(raw: string): string | null {
  const n = raw.replace(/[\s().-]/g, '')
  return /^\+?\d{7,15}$/.test(n) ? n : null
}

function explain(err: unknown): { kind: 'permission' | 'signedout' | 'other'; text: string } {
  const e = err as { message?: string; stderr?: string; killed?: boolean }
  const text = `${e.stderr ?? ''} ${e.message ?? ''}`
  if (/-1743|not authorized|not allowed to send apple events/i.test(text))
    return { kind: 'permission', text }
  if (/-1728|-1719|can.t get (account|service)|invalid index/i.test(text))
    return { kind: 'signedout', text }
  if (e.killed) return { kind: 'other', text: 'Messages did not answer in time.' }
  return { kind: 'other', text: text.replace(/\s+/g, ' ').trim() || 'Unknown error.' }
}

/** Sends one iMessage. Remembers which AppleScript form worked. */
export async function sendIMessage(
  number: string,
  text: string,
  runner: ScriptRunner = defaultRunner,
): Promise<IMessageResult> {
  const to = normalizeNumber(number)
  if (!to)
    return {
      ok: false,
      message: `"${number}" does not look like a phone number. Use the form +18045551234.`,
    }
  const order: Syntax[] = working
    ? [working, ...(['participant', 'buddy'] as Syntax[]).filter((s) => s !== working)]
    : ['participant', 'buddy']
  const problems: string[] = []
  for (const syntax of order) {
    try {
      await runner(SCRIPTS[syntax], [to, text])
      working = syntax
      return { ok: true, message: 'Sent through Messages.' }
    } catch (err) {
      const why = explain(err)
      if (why.kind === 'permission') return { ok: false, message: PERMISSION_HELP }
      if (why.kind === 'signedout') {
        problems.push(SIGNED_OUT_HELP)
        continue
      }
      problems.push(why.text)
    }
  }
  const signedOut = problems.every((p) => p === SIGNED_OUT_HELP)
  return {
    ok: false,
    message: signedOut
      ? SIGNED_OUT_HELP
      : `Messages would not send it. ${problems[problems.length - 1]}`,
  }
}

/** For tests. */
export function resetIMessageMemory(): void {
  working = null
}
