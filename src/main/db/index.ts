import Database from 'better-sqlite3'

export type Db = Database.Database

const migrationFiles = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  )
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  )
  const files = Object.entries(migrationFiles)
    .map(([path, sql]) => {
      const name = path.split('/').pop() as string
      return { version: parseInt(name.split('_')[0], 10), name, sql }
    })
    .sort((a, b) => a.version - b.version)
  const pending = files.filter((m) => !applied.has(m.version))
  if (!pending.length) return
  // Rebuilding a table needs foreign keys off, and that cannot be changed inside a transaction. Rows that point at
  // the rebuilt tables are checked afterwards.
  const fk = db.pragma('foreign_keys', { simple: true }) === 1
  db.pragma('foreign_keys = OFF')
  try {
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql)
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(m.version, m.name, new Date().toISOString())
      })()
    }
    const bad = db.pragma('foreign_key_check') as unknown[]
    if (bad.length)
      throw new Error(`The database update left ${bad.length} row(s) pointing at missing data.`)
  } finally {
    db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`)
  }
}

/** The newest migration this build knows about. A backup from a newer build cannot be restored here. */
export function latestSchemaVersion(): number {
  return Math.max(
    ...Object.keys(migrationFiles).map((p) =>
      parseInt((p.split('/').pop() as string).split('_')[0], 10),
    ),
  )
}
