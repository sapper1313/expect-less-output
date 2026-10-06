import { Notification } from 'electron'
import type { Notifier } from './scheduler/scheduler'
import type { AppEvent } from '@shared/types'

export function makeNotifier(send: (e: AppEvent) => void): Notifier {
  const show = (kind: 'success' | 'error', title: string, body: string) => {
    send({ type: 'toast', toast: { kind, headline: title, detail: body } })
    if (Notification.isSupported())
      new Notification({ title, body, silent: kind === 'success' }).show()
  }
  return {
    failure: (h, d) => show('error', h, d),
    missed: (h, d) => show('error', h, d),
    success: (h, d) => show('success', h, d),
  }
}
