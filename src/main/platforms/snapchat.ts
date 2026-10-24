import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from '../adapters/types'
import { durationProblem } from '@shared/platformLimits'

export interface SnapchatHost {
  notify(title: string, body: string): void
  copyText?(text: string): void
  log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void
}

/**
 * Snapchat does not let individual creators post to Spotlight through an app (its posting API is for approved business
 * partners). So at the posting time ELO copies the caption, tells the owner, and waits: the owner posts the video from the
 * Snapchat app and presses "Mark as posted".
 */
export class SnapchatAdapter implements PlatformAdapter {
  readonly platform = 'snapchat' as const
  constructor(private d: { host: SnapchatHost }) {}
  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    const problem = durationProblem('snapchat', ctx.videoDurationSeconds)
    if (ctx.videoDurationSeconds > 0 && problem) throw new AdapterError(problem, 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const text = (ctx.caption || ctx.title).trim()
    if (text) this.d.host.copyText?.(text)
    this.d.host.notify(
      `Post to Snapchat: ${ctx.brandName}`,
      `Snapchat has no way for apps to post. The caption is copied${text ? '' : ' (there is none)'}. Open Snapchat, choose Spotlight, pick this video (${ctx.videoAbsPath}), paste the caption, post, then press Mark as posted in ELO.`,
    )
    this.d.host.log('info', 'Snapchat is waiting for you to post it by hand.', ctx)
    return { status: 'needs_action' }
  }

  async checkStatus(): Promise<AdapterResult> {
    return { status: 'needs_action' }
  }
}
