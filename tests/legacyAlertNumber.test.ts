import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SettingsService } from '../src/main/services/settings'
import Database from 'better-sqlite3'
import { migrate } from '../src/main/db'

const makeEnv = () => {
  const db = new Database(':memory:')
  migrate(db)
  return { db }
}

const sql = readFileSync(
  join(__dirname, '../src/main/db/migrations/015_alert_number_not_baked_in.sql'),
  'utf8',
)

describe('the alert number is not built in', () => {
  it('a new install starts with iMessage off and no number', () => {
    const env = makeEnv()
    const s = new SettingsService(env.db).get()
    expect(s.alertIMessageNumber).toBe('')
    expect(s.alertIMessageEnabled).toBe(false)
  })

  it('an install that is already in use keeps the number it has been using', () => {
    const env = makeEnv()
    env.db
      .prepare("INSERT INTO activity_log (level, message) VALUES ('info', 'iMessage alert sent.')")
      .run()
    env.db.exec(sql) // the migration, run against a database that has history
    const s = new SettingsService(env.db).get()
    expect(s.alertIMessageNumber).toBe('+18046340444')
    expect(s.alertIMessageEnabled).toBe(true)
  })

  it('never overwrites a number the owner chose', () => {
    const env = makeEnv()
    new SettingsService(env.db).set({
      alertIMessageNumber: '+15551234567',
      alertIMessageEnabled: true,
    })
    env.db
      .prepare("INSERT INTO activity_log (level, message) VALUES ('info', 'iMessage alert sent.')")
      .run()
    env.db.exec(sql)
    expect(new SettingsService(env.db).get().alertIMessageNumber).toBe('+15551234567')
  })
})
