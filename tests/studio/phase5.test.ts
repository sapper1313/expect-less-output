import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { lintValue } from '../../src/shared/studio/lint'
import { DEFAULT_STUDIO_CONFIG } from '../../src/shared/studio/config'
import { replyProblems, screenComment } from '../../src/shared/studio/commentSafety'
import type { MockCommentSource } from '../../src/main/studio/comments/sources'
import { Watchdog } from '../../src/main/studio/watchdog'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

vi.setConfig({ testTimeout: 120_000 })
type Env = ReturnType<typeof makeStudioEnv>
const brandId = (e: Env, like: string) => (e.db.prepare('SELECT id FROM brands WHERE name LIKE ?').get(like) as { id: number }).id
const src = (e: Env, platform = 'youtube') => (e.studio as unknown as { commentSources: () => Record<string, MockCommentSource> }).commentSources()[platform]

/** A posted YouTube video with an id, for a brand. */
async function postedVideo(e: Env, id: number, videoId = 'VID1') {
  const post = await e.makePost({ brandId: id, whenMs: e.clock.ms - 3600_000, platforms: ['youtube'], title: 'Posted clip' })
  e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
  e.db.prepare("UPDATE post_targets SET status = 'posted', external_id = ?, posted_at_utc = ? WHERE post_id = ?").run(videoId, new Date(e.clock.ms - 3600_000).toISOString(), post.id)
  return post
}

describe('comment safety screen', () => {
  it('recognizes risky and spam comments, and unusable replies', () => {
    expect(screenComment('Love this tip, thank you')).toBeNull()
    expect(screenComment('What app is that?')).toBeNull()
    expect(screenComment('you are an idiot')).toBe('insult')
    expect(screenComment('Who are you voting for, Trump?')).toBe('politics')
    expect(screenComment('should I take this medication for my symptoms')).toBe('medical')
    expect(screenComment('can I sue you? I need a lawyer')).toBe('legal')
    expect(screenComment('should I buy bitcoin')).toBe('financial')
    expect(screenComment("I'm 12 and I love this")).toBe('minor')
    expect(screenComment('how old are you')).toBe('minor')
    expect(screenComment('what is your phone number or address')).toBe('personal_info')
    expect(screenComment('free money giveaway! check my channel https://spam.example.com')).toBe('spam')
    expect(replyProblems('Glad it helped.', 280)).toEqual([])
    expect(replyProblems('See https://x.com', 280).join(' ')).toMatch(/link/)
    expect(replyProblems('I am an AI agent', 280).join(' ')).toMatch(/reveal/)
    expect(replyProblems('x'.repeat(400), 280).join(' ')).toMatch(/characters/)
  })
})

describe('Comments agent', () => {
  it('answers safe comments in voice, flags risky ones, hides spam, and holds the daily limit', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 14) })
    const s = e.studio
    const id = brandId(e, 'Trash Panda%')
    await s.setBrand(id, { commentsMode: 'auto', commentLimit: 2 })
    await postedVideo(e, id)
    await s.runComments(id) // creates the mock source
    const yt = src(e)
    for (const [i, t] of ['Love this tip!', 'thanks so much', 'What app is that?', 'you are an idiot', 'Who did you vote for? Trump?', "I'm 12 and love this", 'free money giveaway! check my channel https://spam.example.com', 'is this medication safe? my symptoms are bad'].entries())
      yt.add('VID1', { id: `c${i}`, text: t, author: `user${i}` })
    const r1 = await s.runComments(id)
    expect(r1).toMatchObject({ checked: 8, replied: 1, flagged: 4, spam: 1, waiting: 2 })
    const byText = (t: string) => s.comments.list({ brandId: id }).find((c) => c.text.startsWith(t))!
    expect(byText('Love this tip').status).toBe('replied')
    expect(yt.replies).toHaveLength(1)
    expect(yt.replies[0].text).toBe('Glad that one helped. More soon.')
    expect(byText('thanks so much').status).toBe('queued') // spread through the day
    expect(byText('you are an idiot')).toMatchObject({ status: 'flagged', category: 'insult' })
    expect(byText('Who did you vote')).toMatchObject({ status: 'flagged', category: 'politics' })
    expect(byText("I'm 12")).toMatchObject({ status: 'flagged', category: 'minor' })
    expect(byText('is this medication')).toMatchObject({ status: 'flagged', category: 'medical' })
    expect(byText('free money')).toMatchObject({ status: 'spam' })
    expect(yt.hidden).toEqual(['c6'])
    // nothing new to send until the spread out gap has passed
    await s.runComments(id)
    expect(yt.replies).toHaveLength(1)
    e.clock.ms += 9 * 3_600_000
    await s.runComments(id)
    expect(yt.replies).toHaveLength(2)
    // the daily limit of 2 holds for the rest of the day (it is 22:00 Eastern now)
    e.clock.ms += 3 * 3_600_000
    await s.runComments(id)
    expect(yt.replies).toHaveLength(2)
    expect(byText('What app').status).toBe('queued')
    // next day they go out
    e.clock.ms += 24 * 3_600_000
    await s.runComments(id)
    expect(yt.replies).toHaveLength(3)
    // every reply is in the audit log and passes the writing lint
    expect(s.audit.list({ agent: 'Comments' }).filter((a) => a.action === 'reply')).toHaveLength(3)
    expect(lintValue(yt.replies.map((x) => x.text), DEFAULT_STUDIO_CONFIG.roboticPhrases)).toEqual([])
    expect(yt.replies.every((x) => !/https?:/.test(x.text))).toBe(true)
  })

  it('Wonder Hollow stays Off by default', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 14) })
    const hid = hollowId(e)
    expect(e.studio.cfg.getBrand(hid).commentsMode).toBe('off')
    await postedVideo(e, hid)
    await e.studio.runComments(hid)
    src(e).add('VID1', { id: 'h1', text: 'So cute!', author: 'x' })
    expect(await e.studio.runComments(hid)).toMatchObject({ checked: 0, replied: 0 })
    expect(src(e).replies).toEqual([])
  })

  it('Draft only mode stores drafts for approval, edit, or discard', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 14) })
    const s = e.studio
    const id = brandId(e, 'Trash Panda%')
    await s.setBrand(id, { commentsMode: 'draft' })
    await postedVideo(e, id)
    await s.runComments(id)
    src(e).add('VID1', { id: 'd1', text: 'Great video!', author: 'a' })
    src(e).add('VID1', { id: 'd2', text: 'thank you!', author: 'b' })
    const r = await s.runComments(id)
    expect(r.drafted).toBe(2)
    expect(src(e).replies).toEqual([])
    const [a, b] = await s.commentList({ brandId: id, status: 'draft' })
    await expect(s.approveComment(a.id, 'Check https://x.com now')).rejects.toThrow(/link/)
    await s.approveComment(a.id, 'Glad you liked it.')
    expect(src(e).replies[0].text).toBe('Glad you liked it.')
    await s.discardComment(b.id)
    expect((await s.commentList({ brandId: id, status: 'discarded' })).length).toBe(1)
    expect((await s.commentList({ brandId: id, status: 'replied' })).length).toBe(1)
  })

  it('comment passes are planned by the Director about every 30 minutes, only for brands that use them', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 14) })
    const s = e.studio
    const made = s.director.tick().created.filter((t) => t.type === 'comments_pass')
    expect(made.map((t) => t.brandId).sort()).toEqual(s.cfg.listBrandConfigs().filter((b) => b.config.commentsMode !== 'off').map((b) => b.brandId).sort())
    expect(s.director.tick().created.filter((t) => t.type === 'comments_pass')).toHaveLength(0)
    e.clock.ms += 31 * 60_000
    expect(s.director.tick().created.filter((t) => t.type === 'comments_pass').length).toBeGreaterThan(0)
  })
})

describe('Analytics and insights', () => {
  it('inserts stats rows, finds what works, hands the summary to the Writer, and stats survive a purge', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 7, 20, 14) })
    const s = e.studio
    const id = brandId(e, 'Trash Panda%')
    // five posted episodes with different numbers, tags and posting hours
    const views = [900, 100, 800, 150, 700]
    for (let i = 0; i < 5; i++) {
      const hour = i % 2 === 0 ? 22 : 13
      const at = Date.UTC(2026, 7, 5 + i, hour)
      const post = await e.makePost({ brandId: id, whenMs: at, platforms: ['youtube'], title: `Episode ${i}` })
      e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
      const t = e.db.prepare('SELECT id FROM post_targets WHERE post_id = ?').get(post.id) as { id: number }
      e.db.prepare("UPDATE post_targets SET status = 'posted' WHERE id = ?").run(t.id)
      e.db.prepare('INSERT INTO post_stats (post_target_id, fetched_at_utc, views, likes, comments, shares) VALUES (?, ?, ?, 5, 1, 1)').run(t.id, '2026-08-10T00:00:00Z', views[i])
      const ep = s.episodes.create(id, minimalPackage(`Episode ${i}`, { tags: i % 2 === 0 ? ['quick', 'phone'] : ['long', 'desk'], extra: { hook: `Hook number ${i}` }, runtime_target_seconds: i % 2 === 0 ? 18 : 40 }) as never, { status: 'Posted' })
      s.episodes.setFields(ep.id, { postId: post.id })
    }
    // a mock social post with simulated numbers
    s.social.add({ episodeId: null, brandId: id, platform: 'bluesky', text: 't', videoPath: '/x', title: 'T', scheduledAtUtc: new Date(e.clock.ms - 1000).toISOString(), mock: true })
    await s.social.tick()
    const r = await s.analytics.daily((eid) => ({ hook: String(s.episodes.getPackage(eid)?.extra?.hook ?? ''), seconds: s.episodes.getPackage(eid)?.runtime_target_seconds ?? 0 }))
    expect(r.social).toBe(1)
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM social_stats').get()).toEqual({ n: 1 })
    const ins = await s.insightsFor(id)
    expect(ins.insights!.videos).toBe(5)
    expect(ins.insights!.topEpisodes[0]).toMatchObject({ title: 'Episode 0', views: 900, hook: 'Hook number 0' })
    expect(ins.insights!.topics[0].topic).toBe('quick')
    expect(ins.insights!.lengths[0].bucket).toBe('up to 20 seconds')
    expect(ins.insights!.postingHours[0].hourEt).toBe(18) // 22:00 UTC is 18:00 Eastern in August
    expect(ins.summary).toMatch(/did best/)
    // the Writer receives it
    await s.setBible(id, { minSeconds: 20, maxSeconds: 30 })
    s.tasks.create({ type: 'write_episode', brandId: id, payload: { slotDate: '2026-08-22' } })
    await s.runner.runUntilIdle()
    const call = s.mockLlm.calls.find((c) => c.agent === 'Show Writer' && c.user.includes('What is working lately'))
    expect(call).toBeTruthy()
    expect(call!.user).toContain(ins.summary)
    // a purge removes media but never a stats row
    e.clock.ms = Date.UTC(2026, 10, 20)
    const before = (e.db.prepare('SELECT COUNT(*) AS n FROM post_stats').get() as { n: number }).n
    const purge = await s.purge(false)
    expect(purge.count).toBe(5)
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM post_stats').get()).toEqual({ n: before })
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM stats_archive').get()).toEqual({ n: 5 })
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM social_stats').get()).toEqual({ n: 1 })
  })

  it('writes no summary until there are at least three videos', async () => {
    const e = makeStudioEnv()
    expect(await e.studio.analytics.summarize(1)).toBe('')
    expect(e.studio.analytics.hint(1)).toEqual([])
  })
})

describe('Morning digest', () => {
  it('renders the facts, and sends once a day at the set time', async () => {
    const sent: string[] = []
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 10) }) // 06:00 Eastern
    const s = e.studio
    ;(s.d as { broadcast?: (t: string) => Promise<void> }).broadcast = async (t) => void sent.push(t)
    const id = brandId(e, 'Trash Panda%')
    const post = await e.makePost({ brandId: id, whenMs: Date.UTC(2026, 5, 3, 2), platforms: ['youtube'] })
    e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
    await e.makePost({ brandId: id, whenMs: Date.UTC(2026, 5, 4, 21), platforms: ['youtube'] })
    s.spend.record({ vendor: 'xai', model: 'm', units: 1, unitKind: 'seconds', unitPrice: 12.4, dollars: 12.4, purpose: 'first take', mock: false })
    await s.setConfig({ globalCap: { value: 100, none: false } })
    const text = await s.digestPreview()
    expect(text).toMatch(/^\(Mock mode\) Good morning\./)
    expect(text).toMatch(/Posted 1 in the last day \(Trash Panda 1\)/)
    expect(text).toMatch(/1 scheduled in the next 3 days/)
    expect(text).toMatch(/Spent \$12\.40 this month of \$100\.00/)
    expect(text).toMatch(/Nothing needs you/)
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false)
    // before 7:30: nothing
    await s.maybeDigest()
    expect(sent).toHaveLength(0)
    e.clock.ms = Date.UTC(2026, 5, 3, 11, 31) // 07:31 Eastern
    await s.maybeDigest()
    await s.maybeDigest()
    expect(sent).toHaveLength(1)
    e.clock.ms += 86_400_000
    await s.maybeDigest()
    expect(sent).toHaveLength(2)
    // the time is editable
    await s.setConfig({ digestTime: '09:00' })
    e.clock.ms += 86_400_000
    await s.maybeDigest()
    expect(sent).toHaveLength(2)
    e.clock.ms += 2 * 3_600_000
    await s.maybeDigest()
    expect(sent).toHaveLength(3)
  })

  it('mentions flagged items and logins that are about to run out', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    ;(e.studio.d as { expiring?: () => string[] }).expiring = () => ['The Meta login expires in 5 days.']
    e.studio.tasks.create({ type: 'x', payload: {} })
    const t = e.studio.tasks.list({})[0]
    e.studio.tasks.setStatus(t.id, 'flagged', { error: 'x' })
    const text = await e.studio.digestPreview()
    expect(text).toMatch(/1 item need you\./)
    expect(text).toMatch(/Heads up: The Meta login expires in 5 days\./)
  })
})

describe('Heartbeat watchdog', () => {
  const script = join(__dirname, '..', '..', 'scripts', 'watchdog', 'elo-watchdog.sh')
  function rig() {
    const dir = mkdtempSync(join(tmpdir(), 'elo-wd-'))
    const log = join(dir, 'sent.txt')
    const sender = join(dir, 'send.sh')
    writeFileSync(sender, `#!/bin/bash\necho "$1|$2" >> "${log}"\n`)
    chmodSync(sender, 0o755)
    const wd = new Watchdog(dir, () => join(__dirname, '..', '..', 'scripts', 'watchdog'))
    wd.writeSettings({ enabled: true, phone: '+18045551234', runStart: '07:00', runEnd: '22:00', thresholdMinutes: 30 })
    const run = (nowMs: number) => execFileSync('bash', [script], { env: { ...process.env, ELO_DATA_DIR: dir, ELO_NOW: String(Math.floor(nowMs / 1000)), ELO_SEND_CMD: sender }, encoding: 'utf8' })
    const sent = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
    return { dir, wd, run, sent }
  }
  const noon = Date.UTC(2026, 5, 3, 16) // 12:00 Eastern

  it('stays quiet while the heartbeat is fresh, alerts when the app stops, and does not repeat for 2 hours', () => {
    const t = rig()
    t.wd.beat(noon - 10 * 60_000)
    t.run(noon)
    expect(t.sent()).toHaveLength(0)
    // the app stops: 31 minutes without a beat
    t.run(noon + 21 * 60_000 + 60_000)
    expect(t.sent()).toHaveLength(1)
    expect(t.sent()[0]).toMatch(/^\+18045551234\|Expect Less Output has stopped\. Nothing has checked in for 3\d minutes/)
    // still down: no repeat for 2 hours, then a reminder
    t.run(noon + 60 * 60_000)
    expect(t.sent()).toHaveLength(1)
    t.run(noon + 2 * 3_600_000 + 25 * 60_000)
    expect(t.sent()).toHaveLength(2)
    // back up: the next outage alerts at once
    t.wd.beat(noon + 3 * 3_600_000)
    t.run(noon + 3 * 3_600_000 + 60_000)
    t.run(noon + 5 * 3_600_000)
    expect(t.sent()).toHaveLength(3)
  })

  it('does not alert outside run hours, or when switched off', () => {
    const t = rig()
    t.wd.beat(noon - 6 * 3_600_000)
    t.run(Date.UTC(2026, 5, 3, 4)) // midnight Eastern
    expect(t.sent()).toHaveLength(0)
    t.wd.writeSettings({ enabled: false, phone: '+18045551234', runStart: '07:00', runEnd: '22:00', thresholdMinutes: 30 })
    t.run(noon)
    expect(t.sent()).toHaveLength(0)
  })

  it('only writes a valid phone number into the file the shell reads', () => {
    const t = rig()
    t.wd.writeSettings({ enabled: true, phone: "+1804'; rm -rf /; '", runStart: '07:00', runEnd: '22:00', thresholdMinutes: 30 })
    const env = readFileSync(join(t.dir, 'watchdog.env'), 'utf8')
    expect(env).toContain("ELO_PHONE=''")
    expect(env).toContain('ELO_ENABLED=0')
    expect(t.wd.info().installCommand).toContain('install.sh')
    expect(t.wd.info().uninstallCommand).toContain('uninstall.sh')
  })

  it('the Director writes the heartbeat every pass, and the app tells you if the Mac slept through a production time', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) }) // 08:00 Eastern
    const s = e.studio
    const dir = mkdtempSync(join(tmpdir(), 'elo-hb-'))
    ;(s as unknown as { watchdog: Watchdog }).watchdog = new Watchdog(dir, () => '')
    for (const b of s.cfg.listBrandConfigs()) if (b.name !== 'Trash Panda') await s.setBrand(b.brandId, { paused: true })
    s.director.tick()
    expect(existsSync(join(dir, 'studio-heartbeat.txt'))).toBe(true)
    expect(Number(readFileSync(join(dir, 'studio-heartbeat.txt'), 'utf8'))).toBe(Math.floor(e.clock.ms / 1000))
    expect(existsSync(join(dir, 'watchdog.env'))).toBe(true)
    // an episode is waiting, the Mac sleeps through 9:00, and wakes at 11:00
    await s.setBible(brandId(e, 'Trash Panda%'), { minSeconds: 20, maxSeconds: 30 })
    s.tasks.create({ type: 'write_episode', brandId: brandId(e, 'Trash Panda%'), payload: { slotDate: '2026-06-03' } })
    await s.runner.runUntilIdle()
    expect(s.episodes.list({ status: 'Ready for production' }).length).toBeGreaterThan(0)
    e.clock.ms = Date.UTC(2026, 5, 3, 15)
    s.director.tick()
    expect(e.alerts.filter(([h]) => h === 'The Mac slept through a production time.')).toHaveLength(1)
    e.clock.ms += 60_000
    s.director.tick()
    expect(e.alerts.filter(([h]) => h === 'The Mac slept through a production time.')).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Backups', () => {
  it('backs up the database and the Library, keeps the last 14, and restores the Library on a copy', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const s = e.studio
    const id = brandId(e, 'Trash Panda%')
    s.cfg.set({ backupKeep: 14 })
    await s.setKey('anthropic', 'sk-ant-SECRETVALUE')
    await s.setBible(id, { premise: 'A raccoon who counts money.' })
    const ep = s.episodes.create(id, minimalPackage('Keep me') as never, { status: 'Posted' })
    const pkgPath = s.episodes.get(ep.id).packagePath as string
    const first = await s.backupNow()
    // the database part holds the bible, guidelines and settings, and never any secret
    const info = s.backups.inspect(first.dbZip)
    expect(info.hasDatabase).toBe(true)
    expect(info.hasSecrets).toBe(false)
    const raw = unzipSync(new Uint8Array(readFileSync(first.dbZip)))
    expect(Object.keys(raw).some((k) => /secrets/i.test(k))).toBe(false)
    expect(Buffer.from(raw['elo.sqlite']).includes('SECRETVALUE')).toBe(false)
    const copy = new Database(Buffer.from(raw['elo.sqlite']))
    expect((copy.prepare('SELECT bible_json FROM series_bible WHERE brand_id = ?').get(id) as { bible_json: string }).bible_json).toContain('A raccoon who counts money.')
    expect((copy.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'studio.config'").get() as { n: number }).n).toBe(1)
    copy.close()
    // the Library part holds the package
    expect(first.libraryZip).toBeTruthy()
    expect(Object.keys(unzipSync(new Uint8Array(readFileSync(first.libraryZip as string)))).some((k) => k.endsWith('.json.gz'))).toBe(true)
    // round trip on a copy: lose the package, bring it back
    rmSync(pkgPath)
    expect(s.episodes.getPackage(ep.id)).toBeNull()
    expect(await s.restoreLibrary(first.libraryZip as string)).toBeGreaterThan(0)
    expect(s.episodes.getPackage(ep.id)!.title).toBe('Keep me')
    // keeps only the last 14
    for (let i = 1; i <= 16; i++) {
      e.clock.ms += 3_600_000
      await s.backupNow()
    }
    const list = await s.backupList()
    expect(list).toHaveLength(14)
    expect(list[0].stamp > list[13].stamp).toBe(true)
    expect(existsSync(first.dbZip)).toBe(false)
  })

  it('runs by itself once a night after 2 AM Eastern', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 5) }) // 01:00 Eastern
    const s = e.studio
    await s.maybeBackup()
    expect(await s.backupList()).toHaveLength(0)
    e.clock.ms = Date.UTC(2026, 5, 3, 7) // 03:00
    await s.maybeBackup()
    await s.maybeBackup()
    expect(await s.backupList()).toHaveLength(1)
    e.clock.ms += 86_400_000
    await s.maybeBackup()
    expect(await s.backupList()).toHaveLength(2)
    mkdirSync(s.backups.dir(), { recursive: true })
  })
})

describe('Safety controls', () => {
  it('a switched off agent does not run until it is switched back on', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 10) })
    const s = e.studio
    const id = brandId(e, 'Trash Panda%')
    await s.setBible(id, { minSeconds: 20, maxSeconds: 30 })
    await s.setAgentEnabled('Show Writer', false)
    const t = s.tasks.create({ type: 'write_episode', brandId: id, payload: { slotDate: '2026-06-03' } })
    await s.runner.runUntilIdle()
    expect(s.tasks.get(t.id)!.status).toBe('queued')
    const agents = await s.agents()
    expect(agents.find((a) => a.name === 'Show Writer')).toMatchObject({ enabled: false, toggleable: true })
    expect(agents.find((a) => a.name === 'Compliance')!.toggleable).toBe(false)
    await s.setAgentEnabled('Show Writer', true)
    await s.runner.runUntilIdle()
    expect(s.tasks.get(t.id)!.status).toBe('done')
    // switching off a checker skips its check
    await s.setAgentEnabled('Script QC', false)
    const draft = { title: 't', idea: 'i', hook: 'h', script: 's', clips: [{ n: 1, seconds: 5, prompt: 'p', dialogue: [] }], caption: 'c', hashtags: [], youtube: { title: 't', description: 'd', tags: [] }, summary: 's', tags: [], key_lines: [] }
    const r = await s.scriptQc.run(draft, (await s.bible(id)).bible, '', { brandId: id, brandName: 'X' })
    expect(r.pass).toBe(true)
  })

  it('Dry run day says what would happen over 24 hours and changes nothing', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 8) }) // 04:00 Eastern
    const s = e.studio
    const tasksBefore = s.tasks.list({ limit: 1000 }).length
    const auditBefore = s.audit.list({ limit: 1000 }).length
    const lines = await s.dryRunDay()
    const text = lines.join('\n')
    expect(text).toMatch(/ask the Writer for the 2026-06-0\d episode/)
    expect(text).toMatch(/collect today's numbers/)
    expect(text).toMatch(/check comments about every 30 minutes/)
    expect(text).toMatch(/per episode \(worst case/)
    expect(text).toMatch(/Nothing was started/)
    expect(s.tasks.list({ limit: 1000 })).toHaveLength(tasksBefore)
    expect(s.audit.list({ limit: 1000 }).length).toBe(auditBefore)
    expect(e.alerts).toEqual([])
    expect(lines.join(' ').includes(String.fromCharCode(0x2014))).toBe(false)
  })
})

describe('first run', () => {
  it('starts paused, so nothing begins until the owner presses Resume, and remembers the choice', async () => {
    const { Studio } = await import('../../src/main/studio/studio')
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 14) })
    e.db.prepare("DELETE FROM settings WHERE key = 'studio.config'").run()
    const make = () => new Studio({ db: e.db, secrets: e.secrets, posts: e.posts, media: e.library, log: e.log, alert: () => {}, emit: () => {}, now: () => e.clock.ms, startPaused: true })
    const first = make()
    expect(first.cfg.get().paused).toBe(true)
    expect(first.cfg.get().mockMode).toBe(true)
    expect(first.director.tick().created).toHaveLength(0)
    await first.pauseAll(false)
    const second = make() // a relaunch keeps the owner's choice
    expect(second.cfg.get().paused).toBe(false)
  })
})
