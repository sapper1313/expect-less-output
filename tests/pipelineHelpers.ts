import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { InboxWatcher } from '../src/main/agent/inbox'
import type { AgentServices } from '../src/main/agent/core'
import { AuditEvents } from '../src/main/pipeline/auditEvents'
import { DropLog } from '../src/main/pipeline/dropLog'
import { PipelineIntake, type ProbeResult } from '../src/main/pipeline/intake'
import { makeEnv } from './helpers'

export const SEC = 1000
export const sha = (text: string) => createHash('sha256').update(text).digest('hex')

type Env = ReturnType<typeof makeEnv>

/** Wires the real Inbox watcher to the pipeline intake over an in-memory app. */
export function pipelineSetup(
  opts: {
    env?: Env
    probe?: (p: string) => Promise<ProbeResult>
    startMs?: number
    patch?: Record<string, unknown>
    live?: Array<[number, string]>
  } = {},
) {
  const env = opts.env ?? makeEnv(opts.startMs ?? Date.UTC(2026, 9, 19, 14, 0, 0))
  env.settings.set({
    agentMaySchedule: true,
    inboxBrandIds: [1, 2, 3, 4, 5, 6, 7],
    inboxAutoScheduleBrandIds: [1, 2, 3, 4, 5, 6, 7],
    ...(opts.patch ?? {}),
  } as never)
  // Accounts that count as real (the seeded ones are dry runs).
  for (const [brandId, platform] of opts.live ?? [[1, 'youtube']])
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = ? AND platform = ?",
      )
      .run(brandId, platform)
  const notices: Array<[string, string, string]> = []
  const drops = new DropLog(env.db, null, () => env.clock.ms)
  const audit = new AuditEvents(env.db, () => env.clock.ms)
  const pipeline = new PipelineIntake({
    db: env.db,
    settings: env.settings,
    brands: env.brands,
    posts: env.posts,
    library: env.library,
    drops,
    audit,
    log: env.log,
    notify: (kind, h, d) => notices.push([kind, h, d]),
    probe: opts.probe,
    now: () => env.clock.ms,
  })
  const services: AgentServices = {
    settings: env.settings,
    brands: env.brands,
    posts: env.posts,
    scheduler: env.scheduler,
    log: env.log,
    appVersion: 't',
    now: () => env.clock.ms,
    health: () => null,
  }
  const alerts: string[][] = []
  const watcher = new InboxWatcher({
    s: services,
    library: env.library,
    pipeline,
    drops,
    alert: (h, d) => alerts.push([h, d]),
    now: () => env.clock.ms,
  })
  const inboxOf = (brandName: string) => {
    const dir = join(env.root, brandName, 'Inbox')
    mkdirSync(join(dir, 'Rejected'), { recursive: true })
    return dir
  }
  /** Puts a video and its pipeline sidecar in a channel Inbox. */
  const drop = (
    brandName: string,
    slug: string,
    n: number,
    over: Record<string, unknown> = {},
    o: { bytes?: string; file?: string; sidecar?: boolean } = {},
  ) => {
    const inbox = inboxOf(brandName)
    const id = `${slug}-2026-${String(n).padStart(4, '0')}`
    const file = o.file ?? `${id}.mp4`
    const bytes = o.bytes ?? `video bytes for ${id}`
    writeFileSync(join(inbox, file), bytes)
    const sidecar = {
      schema_version: '1.0',
      channel: slug,
      episode_id: id,
      title: `Title ${id}`,
      description: 'A description #fun',
      tags: ['chrome', 'fun'],
      video_file: file,
      platforms: ['youtube', 'tiktok'],
      approval: { approved_by: 'Josh', approved_at: '2026-10-16T15:30:00-04:00' },
      checksum: { algo: 'sha256', value: sha(bytes) },
      source_bot: 'grok-bot',
      ...over,
    }
    if (o.sidecar !== false)
      writeFileSync(join(inbox, file.replace(/\.[^.]+$/, '') + '.json'), JSON.stringify(sidecar))
    return { id, file, inbox, sidecar }
  }
  const settle = async () => {
    await watcher.scan()
    env.clock.ms += 6 * SEC
    return watcher.scan()
  }
  const rejectedFiles = (brandName: string) => readdirSync(join(inboxOf(brandName), 'Rejected'))
  const rejectReasons = (brandName: string) => {
    const f = rejectedFiles(brandName).find((x) => x.endsWith('.reason.json'))
    return f ? JSON.parse(readFileSync(join(inboxOf(brandName), 'Rejected', f), 'utf8')) : null
  }
  return {
    env,
    watcher,
    pipeline,
    drops,
    audit,
    notices,
    alerts,
    drop,
    settle,
    inboxOf,
    rejectedFiles,
    rejectReasons,
    existsSync,
  }
}
