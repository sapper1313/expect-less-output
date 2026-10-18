import type { Db } from '../db'
import { readSetting } from '../services/settings'

/** The four states of a channel. archived beats on-hold beats paused beats active. */
export type ChannelState = 'active' | 'paused' | 'on-hold' | 'archived'

export function channelState(db: Db, brandId: number): ChannelState {
  const b = db.prepare('SELECT archived FROM brands WHERE id = ?').get(brandId) as
    { archived: number } | undefined
  if (!b || b.archived) return 'archived'
  const r = db.prepare('SELECT on_hold FROM channel_rules WHERE brand_id = ?').get(brandId) as
    { on_hold: number } | undefined
  if (r?.on_hold) return 'on-hold'
  return readSetting(db, 'pausedBrandIds').includes(brandId) ? 'paused' : 'active'
}
