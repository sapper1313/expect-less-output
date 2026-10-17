import { homedir } from 'os'
import { join } from 'path'
import type { Db } from '../db'
import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  mediaRoot: process.env['ELO_MEDIA_ROOT'] ?? join(homedir(), 'Movies', 'Expect Less Output'),
  schedulingMode: 'both',
  handoffHoursYoutube: 3,
  handoffHoursFacebook: 3,
  missedBehavior: 'post_if_recent',
  missedGraceMinutes: 120,
  launchAtLogin: false,
  schedulerPaused: false,
  theme: 'dark',
  dryRunFailPlatform: null,
  dryRunFailKind: 'transient',
  fastBackoff: false,
  tiktokRequestPublishScope: false,
  alertIMessageEnabled: false,
  alertIMessageNumber: '',
  alertEmailEnabled: false,
  alertEmailFrom: '',
  alertEmailTo: '',
  alertQuietEnabled: false,
  alertQuietStart: '22:00',
  alertQuietEnd: '08:00',
  pausedBrandIds: [],
  agentApiEnabled: false,
  agentApiPort: 47821,
  agentMaySchedule: false,
  agentMayChangeStudio: false,
  inboxBrandIds: [],
  inboxAutoScheduleBrandIds: [],
  llmProvider: 'none',
  llmBaseUrl: 'http://localhost:11434/v1',
  llmModel: '',
  llmAllowLan: false,
  tiktokRequestStatsScope: false,
  claudeApiEnabled: false,
  studioProductionEnabled: false,
  pipelineIntakeEnabled: true,
  pipelineStrict: true,
  pipelineRequireApproval: true,
  pipelineDuplicateDetection: true,
  pipelineSourceBots: ['grok-bot', 'kids-comedy', 'beth'],
  pipelineNotifyKinds: ['accepted', 'rejected', 'scheduled', 'posted', 'failed', 'reconcile'],
  retryMinutes: [5, 15, 60],
  blackoutDates: [],
  minGapMinutes: 0,
  reconcileAutoFix: false,
  retentionDays: 30,
  lowQueueDays: 3,
  globalDryRun: false,
}

export class SettingsService {
  constructor(private db: Db) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as Array<{
      key: string
      value_json: string
    }>
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (r.key in DEFAULT_SETTINGS) {
        try {
          out[r.key] = JSON.parse(r.value_json)
        } catch {
          // keep default when a stored value is unreadable
        }
      }
    }
    return out as unknown as Settings
  }

  set(patch: Partial<Settings>): Settings {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
    )
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULT_SETTINGS) upsert.run(k, JSON.stringify(v ?? null))
      }
    })()
    return this.get()
  }
}

/** Reads one setting straight from the database, for code that has no SettingsService. */
export function readSetting<K extends keyof Settings>(db: Db, key: K): Settings[K] {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    { value_json: string } | undefined
  if (!row) return DEFAULT_SETTINGS[key]
  try {
    return JSON.parse(row.value_json) as Settings[K]
  } catch {
    return DEFAULT_SETTINGS[key]
  }
}
