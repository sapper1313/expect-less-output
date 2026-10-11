import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface WatchdogSettings {
  enabled: boolean
  phone: string
  runStart: string
  runEnd: string
  thresholdMinutes: number
}

const hhmm = (s: string) =>
  /^\d{1,2}:\d{2}$/.test(s) ? s.replace(':', '').padStart(4, '0') : '0700'

/**
 * The app side of the watchdog: it writes a heartbeat every Director pass and keeps the watchdog's settings file current.
 * A separate launchd job (scripts/watchdog) reads both, so it can raise the alarm even when the app is not running.
 */
export class Watchdog {
  constructor(
    private dataDir: string,
    private scriptsDir: () => string,
  ) {}

  heartbeatFile() {
    return join(this.dataDir, 'studio-heartbeat.txt')
  }

  beat(nowMs: number): void {
    mkdirSync(this.dataDir, { recursive: true })
    writeFileSync(this.heartbeatFile(), String(Math.floor(nowMs / 1000)))
  }

  lastBeatMs(): number | null {
    try {
      return Number(readFileSync(this.heartbeatFile(), 'utf8').trim()) * 1000 || null
    } catch {
      return null
    }
  }

  /** Writes watchdog.env. Only validated values go in, because the shell script reads this file. */
  writeSettings(s: WatchdogSettings): void {
    const phone = /^\+?\d{7,15}$/.test(s.phone) ? s.phone : ''
    const lines = [
      `ELO_ENABLED=${s.enabled && phone ? 1 : 0}`,
      `ELO_PHONE='${phone}'`,
      `ELO_RUN_START=${hhmm(s.runStart)}`,
      `ELO_RUN_END=${hhmm(s.runEnd)}`,
      `ELO_THRESHOLD_MIN=${Math.max(5, Math.floor(s.thresholdMinutes) || 30)}`,
    ]
    mkdirSync(this.dataDir, { recursive: true })
    writeFileSync(join(this.dataDir, 'watchdog.env'), lines.join('\n') + '\n', { mode: 0o600 })
  }

  info(): {
    installed: boolean
    installCommand: string
    uninstallCommand: string
    heartbeatAgeMinutes: number | null
    plist: string
  } {
    const plist = join(
      homedir(),
      'Library',
      'LaunchAgents',
      'com.expectlessmedia.elo.watchdog.plist',
    )
    const dir = this.scriptsDir()
    const last = this.lastBeatMs()
    return {
      installed: existsSync(plist),
      installCommand: `ELO_DATA_DIR="${this.dataDir}" bash "${join(dir, 'install.sh')}"`,
      uninstallCommand: `ELO_DATA_DIR="${this.dataDir}" bash "${join(dir, 'uninstall.sh')}"`,
      heartbeatAgeMinutes: last === null ? null : Math.round((Date.now() - last) / 60_000),
      plist,
    }
  }

  fileAgeSeconds(): number | null {
    try {
      return (Date.now() - statSync(this.heartbeatFile()).mtimeMs) / 1000
    } catch {
      return null
    }
  }
}
