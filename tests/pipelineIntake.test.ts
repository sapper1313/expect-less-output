import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { pipelineSetup, sha } from './pipelineHelpers'

const TP = 'Trash Panda'
const probeOf =
  (w: number, h: number, secs = 30, audio = true) =>
  async () => ({
    width: w,
    height: h,
    durationSeconds: secs,
    hasAudio: audio,
  })

describe('pipeline drop: accept and schedule (tests 2, 4)', () => {
  it('accepts a valid drop, logs its sha256 and gives it the slot nextSlots returns', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920) })
    const expected = t.env.posts.nextSlots(1, 1)[0]
    const d = t.drop(TP, 'trash-panda', 7)
    expect(await t.settle()).toBe(1)
    const post = t.env.posts.list().find((p) => p.episodeRef === d.id)!
    expect(post).toMatchObject({
      status: 'scheduled',
      origin: 'inbox',
      brandId: 1,
      sourceBot: 'grok-bot',
    })
    expect(post.scheduledAtUtc).toBe(expected)
    expect(post.checksum).toBe(sha(`video bytes for ${d.id}`))
    // Only the real account stays; TikTok is a dry run so it is skipped (A1).
    expect(post.targets.map((x) => x.platform)).toEqual(['youtube'])
    const [row] = t.drops.list()
    expect(row).toMatchObject({
      result: 'accepted',
      sha256: post.checksum,
      scheduledSlot: expected,
      channel: 'trash-panda',
      approvedBy: 'Josh',
    })
    expect(row.notes).toMatch(/Skipped \(no real account\): tiktok/)
    expect(t.notices.map((n) => n[0])).toEqual(
      expect.arrayContaining(['drop_accepted', 'scheduled']),
    )
    // The caption carries the missing tags as hashtags, and the existing one is not repeated.
    expect(post.caption).toBe('A description #fun\n\n#chrome')
    expect(existsSync(join(t.env.root, TP, 'Queue', `${d.id}.json`))).toBe(true)
  })

  it('ignores preferred_slot and says so', async () => {
    const t = pipelineSetup()
    const expected = t.env.posts.nextSlots(1, 1)[0]
    t.drop(TP, 'trash-panda', 8, { preferred_slot: '2030-01-01T12:00:00-05:00' })
    await t.settle()
    const post = t.env.posts.list()[0]
    expect(post.scheduledAtUtc).toBe(expected)
    expect(t.drops.list()[0].notes).toMatch(/Ignored: the schedule is set in ELO/)
  })
})

describe('pipeline drop: rejects (tests 5, 6, 8, 16, 19)', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['no approval', { approval: undefined }, /approval/],
    ['wrong channel', { channel: 'clock-out-early' }, /Inbox/],
    ['bad checksum', { checksum: { algo: 'sha256', value: 'a'.repeat(64) } }, /checksum/],
    ['unknown bot', { source_bot: 'some-other-bot' }, /allowed list/],
    ['wrong video_file', { video_file: 'other.mp4' }, /video_file/],
    ['bad episode id', { episode_id: 'COE-E007' }, /episode_id/],
  ]
  for (const [name, patch, re] of cases)
    it(`rejects ${name} with .error.txt and .reason.json, and tells the owner`, async () => {
      const t = pipelineSetup()
      t.drop(TP, 'trash-panda', 9, patch)
      await t.settle()
      expect(t.env.posts.list()).toHaveLength(0)
      const files = t.rejectedFiles(TP)
      expect(files.some((f) => f.endsWith('.error.txt'))).toBe(true)
      const reason = t.rejectReasons(TP)
      expect(JSON.stringify(reason.reasons)).toMatch(re)
      expect(t.drops.list()[0].result).toBe('rejected')
      expect(t.notices.some((n) => n[0] === 'drop_rejected')).toBe(true)
      expect(t.audit.list().some((e) => e.action === 'drop.rejected')).toBe(true)
    })

  it('marks the same video or the same episode as a duplicate and does not schedule it', async () => {
    const t = pipelineSetup()
    t.drop(TP, 'trash-panda', 10)
    await t.settle()
    t.drop(TP, 'trash-panda', 10) // same episode, same bytes
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(1)
    expect(t.drops.list()[0].result).toBe('duplicate')
    t.drop(TP, 'trash-panda', 11, {}, { bytes: 'video bytes for trash-panda-2026-0010' }) // same bytes, new id
    await t.settle()
    expect(t.drops.list()[0]).toMatchObject({ result: 'duplicate' })
    expect(t.drops.list()[0].reason).toMatch(/already dropped/)
    expect(t.env.posts.list()).toHaveLength(1)
  })

  it('does not touch a video that has no sidecar yet (partial drop)', async () => {
    const t = pipelineSetup()
    t.drop(TP, 'trash-panda', 12, {}, { sidecar: false })
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(0)
    expect(t.drops.list()).toHaveLength(0)
  })

  it('leaves files alone when intake is off', async () => {
    const t = pipelineSetup({ patch: { pipelineIntakeEnabled: false } })
    const d = t.drop(TP, 'trash-panda', 13)
    expect(await t.settle()).toBe(0)
    expect(existsSync(join(d.inbox, d.file))).toBe(true)
    expect(t.env.posts.list()).toHaveLength(0)
  })

  it('checks the format per channel: 16:9 fails a short, 9:16 passes it, and the length and sound count', async () => {
    const wide = pipelineSetup({ probe: probeOf(1920, 1080) })
    wide.drop(TP, 'trash-panda', 14)
    await wide.settle()
    expect(wide.rejectReasons(TP).reasons[0].code).toBe('bad_format')
    const long = pipelineSetup({ probe: probeOf(1080, 1920, 600) })
    long.drop(TP, 'trash-panda', 15)
    await long.settle()
    expect(long.rejectReasons(TP).reasons[0].code).toBe('bad_duration')
    const mute = pipelineSetup({ probe: probeOf(1080, 1920, 30, false) })
    mute.drop(TP, 'trash-panda', 16)
    await mute.settle()
    expect(mute.rejectReasons(TP).reasons[0].code).toBe('no_audio')
    const ok = pipelineSetup({ probe: probeOf(1080, 1920) })
    ok.drop(TP, 'trash-panda', 17)
    await ok.settle()
    expect(ok.env.posts.list()).toHaveLength(1)
  })

  it('honors .ready by skipping the wait', async () => {
    const t = pipelineSetup()
    const d = t.drop(TP, 'trash-panda', 18)
    writeFileSync(join(d.inbox, d.file.replace('.mp4', '.ready')), '')
    expect(await t.watcher.scan()).toBe(1)
  })
})

describe('Oct 13 safeguards (test 7)', () => {
  it('holds a drop whose file name does not carry the episode id', async () => {
    const t = pipelineSetup()
    t.drop(TP, 'trash-panda', 20, {}, { file: 'episode-final.mp4' })
    await t.settle()
    const post = t.env.posts.list()[0]
    expect(post.status).toBe('draft')
    expect(post.holdReason).toMatch(/does not contain the episode id/)
    expect(t.drops.list()[0].result).toBe('held')
  })

  it('catches a file swapped after scheduling, right before posting, and holds the post without sending it', async () => {
    const t = pipelineSetup()
    const d = t.drop(TP, 'trash-panda', 21)
    await t.settle()
    const post = t.env.posts.list()[0]
    expect(post.status).toBe('scheduled')
    writeFileSync(t.env.library.resolve(post.videoPath), 'a DIFFERENT video')
    const { verifyPipelinePost } = await import('../src/main/pipeline/verify')
    expect(await verifyPipelinePost(t.env.db, t.env.library, post.id)).toMatch(
      /changed after it was dropped/,
    )
    void d
  })

  it('holds when the stored title no longer matches the drop, but an owner edit moves both', async () => {
    const t = pipelineSetup()
    t.drop(TP, 'trash-panda', 22)
    await t.settle()
    const post = t.env.posts.list()[0]
    const { verifyPipelinePost } = await import('../src/main/pipeline/verify')
    t.env.posts.update(post.id, { title: 'Owner edit' })
    expect(await verifyPipelinePost(t.env.db, t.env.library, post.id)).toBeNull()
    t.env.db.prepare('UPDATE posts SET title = ? WHERE id = ?').run('Someone else', post.id)
    expect(await verifyPipelinePost(t.env.db, t.env.library, post.id)).toMatch(/title/)
  })

  it('the scheduler holds a swapped file instead of posting it, and logs what is sent when it is fine', async () => {
    const t = pipelineSetup()
    t.drop(TP, 'trash-panda', 23)
    await t.settle()
    const post = t.env.posts.list()[0]
    const { verifyPipelinePost } = await import('../src/main/pipeline/verify')
    ;(t.env.scheduler as unknown as { d: { preflight: unknown } }).d.preflight = (id: number) =>
      verifyPipelinePost(t.env.db, t.env.library, id)
    t.env.clock.ms = new Date(post.scheduledAtUtc!).getTime() + 1000
    writeFileSync(t.env.library.resolve(post.videoPath), 'swapped!')
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    const after = t.env.posts.get(post.id)!
    expect(after.holdReason).toMatch(/changed after it was dropped/)
    expect(after.status).not.toBe('posted')
    expect(after.targets.every((x) => x.status !== 'posted')).toBe(true)
  })
})

describe('waiting drops and resume (tests 20, 21)', () => {
  it('a channel with no real account accepts the drop and keeps it waiting; resume refuses until an account exists, then schedules in arrival order', async () => {
    const env = makeEnv(Date.UTC(2026, 9, 19, 14, 0, 0))
    const bh = env.brands.create('Backup Heroes', '#22AA88')
    const id = bh.id
    const t = pipelineSetup({ env, live: [[1, 'youtube']], patch: { pausedBrandIds: [id] } })
    const BH = 'Backup Heroes'
    t.drop(BH, 'backup-heroes', 1)
    t.env.clock.ms += 1000
    t.drop(BH, 'backup-heroes', 2)
    await t.settle()
    const waiting = t.env.posts.list().filter((p) => p.brandId === id)
    expect(waiting.map((p) => p.status)).toEqual(['draft', 'draft'])
    expect(t.pipeline.waitingPostIds(id)).toHaveLength(2)
    expect(t.pipeline.resumeProblem(id)).toMatch(/Connect an account first/)
    const refused = await t.pipeline.scheduleWaiting(id)
    expect(refused.scheduled).toBe(0)
    expect(refused.message).toMatch(/Connect an account first/)
    t.env.db
      .prepare(
        "UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = ? AND platform = 'youtube'",
      )
      .run(id)
    expect(t.pipeline.resumeProblem(id)).toBeNull()
    const ok = await t.pipeline.scheduleWaiting(id)
    expect(ok.scheduled).toBe(2)
    const after = t.env.posts.list().filter((p) => p.brandId === id)
    expect(after.every((p) => p.status === 'scheduled')).toBe(true)
    const [a, b] = [
      after.find((p) => p.episodeRef!.endsWith('0001'))!,
      after.find((p) => p.episodeRef!.endsWith('0002'))!,
    ]
    expect(new Date(a.scheduledAtUtc!).getTime()).toBeLessThan(
      new Date(b.scheduledAtUtc!).getTime(),
    )
  })

  it('auto-schedule off and a paused channel both leave the drop waiting', async () => {
    const off = pipelineSetup({ patch: { inboxAutoScheduleBrandIds: [] } })
    off.drop(TP, 'trash-panda', 30)
    await off.settle()
    expect(off.env.posts.list()[0].status).toBe('draft')
    const paused = pipelineSetup({ patch: { pausedBrandIds: [1] } })
    paused.drop(TP, 'trash-panda', 31)
    await paused.settle()
    expect(paused.env.posts.list()[0].status).toBe('draft')
    expect(
      readFileSync(join(paused.env.root, TP, 'Queue', 'trash-panda-2026-0031.json'), 'utf8'),
    ).toContain('schema_version')
  })
})

describe('Wonder Hollow Wednesday and Friday (test 3)', () => {
  it('three drops on a Monday land on Wednesday, Friday and the next Wednesday', async () => {
    const { makeStudioEnv, hollowId } = await import('./studio/helpers')
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 19, 14, 0, 0) })
    const id = hollowId(e)
    e.brands.setSlotKinds(id, [{ kind: 'short', enabled: false, days: null }, { kind: 'long', enabled: true, days: [3, 5] }])
    const t = pipelineSetup({ env: e, live: [[id, 'youtube']] })
    const slug = e.brands.get(id).slug!
    expect(slug).toBe('wonder-hollow')
    for (const n of [1, 2, 3]) {
      t.drop('Wonder Hollow Workshop', slug, n, { platforms: ['youtube'] })
      e.clock.ms += 1000
    }
    await t.settle()
    await t.settle()
    await t.settle()
    const days = e.posts.list({ brandId: id }).map((p) =>
      new Date(p.scheduledAtUtc!).toLocaleDateString('en-US', {
        weekday: 'short',
        timeZone: 'America/New_York',
        month: 'numeric',
        day: 'numeric',
      }),
    )
    expect(days).toEqual(['Wed, 10/21', 'Fri, 10/23', 'Wed, 10/28'])
  })
})
