import { createHash, randomBytes } from 'crypto'
import type { Db } from '../db'

export type BotRole = 'writer' | 'orchestrator'

export interface Bot {
  id: number
  name: string
  channels: string[]
  role: BotRole
  createdAt: string
  revokedAt: string | null
}

/** Who is calling the API. The owner's own token acts as josh with full access. */
export type Caller = { kind: 'owner'; actor: 'josh' } | { kind: 'bot'; actor: string; bot: Bot }

export const OWNER: Caller = { kind: 'owner', actor: 'josh' }

const hash = (t: string) => createHash('sha256').update(t).digest('hex')

const map = (r: any): Bot => ({
  id: r.id,
  name: r.name,
  channels: JSON.parse(r.channels_json) as string[],
  role: r.role,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
})

/**
 * Bot tokens. Each bot has its own token so the app can tell Grok Bot from Kids Comedy. The token is shown once, when it
 * is made. Only its hash is kept. A revoked token stops working at once.
 */
export class BotStore {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  list(): Bot[] {
    return (this.db.prepare('SELECT * FROM agent_bots ORDER BY id').all() as any[]).map(map)
  }

  get(id: number): Bot | null {
    const r = this.db.prepare('SELECT * FROM agent_bots WHERE id = ?').get(id)
    return r ? map(r) : null
  }

  private token(): string {
    return `elo_bot_${randomBytes(32).toString('base64url')}`
  }

  /** Makes a bot and returns its token. This is the only time the token can be read. */
  create(name: string, channels: string[], role: BotRole): { bot: Bot; token: string } {
    const clean = name.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(clean))
      throw new Error('A bot name uses lowercase letters, numbers and dashes, like grok-bot.')
    if (this.list().some((b) => b.name === clean && !b.revokedAt))
      throw new Error(
        `There is already a bot called ${clean}. Revoke it first or make a new token for it.`,
      )
    const token = this.token()
    const id = Number(
      this.db
        .prepare(
          'INSERT INTO agent_bots (name, token_hash, channels_json, role, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          clean,
          hash(token),
          JSON.stringify([...new Set(channels)]),
          role,
          new Date(this.now()).toISOString(),
        ).lastInsertRowid,
    )
    return { bot: this.get(id) as Bot, token }
  }

  /** A new token replaces the old one at once. */
  regenerate(id: number): { bot: Bot; token: string } {
    const b = this.get(id)
    if (!b) throw new Error('That bot was not found.')
    if (b.revokedAt) throw new Error('That bot is revoked. Make a new bot instead.')
    const token = this.token()
    this.db.prepare('UPDATE agent_bots SET token_hash = ? WHERE id = ?').run(hash(token), id)
    return { bot: b, token }
  }

  update(id: number, patch: { channels?: string[]; role?: BotRole }): Bot {
    const b = this.get(id)
    if (!b) throw new Error('That bot was not found.')
    this.db
      .prepare('UPDATE agent_bots SET channels_json = ?, role = ? WHERE id = ?')
      .run(JSON.stringify(patch.channels ?? b.channels), patch.role ?? b.role, id)
    return this.get(id) as Bot
  }

  revoke(id: number): void {
    this.db
      .prepare('UPDATE agent_bots SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(new Date(this.now()).toISOString(), id)
  }

  /** The bot a token belongs to, or null for an unknown or revoked token. */
  authenticate(token: string): Bot | null {
    const r = this.db
      .prepare('SELECT * FROM agent_bots WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hash(token))
    return r ? map(r) : null
  }
}
