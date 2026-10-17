import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretStore } from '../../src/main/services/secrets'
import { Studio } from '../../src/main/studio/studio'
import { fakeCrypto } from '../googleHelpers'
import { SettingsService } from '../../src/main/services/settings'
import { makeEnv } from '../helpers'

export function makeStudioEnv(opts: { fetchImpl?: typeof fetch; startMs?: number } = {}) {
  const env = makeEnv(opts.startMs)
  const dir = mkdtempSync(join(tmpdir(), 'elo-studio-'))
  const secretFile = join(dir, 'secrets.bin')
  const secrets = new SecretStore(secretFile, fakeCrypto)
  const alerts: Array<[string, string]> = []
  const studio = new Studio({
    db: env.db,
    secrets,
    posts: env.posts,
    media: env.library,
    log: env.log,
    alert: (h, d) => alerts.push([h, d]),
    emit: () => {},
    now: () => env.clock.ms,
    fetchImpl: opts.fetchImpl,
  })
  // The older tests behave like an install that already used the Claude API. New switch tests turn it off.
  new SettingsService(env.db).set({ claudeApiEnabled: true, studioProductionEnabled: true })
  studio.cfg.set({ libraryDir: join(dir, 'Library'), backupDir: join(dir, 'Backups') })
  return { ...env, dir, secrets, secretFile, studio, alerts }
}

export const hollowId = (e: ReturnType<typeof makeStudioEnv>) =>
  (e.db.prepare("SELECT id FROM brands WHERE name LIKE 'Wonder Hollow%'").get() as { id: number }).id

export const minimalPackage = (title: string, extra: Record<string, unknown> = {}) => ({
  series: 'Test',
  episode_number: 1,
  title,
  logline: 'A short test episode.',
  runtime_target_seconds: 180,
  counted_objects: [],
  scenes: [],
  youtube: { title, description: `About ${title}.`, tags: ['test'], made_for_kids: false, ai_disclosure: true },
  tags: ['test'],
  summary: `Summary of ${title}.`,
  ...extra,
})
