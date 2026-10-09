import { existsSync, readdirSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { Studio } from '../../src/main/studio/studio'
import { probe } from '../../src/main/studio/ffmpeg'
import { buildSrt, parseSegments, parseVision, segmentsFromScript, speechSimilarity } from '../../src/shared/studio/qc'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

vi.setConfig({ testTimeout: 180_000 })

type Env = ReturnType<typeof makeStudioEnv>
const brandId = (e: Env, like: string) => (e.db.prepare('SELECT id FROM brands WHERE name LIKE ?').get(like) as { id: number }).id

/** 10:00 Eastern on Wednesday 2026-06-03, after the 9:00 production run time. */
const WED = Date.UTC(2026, 5, 3, 14)

async function setup(names: string[] = ['Trash Panda%']) {
  const e = makeStudioEnv({ startMs: WED })
  const keep = new Set(names.map((n) => brandId(e, n)))
  for (const b of e.studio.cfg.listBrandConfigs()) {
    if (!keep.has(b.brandId)) await e.studio.setBrand(b.brandId, { paused: true })
    else await e.studio.setBible(b.brandId, { minSeconds: 20, maxSeconds: 30 })
  }
  return { e, ids: [...keep] }
}

/** Writer pass, then a Director pass that starts production. */
async function produce(e: Env) {
  await step(e) // writers
  await step(e) // production
}

/** The episode written for today's slot. The runway also writes later ones. */
const todays = (e: Env, id: number) => e.studio.episodes.list({ brandId: id }).find((x) => x.slotDate === '2026-06-03')!

/** Runs tasks until none are due, moving the test clock on past short waits (a clip still rendering). */
async function settle(e: Env, studio: Studio = e.studio) {
  const deadline = Date.now() + 120_000
  for (let i = 0; i < 200 && Date.now() < deadline; i++) {
    await studio.runner.runUntilIdle()
    const open = studio.tasks.list({ status: ['queued', 'waiting', 'running'] })
    if (!open.length) return
    if (open.every((t) => t.status === 'running')) await new Promise((r) => setTimeout(r, 50))
    else e.clock.ms += 2000
  }
}

/** One Director pass and everything it starts. */
async function step(e: Env, studio: Studio = e.studio) {
  studio.director.tick()
  await settle(e, studio)
}

/** Thumbnail pictures and text answers are in the ledger too; the video tests count only generated seconds. */
const countLedger = (e: Env, where = '1=1') => (e.db.prepare(`SELECT COUNT(*) AS n FROM spend_ledger WHERE ${where}`).get() as { n: number }).n

describe('QC helpers', () => {
  it('compares speech, reads vision answers with confidence, and builds captions', () => {
    expect(speechSimilarity('You can mute a chat in two taps', 'you can mute a chat in two taps')).toBe(1)
    expect(speechSimilarity('You can mute a chat in two taps', 'completely different words here')).toBeLessThan(0.2)
    expect(speechSimilarity('hello there friend', 'hello friend')).toBeCloseTo(2 / 3)
    const v = parseVision('ISSUE: extra fingers CONFIDENCE: HIGH\nISSUE: maybe 7 coins CONFIDENCE: LOW\n')
    expect(v.issues).toEqual(['extra fingers'])
    expect(v.ignored).toEqual(['maybe 7 coins'])
    expect(parseVision('OK').issues).toEqual([])
    const segs = parseSegments('[00:00:00.000 --> 00:00:02.500]  Hello there\n[00:00:02.500 --> 00:00:04.000]  Friend')
    expect(segs).toEqual([{ start: 0, end: 2.5, text: 'Hello there' }, { start: 2.5, end: 4, text: 'Friend' }])
    expect(buildSrt(segs)).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello there\n\n2\n00:00:02,500 --> 00:00:04,000\nFriend\n')
    const fromScript = segmentsFromScript([{ seconds: 10, lines: ['one two', 'three four five six'] }])
    expect(fromScript[0].end).toBeCloseTo(10 / 3, 1)
    expect(fromScript[1].end).toBeCloseTo(10, 1)
  })
})

describe('Producer (shorts)', () => {
  it('a full mock short goes from script to Scheduled with ledger rows and a caption file', async () => {
    const { e, ids } = await setup()
    await produce(e)
    const ep = todays(e, ids[0])
    expect(ep.status).toBe('Scheduled')
    expect(ep, JSON.stringify(e.studio.tasks.list({}).map((t) => [t.type, t.status, t.error]))).toBeTruthy()
    expect(ep.postId).not.toBeNull()
    const post = e.posts.get(ep.postId!)!
    expect(post.status).toBe('scheduled')
    expect(post.targets.map((t) => t.platform).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'youtube'])
    // ledger: one row per clip, mock, purpose first take, with request ids
    const rows = e.db.prepare("SELECT * FROM spend_ledger WHERE vendor = 'xai' AND unit_kind = 'seconds'").all() as Array<{ purpose: string; mock: number; request_id: string; units: number; unit_price: number }>
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.mock === 1 && r.purpose === 'first take' && r.request_id)).toBe(true)
    expect(rows[0].unit_price).toBeCloseTo(0.02) // Lite at 480p
    // the finished video, with a caption file next to it in Queue
    const video = e.library.resolve(post.videoPath)
    expect(existsSync(video)).toBe(true)
    const srt = video.replace(/\.mp4$/, '.srt')
    expect(existsSync(srt)).toBe(true)
    const info = await probe(video)
    expect(info.durationSeconds).toBeGreaterThan(20)
    expect(info.hasAudio).toBe(true)
    // per clip QC log
    const log = await e.studio.clipLog(ep.id)
    expect(log.map((j) => j.status)).toEqual(['passed', 'passed'])
    expect((log[0].qc as { steps: Array<{ name: string }> }).steps.map((s) => s.name)).toContain('ffmpeg')
    // The only alert is the "slot will be missed" notice from the very first pass, before the Writer had run.
    expect(e.alerts.filter(([h]) => h !== 'A posting slot will be missed.')).toEqual([])
  })

  it('a deliberately broken clip (black frames) is retried automatically, ledgered, and passes on the second take', async () => {
    const { e, ids } = await setup()
    e.studio.mockVideo.brokenNext = 1
    await produce(e)
    const ep = todays(e, ids[0])
    expect(ep.status).toBe('Scheduled')
    const jobs = e.studio.jobs.all(ep.id)
    expect(jobs.map((j) => `${j.clipN}:${j.take}:${j.status}`)).toEqual(['1:1:failed', '1:2:passed', '2:1:passed'])
    expect(jobs[0].error).toMatch(/black/)
    expect(jobs[1].purpose).toBe('retry')
    const purposes = (e.db.prepare("SELECT purpose FROM spend_ledger WHERE vendor = 'xai' AND unit_kind = 'seconds' ORDER BY id").all() as Array<{ purpose: string }>).map((r) => r.purpose)
    expect(purposes.sort()).toEqual(['first take', 'first take', 'retry'])
    // the retry prompt was adjusted by the text agent
    expect(jobs[1].prompt).not.toBe(jobs[0].prompt)
  })

  it('a clip that always fails is Flagged after the cap, the alert fires once, and other videos continue', async () => {
    const { e, ids } = await setup(['Trash Panda%', 'Clock Out Early%'])
    await step(e) // writers for both
    const [tp, coe] = [ids[0], ids[1]]
    const badEp = todays(e, tp)
    const pkg = e.studio.episodes.getPackage(badEp.id)!
    pkg.scenes[0].grok_prompt += ' ZZZ-bad'
    e.studio.episodes.savePackage(badEp.id, pkg)
    e.studio.mockVideo.alwaysBrokenFor = 'ZZZ-bad'
    await step(e) // production for both
    const bad = e.studio.episodes.get(badEp.id)
    expect(bad.status).toBe('Flagged')
    expect(bad.flaggedReason).toMatch(/Clip 1 failed after 3 takes/)
    const good = todays(e, coe)
    expect(good.status).toBe('Scheduled')
    expect(e.alerts.filter(([h]) => h === 'Something needs a look.')).toHaveLength(1)
    const t = e.studio.tasks.list({ type: 'produce_episode', status: 'flagged' })
    expect(t).toHaveLength(1)
    // every retry was cap checked and ledgered: 3 takes of clip 1
    expect(e.studio.jobs.all(badEp.id).filter((j) => j.clipN === 1)).toHaveLength(3)
    // Flagged screen actions: edit the prompt and retry
    await e.studio.resolveClip(badEp.id, 1, 'edit', 'A calm host at a desk, clean prompt')
    await settle(e)
    expect(e.studio.episodes.get(badEp.id).status).toBe('Scheduled')
  })

  it('with Ollama stopped, QC degrades to ffmpeg and Whisper checks and logs a clear notice', async () => {
    const { e, ids } = await setup()
    e.studio.cfg.set({ local: { ...e.studio.cfg.get().local, ollamaHost: 'http://127.0.0.1:9' } })
    e.studio.qc.simulate = false
    let heardCalls = 0
    e.studio.qc.hooks.transcribe = async () => {
      heardCalls++
      return 'you can ' + 'mute a chat tip steps clear sound'
    }
    // the stubbed Whisper hears the scripted words
    const original = e.studio.episodes
    void original
    await step(e)
    const ep0 = todays(e, ids[0])
    const pkg = e.studio.episodes.getPackage(ep0.id)!
    e.studio.qc.hooks.transcribe = async () => {
      heardCalls++
      return pkg.scenes.flatMap((s) => s.dialogue.map((l) => l.line)).join(' ')
    }
    await step(e)
    expect(e.studio.episodes.get(ep0.id).status).toBe('Scheduled')
    expect(heardCalls).toBeGreaterThan(0)
    const acts = e.studio.audit.list({ agent: 'Local AI' }).map((a) => a.action)
    expect(acts).toContain('fallback_ffmpeg_only')
    const jobs = e.studio.jobs.all(ep0.id)
    const steps = (jobs[0].qc as { steps: Array<{ name: string; via: string; note: string }> }).steps
    expect(steps.find((s) => s.name === 'visual')!.note).toMatch(/only the ffmpeg and Whisper checks/)
    expect(steps.find((s) => s.name === 'speech')!.via).toBe('whisper')
  })

  it('a wrong transcript fails the speech check and the clip is retried', async () => {
    const { e, ids } = await setup()
    e.studio.qc.simulate = false
    e.studio.cfg.set({ local: { ...e.studio.cfg.get().local, ollamaHost: 'http://127.0.0.1:9' } })
    let n = 0
    await step(e)
    const ep0 = todays(e, ids[0])
    const lines = e.studio.episodes.getPackage(ep0.id)!.scenes.flatMap((s) => s.dialogue.map((l) => l.line)).join(' ')
    e.studio.qc.hooks.transcribe = async () => (++n === 1 ? 'banana helicopter nonsense' : lines)
    await step(e)
    const jobs = e.studio.jobs.all(ep0.id)
    expect(jobs[0].error).toMatch(/speech does not match/)
    expect(e.studio.episodes.get(ep0.id).status).toBe('Scheduled')
  })

  it('killing the app mid job and relaunching resumes with no duplicate ledger rows', async () => {
    const { e, ids } = await setup()
    e.studio.mockVideo.delayMs = 6 * 3_600_000 // the clips are still rendering when the app is killed
    await step(e) // writers
    await step(e) // production starts, clips are rendering
    const ep = todays(e, ids[0])
    expect(ep.status).toBe('In production')
    expect(e.studio.jobs.all(ep.id).map((j) => j.status)).toEqual(['started', 'started'])
    expect(countLedger(e, "vendor = 'xai' AND unit_kind = 'seconds'")).toBe(2)
    // "kill": a task left running, and every in memory object gone
    const t = e.studio.tasks.list({ type: 'produce_episode' })[0]
    expect(e.studio.tasks.claim(t.id)).toBe(true)
    const reborn = new Studio({ db: e.db, secrets: e.secrets, posts: e.posts, media: e.library, log: e.log, alert: () => {}, emit: () => {}, now: () => e.clock.ms })
    expect(reborn.tasks.recoverRunning()).toBe(1)
    e.clock.ms += 5000 // time passes while the app is closed
    await settle(e, reborn)
    expect(reborn.episodes.get(ep.id).status).toBe('Scheduled')
    expect(countLedger(e, "vendor = 'xai' AND unit_kind = 'seconds'")).toBe(2) // nothing paid twice
    expect(e.db.prepare("SELECT COUNT(DISTINCT request_id) AS n FROM spend_ledger WHERE vendor = 'xai' AND unit_kind = 'seconds'").get()).toEqual({ n: 2 })
    expect(reborn.jobs.all(ep.id)).toHaveLength(2)
  })

  it('the opening is generated once and reused on the second episode with zero added cost', async () => {
    const { e, ids } = await setup()
    const id = ids[0]
    await e.studio.setBrand(id, { useOpeningOutro: true })
    const r = await e.studio.generateSlot(id, 'opening', 'A bright logo sting')
    expect(r.mock).toBe(true)
    expect(countLedger(e, "purpose = 'intro'")).toBe(1)
    expect(e.studio.assets.slot(id, 'opening')).not.toBeNull()
    await produce(e)
    const first = todays(e, id)
    const afterFirst = countLedger(e, "vendor = 'xai' AND unit_kind = 'seconds'")
    const info1 = await probe(e.library.resolve(e.posts.get(first.postId!)!.videoPath))
    expect(info1.durationSeconds).toBeGreaterThan(25 + 4) // two clips plus the 5 second opening
    // a second episode
    e.clock.ms += 3 * 86_400_000
    await produce(e)
    const second = e.studio.episodes.list({ brandId: id }).filter((x) => x.status === 'Scheduled')
    expect(second.length).toBeGreaterThanOrEqual(2)
    expect(countLedger(e, "purpose = 'intro'")).toBe(1) // never generated again
    const perEpisode = countLedger(e, "vendor = 'xai' AND unit_kind = 'seconds'") - afterFirst
    expect(perEpisode).toBe(2 * (second.length - 1)) // only each new episode's two clips, nothing for the opening
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE purpose = 'intro' AND dollars > 0").get()).toEqual({ n: 1 })
    // the slot file itself is on disk once
    expect(readdirSync(e.studio.assets.dir(id)).filter((f) => f.startsWith('opening'))).toHaveLength(1)
  })

  it('production waits for the brand run time', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 11) }) // 07:00 Eastern
    for (const b of e.studio.cfg.listBrandConfigs()) if (b.config.format !== 'short' || b.name !== 'Trash Panda') await e.studio.setBrand(b.brandId, { paused: true })
    await step(e)
    await step(e)
    expect(e.studio.tasks.list({ type: 'produce_episode' })).toHaveLength(0)
    e.clock.ms = Date.UTC(2026, 5, 3, 14)
    await step(e)
    expect(e.studio.tasks.list({ type: 'produce_episode' }).length).toBeGreaterThan(0)
  })
})

describe('Producer (Hollow through the API, optional)', () => {
  it('chains each scene from the last frame of the one before, trims at 10 seconds, and crossfades', async () => {
    const e = makeStudioEnv({ startMs: WED })
    const s = e.studio
    const hid = hollowId(e)
    for (const b of s.cfg.listBrandConfigs()) if (b.brandId !== hid) await s.setBrand(b.brandId, { paused: true })
    await s.setBrand(hid, { hollowViaApi: true, captionMode: 'off' })
    const scenes = [1, 2, 3].map((n) => ({
      n,
      content_seconds: 10,
      generate_seconds: n === 3 ? 15 : 10,
      setting: 'workshop',
      characters: [],
      action: `scene ${n}`,
      dialogue: [],
      objects_in_frame: [],
      camera: '',
      transition_in: '',
      transition_out: '',
      grok_prompt: `Soft 3D animated workshop scene ${n}`,
      extension_note: '',
    }))
    const row = s.episodes.create(hid, minimalPackage('Chain test', { scenes, runtime_target_seconds: 30 }) as never, { status: 'Ready for production', slotDate: '2026-06-05' })
    await s.tick() // Friday window opens Wednesday
    expect(s.episodes.get(row.id).status, JSON.stringify(s.tasks.list({}).map((t) => [t.type, t.status, t.error]))).toBe('Scheduled')
    const started = s.mockVideo.started
    expect(started).toHaveLength(3)
    expect(started[0].imageUrl).toBeUndefined()
    expect(started[1].imageUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(started[2].durationSeconds).toBe(15) // billed at the full generated seconds
    const rows = e.db.prepare("SELECT units, dollars FROM spend_ledger WHERE vendor = 'xai' AND unit_kind = 'seconds' ORDER BY id").all() as Array<{ units: number; dollars: number }>
    expect(rows.map((r) => r.units)).toEqual([10, 10, 15])
    // 16:9 at 720p Standard: $0.14 per second
    expect(rows[2].dollars).toBeCloseTo(15 * 0.14, 5)
    const post = e.posts.get(s.episodes.get(row.id).postId!)!
    const info = await probe(e.library.resolve(post.videoPath))
    expect(info.durationSeconds).toBeGreaterThan(28)
    expect(info.durationSeconds).toBeLessThan(30.2) // 3 x 10 seconds minus two 0.4 second crossfades
    expect(post.targets.map((t) => t.platform)).toEqual(['youtube'])
  })
})
