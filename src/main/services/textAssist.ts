/** Helps write titles, captions and hashtags with a local language model (Ollama, LM Studio). Off by default. */
export interface TextAssistProvider {
  readonly id: string
  readonly available: boolean
  suggestTitle(input: { brand: string; title: string; caption: string }): Promise<string[]>
  suggestCaption(input: { brand: string; title: string; caption: string }): Promise<string[]>
  suggestHashtags(input: { brand: string; title: string; caption: string }): Promise<string[]>
}

export const noneProvider: TextAssistProvider = {
  id: 'none',
  available: false,
  async suggestTitle() {
    return []
  },
  async suggestCaption() {
    return []
  },
  async suggestHashtags() {
    return []
  },
}

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string }

const isLoopback = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
/** Private network ranges, matched against a COMPLETE IPv4 address so a name like 192.168.1.1.evil.com never passes. */
const isLan = (h: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (m.slice(1).some((x) => Number(x) > 255)) return false
    return (
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    )
  }
  return h.endsWith('.local') || h.endsWith('.lan')
}

/**
 * The model address must be this Mac. A computer on the local network is allowed only when the owner ticks the box.
 * The public internet is never allowed, because the title and caption would leave the house.
 */
export function checkLlmUrl(raw: string, allowLan: boolean): UrlCheck {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { ok: false, message: 'That is not a web address. Example: http://localhost:11434/v1' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { ok: false, message: 'The address must start with http:// or https://' }
  const host = u.hostname.toLowerCase()
  if (isLoopback(host)) return { ok: true, url: u.toString().replace(/\/$/, '') }
  if (isLan(host)) {
    return allowLan
      ? { ok: true, url: u.toString().replace(/\/$/, '') }
      : {
          ok: false,
          message:
            'That is another computer. Tick "My model runs on another computer on my network" to allow it. Your titles and captions are sent there.',
        }
  }
  return {
    ok: false,
    message:
      'Only this Mac (localhost) or a computer on your own network is allowed. Titles and captions are never sent over the internet.',
  }
}

export interface OpenAIConfig {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const SYSTEM =
  'You help a small social media team write short vertical video posts. Reply with ONLY a JSON array of exactly 3 strings and nothing else. No explanation, no markdown. Never use em dashes. Keep the tone plain and a little deadpan.'

/** Pulls a list of suggestions out of whatever the model said: a JSON array, or one idea per line. */
export function parseSuggestions(text: string): string[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(arr))
        return arr
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 5)
    } catch {
      // fall through to lines
    }
  }
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((l) => l && !/^```/.test(l))
    .slice(0, 5)
}

/** Any server that speaks the OpenAI chat completions format. */
export class OpenAICompatibleProvider implements TextAssistProvider {
  readonly id = 'openai-compatible'
  readonly available = true
  constructor(private c: OpenAIConfig) {}

  private async ask(prompt: string): Promise<string> {
    const f = this.c.fetchImpl ?? fetch
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.c.timeoutMs ?? 60_000)
    try {
      const res = await f(`${this.c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({
          model: this.c.model,
          temperature: 0.8,
          max_tokens: 600,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!res.ok) {
        const t = (await res.text().catch(() => '')).slice(0, 160)
        throw new Error(
          res.status === 404
            ? `The model server answered 404. Check the model name "${this.c.model}" and the address.${t ? ' ' + t : ''}`
            : `The model server answered ${res.status}. ${t}`,
        )
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const text = json.choices?.[0]?.message?.content
      if (!text) throw new Error('The model sent back nothing.')
      return text
    } catch (e) {
      if ((e as Error).name === 'AbortError')
        throw new Error('The model took too long to answer.', { cause: e })
      if (/fetch failed|ECONNREFUSED/i.test(String((e as Error).message ?? e)))
        throw new Error('Could not reach the model server. Is Ollama or LM Studio running?', {
          cause: e,
        })
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  async test(): Promise<string> {
    const text = await this.ask('Reply with a JSON array containing the single word "OK".')
    return parseSuggestions(text)[0] ?? text.slice(0, 40)
  }

  suggestTitle(i: { brand: string; title: string; caption: string }): Promise<string[]> {
    return this.ask(
      `Brand: ${i.brand}\nCurrent title: ${i.title || '(none)'}\nCaption: ${i.caption || '(none)'}\nWrite 3 short title options, each under 60 characters.`,
    ).then(parseSuggestions)
  }
  suggestCaption(i: { brand: string; title: string; caption: string }): Promise<string[]> {
    return this.ask(
      `Brand: ${i.brand}\nTitle: ${i.title || '(none)'}\nCurrent caption: ${i.caption || '(none)'}\nWrite 3 caption options, each under 200 characters, with no hashtags.`,
    ).then(parseSuggestions)
  }
  /** Reply ideas for a viewer's comment or message. The owner reads and edits one before anything is sent. */
  suggestReply(i: { kind: 'comment' | 'dm'; brand: string; video: string; text: string }): Promise<string[]> {
    return this.ask(
      `Channel: ${i.brand}\n${i.video ? `Video: ${i.video}\n` : ''}A viewer wrote this ${i.kind === 'dm' ? 'message' : 'comment'}: "${i.text.slice(0, 500)}"\nWrite 3 short, friendly reply options, each under 150 characters. Do not make promises, do not share links, and do not use em dashes.`,
    ).then(parseSuggestions)
  }
  suggestHashtags(i: { brand: string; title: string; caption: string }): Promise<string[]> {
    return this.ask(
      `Brand: ${i.brand}\nTitle: ${i.title || '(none)'}\nCaption: ${i.caption || '(none)'}\nWrite 3 options. Each option is one string of 5 to 8 hashtags separated by spaces, like "#one #two #three".`,
    ).then(parseSuggestions)
  }
}
