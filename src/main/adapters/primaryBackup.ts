import { AdapterError, type AdapterContext, type AdapterResult, type PlatformAdapter } from './types'
import type { Account, Platform } from '@shared/types'

export interface BackupHost {
  log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void
  /** Called once when a post goes to the backup path, so the owner and the audit trail know. */
  onFallback?(ctx: AdapterContext, reason: string): void
}

/**
 * Upload-Post first, ELO's own login second. A target starts on Upload-Post. Only when Upload-Post definitively fails
 * does the target switch for good to ELO's own path, which then finishes it. The switch is written to the target's
 * state (`route: 'elo'`, `upFailure`, `fallbackAtMs`) so the entry reconciles to the truth: it is later followed up,
 * counted and read from ELO's own connection, and the failure reason stays on record.
 *
 * An unsure outcome (Upload-Post timed out or lost track, so the video may already be out) never goes to the backup,
 * because that could post the same video twice. Those stay on Upload-Post's normal retry. Two "could not reach
 * Upload-Post" answers in a row do count as a failure.
 */
export class PrimaryBackupAdapter implements PlatformAdapter {
  constructor(
    readonly platform: Platform,
    private primary: PlatformAdapter,
    private backup: PlatformAdapter,
    private host: BackupHost,
  ) {}

  private onBackup(ctx: AdapterContext): boolean {
    return ctx.getState().route === 'elo'
  }

  wantsHandoff(account: Account | null): boolean {
    // Nothing is handed off to the platform early on the primary path: Upload-Post sends at the post's time.
    return this.primary.wantsHandoff(account)
  }
  minHandoffLeadMs(account: Account | null): number {
    return this.primary.minHandoffLeadMs(account)
  }
  async connect(account: Account): Promise<void> {
    await this.backup.connect(account)
  }
  async refreshIfNeeded(account: Account): Promise<void> {
    // The backup's login is kept fresh all the time, so it is ready if it is ever needed.
    await this.backup.refreshIfNeeded(account).catch(() => undefined)
  }

  async validate(ctx: AdapterContext): Promise<void> {
    if (this.onBackup(ctx)) return this.backup.validate(ctx)
    try {
      await this.primary.validate(ctx)
    } catch (err) {
      if (!this.isDefinitive(ctx, err)) throw err
      // Upload-Post cannot take it (missing key, wrong profile, no login for this platform). Can ELO's own path?
      await this.backup.validate(ctx)
      this.switchToBackup(ctx, err)
    }
  }

  async handOff(ctx: AdapterContext): Promise<AdapterResult> {
    if (this.onBackup(ctx) && this.backup.handOff) return this.backup.handOff(ctx)
    return this.publish(ctx)
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    if (this.onBackup(ctx)) return this.backup.publish(ctx)
    try {
      return await this.primary.publish(ctx)
    } catch (err) {
      return this.fallBack(ctx, err, () => this.backup.publish(ctx))
    }
  }

  async checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult> {
    if (this.onBackup(ctx)) return this.backup.checkStatus(ctx, nowMs)
    try {
      return await this.primary.checkStatus(ctx, nowMs)
    } catch (err) {
      return this.fallBack(ctx, err, () => this.backup.publish(ctx))
    }
  }

  async fetchStats(ctx: AdapterContext): Promise<Record<string, number>> {
    if (!this.backup.fetchStats) return {}
    return this.backup.fetchStats(ctx)
  }

  /** True when Upload-Post definitively failed, so the backup may take over. */
  private isDefinitive(ctx: AdapterContext, err: unknown): boolean {
    if (!(err instanceof AdapterError)) return true
    if (err.unreachable) {
      const n = (typeof ctx.getState().upUnreachable === 'number' ? (ctx.getState().upUnreachable as number) : 0) + 1
      ctx.setState({ upUnreachable: n })
      return n >= 2
    }
    return !err.ambiguous
  }

  private switchToBackup(ctx: AdapterContext, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err)
    ctx.setState({
      route: 'elo',
      upFailure: reason.slice(0, 300),
      fallbackAtMs: ctx.nowMs(),
      upRequestId: null,
      upUnreachable: 0,
    })
    this.host.log('warn', `Upload-Post failed (${reason.replace(/\.$/, '')}). ELO's own ${this.platform} login takes over.`, ctx)
    this.host.onFallback?.(ctx, reason)
  }

  private async fallBack(ctx: AdapterContext, err: unknown, run: () => Promise<AdapterResult>): Promise<AdapterResult> {
    if (!this.isDefinitive(ctx, err)) throw err
    this.switchToBackup(ctx, err)
    try {
      if (ctx.account) await this.backup.refreshIfNeeded(ctx.account)
      await this.backup.validate(ctx)
      return await run()
    } catch (backupErr) {
      const up = err instanceof Error ? err.message : String(err)
      const own = backupErr instanceof Error ? backupErr.message : String(backupErr)
      const kind = backupErr instanceof AdapterError ? backupErr.kind : 'transient'
      const combined = new AdapterError(`Upload-Post failed (${up.replace(/\.$/, '')}). ELO's own login also failed: ${own}`, kind)
      if (backupErr instanceof AdapterError && backupErr.retryAfterMs) combined.retryAfterMs = backupErr.retryAfterMs
      throw combined
    }
  }
}
