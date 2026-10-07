import { Notification } from 'electron'
import type { Notifier } from './scheduler/scheduler'
import type { AlertService } from './alerts/service'
import type { AppEvent } from '@shared/types'

/** A macOS notification plus an in-app message. */
export function makeLocalShow(send: (e: AppEvent) => void) {
  return (headline: string, detail: string, kind: 'success' | 'error' | 'info' = 'error') => {
    send({ type: 'toast', toast: { kind, headline, detail } })
    if (Notification.isSupported())
      new Notification({ title: headline, body: detail, silent: kind === 'success' }).show()
  }
}

/**
 * Failures and misses go to the alert service (screen, then iMessage and email with batching and quiet hours).
 * Success stays on screen only.
 */
export function makeNotifier(send: (e: AppEvent) => void, alerts: AlertService): Notifier {
  const show = makeLocalShow(send)
  return {
    failure: (headline, detail, meta) =>
      void alerts.alert({ kind: meta?.kind ?? 'other', headline, detail, ...meta }),
    missed: (headline, detail, meta) =>
      void alerts.alert({ kind: 'missed', headline, detail, ...meta }),
    success: (headline, detail) => show(headline, detail, 'success'),
  }
}
