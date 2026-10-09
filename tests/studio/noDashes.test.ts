import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

describe('no em dashes anywhere in studio code and docs', () => {
  it('scans source, tests and docs', () => {
    const files = [
      ...walk(join(ROOT, 'src', 'main', 'studio')),
      ...walk(join(ROOT, 'src', 'shared', 'studio')),
      ...walk(join(ROOT, 'tests', 'studio')),
      ...readdirSync(join(ROOT, 'src', 'renderer', 'src', 'screens'))
        .filter((f) => f.startsWith('Studio'))
        .map((f) => join(ROOT, 'src', 'renderer', 'src', 'screens', f)),
      join(ROOT, 'src', 'main', 'db', 'migrations', '007_studio.sql'),
      ...readdirSync(join(ROOT, 'docs'))
        .filter((f) => f.startsWith('studio-'))
        .map((f) => join(ROOT, 'docs', f)),
    ]
    const bad = files.filter((f) => DASHES.some((d) => readFileSync(f, 'utf8').includes(d)))
    expect(bad).toEqual([])
  })
})
