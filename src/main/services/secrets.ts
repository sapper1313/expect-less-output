import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import type { SecretStatus } from '@shared/types'

/** Minimal slice of Electron's safeStorage so this file can be tested without Electron. */
export interface Crypto {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Encrypted key/value store. Values are encrypted with Electron safeStorage (Keychain backed).
 * The renderer never sees raw values: it only gets `has` and a masked preview.
 */
export class SecretStore {
  private cache: Record<string, string> | null = null

  constructor(
    private file: string,
    private crypto: Crypto,
  ) {}

  private load(): Record<string, string> {
    if (this.cache) return this.cache
    if (!existsSync(this.file)) return (this.cache = {})
    try {
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private save(): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.cache ?? {}), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  set(key: string, value: string): void {
    if (!this.crypto.isEncryptionAvailable())
      throw new Error('Keychain encryption is not available.')
    this.load()[key] = this.crypto.encryptString(value).toString('base64')
    this.save()
  }

  /** Main process only. Never send the result to the renderer. */
  get(key: string): string | null {
    const enc = this.load()[key]
    if (!enc) return null
    try {
      return this.crypto.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  has(key: string): boolean {
    return key in this.load()
  }

  delete(key: string): void {
    delete this.load()[key]
    this.save()
  }

  status(keys: string[]): SecretStatus[] {
    return keys.map((key) => {
      const v = this.has(key) ? this.get(key) : null
      return { key, has: this.has(key), masked: v ? mask(v) : '' }
    })
  }
}

export function mask(v: string): string {
  return v.length <= 4 ? '****' : '*'.repeat(8) + v.slice(-4)
}
