import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { DateTime } from 'luxon'
import { ZONE } from '@shared/time'
import { sanitizeFolderName } from '@shared/text'

/** Everything that touches the Media Root folder lives here. Paths in the DB are relative. */
export class Library {
  constructor(private getRoot: () => string) {}

  get root(): string {
    return this.getRoot()
  }

  brandDir(brandName: string): string {
    return join(this.root, sanitizeFolderName(brandName))
  }

  ensureBrandFolders(brandName: string): void {
    mkdirSync(join(this.brandDir(brandName), 'Queue'), { recursive: true })
    mkdirSync(join(this.brandDir(brandName), 'Posted'), { recursive: true })
  }

  /** Absolute path for a stored relative path. Refuses anything outside the Media Root. */
  resolve(rel: string): string {
    const abs = isAbsolute(rel) ? rel : resolve(this.root, rel)
    const back = relative(this.root, abs)
    if (back.startsWith('..') || isAbsolute(back))
      throw new Error('Path is outside the Media Root.')
    return abs
  }

  toRelative(abs: string): string {
    return relative(this.root, abs)
  }

  /** Copies a video into <Brand>/Queue, keeping the name and de-duplicating with a suffix. */
  importToQueue(brandName: string, sourcePath: string, move = false): string {
    this.ensureBrandFolders(brandName)
    const dest = uniquePath(join(this.brandDir(brandName), 'Queue'), basename(sourcePath))
    if (move) moveFile(sourcePath, dest)
    else copyFileSync(sourcePath, dest)
    return this.toRelative(dest)
  }

  /** Puts a file moved by importToQueue back where it came from (used when saving the post failed). */
  moveBack(rel: string, originalPath: string): void {
    const abs = this.resolve(rel)
    if (existsSync(abs) && !existsSync(originalPath)) moveFile(abs, originalPath)
  }

  /** Moves a queued file to <Brand>/Posted/YYYY-MM. Returns the new relative path. */
  moveToPosted(rel: string, brandName: string, when: Date = new Date()): string {
    const src = this.resolve(rel)
    if (!existsSync(src)) return rel
    const month = DateTime.fromJSDate(when, { zone: ZONE }).toFormat('yyyy-LL')
    const dir = join(this.brandDir(brandName), 'Posted', month)
    mkdirSync(dir, { recursive: true })
    const dest = uniquePath(dir, basename(src))
    try {
      renameSync(src, dest)
    } catch {
      copyFileSync(src, dest)
      if (statSync(dest).size === statSync(src).size) unlinkSync(src)
    }
    return this.toRelative(dest)
  }

  deleteFile(rel: string): void {
    const abs = this.resolve(rel)
    if (existsSync(abs)) unlinkSync(abs)
  }

  /** Removes a copy this app just made (rollback). */
  removeIfInside(rel: string): void {
    try {
      this.deleteFile(rel)
    } catch {
      // nothing to roll back
    }
  }
}

/** Rename, falling back to copy then remove when the folders are on different drives. */
export function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    if (statSync(to).size === statSync(from).size) unlinkSync(from)
  }
}

export function uniquePath(dir: string, fileName: string): string {
  mkdirSync(dir, { recursive: true })
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(dir, fileName)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${n})${ext}`)
    n++
  }
  return candidate
}

export function dirOf(p: string): string {
  return dirname(p)
}
