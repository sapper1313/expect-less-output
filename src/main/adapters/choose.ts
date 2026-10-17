import type { Account, Platform } from '@shared/types'

/**
 * Which adapter handles a target: the real one for a connected account, the dry run one otherwise. A post made from a mock
 * mode placeholder video always gets the dry run adapter, even when the account is connected, so nothing fake is ever
 * published for real.
 */
export function pickAdapter<T>(
  platform: Platform,
  account: Account | null,
  settings: Record<string, unknown> | undefined,
  adapters: { dry: Record<Platform, T>; real: Record<Platform, T> },
  /** The global dry run switch: every platform behaves like the dry run adapter. */
  globalDryRun = false,
): T {
  if (globalDryRun) return adapters.dry[platform]
  if (settings?.mock === true) return adapters.dry[platform]
  if (account && account.mode !== 'dry_run') return adapters.real[platform]
  return adapters.dry[platform]
}
