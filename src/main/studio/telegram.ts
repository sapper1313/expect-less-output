/**
 * A chat with the studio from the owner's phone, through a Telegram bot. The bot only answers the chats that were
 * paired with a one time code from the app. Questions are answered from a plain text snapshot of the studio, by the
 * owner's own model. The only things it can change are pause and resume, and only after the owner says YES.
 */
export interface TelegramState {
  enabled: boolean
  chatIds: number[]
  code: string | null
  offset: number
}

export interface TelegramDeps {
  token: () => string | null
  fetchImpl?: typeof fetch
  load: () => TelegramState
  save: (s: TelegramState) => void
  snapshot: () => Promise<{ text: string; status: string; latest: string }>
  ask: (system: string, user: string) => Promise<string>
  setPaused: (paused: boolean) => Promise<void>
  log: (m: string) => void
  code?: () => string
  now?: () => number
}

export const EMPTY_STATE: TelegramState = { enabled: false, chatIds: [], code: null, offset: 0 }

interface Update {
  update_id: number
  message?: { chat: { id: number; type: string }; text?: string }
}

const SYSTEM = [
  'You are the studio assistant for the owner of a small video studio. You are chatting with them by text message on their phone.',
  'Answer only from the facts below. If the facts do not say, tell them you do not know. Never invent numbers.',
  'Keep it short and friendly, plain words, no lists longer than 6 lines, and never use em dashes.',
  'You cannot change anything. If they want the studio paused or resumed, tell them to send /pause or /resume.',
].join(' ')

export class TelegramAssistant {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private pending = new Map<number, 'pause' | 'resume'>()
  private warned = new Map<number, number>()
  constructor(private d: TelegramDeps) {}

  private get f(): typeof fetch {
    return this.d.fetchImpl ?? fetch
  }
  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  private async api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const token = this.d.token()
    if (!token) throw new Error('The Telegram bot token is not saved yet.')
    const res = await this.f(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (!res.ok || !j?.ok) throw new Error(`Telegram said no: ${j?.description ?? `HTTP ${res.status}`}`)
    return j.result as T
  }

  async test(): Promise<string> {
    const me = await this.api<{ username?: string; first_name?: string }>('getMe')
    return `Connected to the bot @${me.username ?? me.first_name ?? 'unknown'}.`
  }

  status() {
    const s = this.d.load()
    return { enabled: s.enabled, hasToken: !!this.d.token(), paired: s.chatIds.length, code: s.code }
  }

  newCode(): string {
    const code = this.d.code ? this.d.code() : String(Math.floor(100000 + Math.random() * 900000))
    this.d.save({ ...this.d.load(), code })
    return code
  }

  unpairAll(): void {
    this.d.save({ ...this.d.load(), chatIds: [], code: null })
  }

  setEnabled(on: boolean): void {
    this.d.save({ ...this.d.load(), enabled: on })
    if (on) this.start()
    else this.stop()
  }

  start(): void {
    if (this.timer || !this.d.load().enabled) return
    this.timer = setInterval(() => void this.pollOnce().catch((e) => this.d.log(`Telegram: ${(e as Error).message}`)), 4000)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Tells every paired chat something (used for alerts). */
  async notify(text: string): Promise<void> {
    const s = this.d.load()
    if (!s.enabled || !this.d.token()) return
    for (const id of s.chatIds) await this.send(id, text).catch(() => undefined)
  }

  private async send(chatId: number, text: string): Promise<void> {
    for (let i = 0; i < text.length || i === 0; i += 3800)
      await this.api('sendMessage', { chat_id: chatId, text: text.slice(i, i + 3800), disable_web_page_preview: true })
  }

  async pollOnce(): Promise<number> {
    if (this.busy || !this.d.token() || !this.d.load().enabled) return 0
    this.busy = true
    try {
      const s = this.d.load()
      const updates = await this.api<Update[]>('getUpdates', { offset: s.offset, timeout: 0, allowed_updates: ['message'] })
      for (const u of updates) {
        this.d.save({ ...this.d.load(), offset: u.update_id + 1 })
        const m = u.message
        if (m?.text && m.chat.type === 'private') await this.handle(m.chat.id, m.text.trim()).catch((e) => this.d.log(`Telegram reply failed: ${(e as Error).message}`))
      }
      return updates.length
    } finally {
      this.busy = false
    }
  }

  async handle(chatId: number, text: string): Promise<void> {
    const s = this.d.load()
    if (!s.chatIds.includes(chatId)) {
      if (s.code && text === s.code) {
        this.d.save({ ...s, chatIds: [...s.chatIds, chatId], code: null })
        await this.send(chatId, 'Paired. Ask me anything about your channels, or send /help.')
        return
      }
      const last = this.warned.get(chatId) ?? 0
      if (this.now() - last > 10 * 60_000) {
        this.warned.set(chatId, this.now())
        await this.send(chatId, 'I only talk to my owner. In the app open Settings, Alerts and backup, press Show pairing code, then send me that number.')
      }
      return
    }
    const lower = text.toLowerCase()
    const pend = this.pending.get(chatId)
    if (pend && (lower === 'yes' || lower === 'y')) {
      this.pending.delete(chatId)
      await this.d.setPaused(pend === 'pause')
      await this.send(chatId, pend === 'pause' ? 'Done. The whole studio is paused.' : 'Done. The studio is running again.')
      return
    }
    this.pending.delete(chatId)
    if (lower === '/start' || lower === '/help')
      return this.send(chatId, 'Ask me things like "how is the last post doing?" or "how much have I spent?". Quick commands: /status, /latest, /spend, /flags, /pause, /resume.')
    if (lower === '/pause' || lower === '/resume') {
      this.pending.set(chatId, lower === '/pause' ? 'pause' : 'resume')
      return this.send(chatId, `Reply YES to ${lower === '/pause' ? 'pause everything' : 'resume everything'}. Anything else cancels.`)
    }
    const snap = await this.d.snapshot()
    if (lower === '/status') return this.send(chatId, snap.status)
    if (lower === '/latest') return this.send(chatId, snap.latest)
    if (lower === '/spend' || lower === '/flags') {
      const key = lower === '/spend' ? /^Spend/ : /^Needs|^Nothing needs/
      return this.send(chatId, snap.text.split('\n').filter((l) => key.test(l)).join('\n') || 'No information.')
    }
    const answer = await this.d.ask(`${SYSTEM}\n\nFacts:\n${snap.text}`, text.slice(0, 600))
    await this.send(chatId, answer.trim() || 'I did not get an answer. Try again in a moment.')
  }
}
