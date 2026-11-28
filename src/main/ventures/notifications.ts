import type { VentureNotification } from '@shared/ventures'
import type { VentureStore } from './store'

export interface NotifierDeps {
  store: VentureStore
  /** ELO's existing Telegram alerts. Failures never lose the notification. */
  telegram: (text: string) => Promise<void> | void
  label: (storefront: string) => string
  /** Called after a new notification is stored, so badges can refresh. */
  onNew?: () => void
}

/** Stores a notification once per key and tells Telegram in plain words. Review text and message snippets stay in ELO. */
export class VentureNotifier {
  constructor(private d: NotifierDeps) {}

  notify(n: Omit<VentureNotification, 'id' | 'read'>, key: string): void {
    if (!this.d.store.addNotification(n, key)) return
    this.d.onNew?.()
    const who = this.d.label(n.storefront)
    const line =
      n.kind === 'order'
        ? `${who}: ${n.title}. ${n.detail}`
        : n.kind === 'low_review'
          ? `${who}: ${n.title}. Low rating. Open ELS Ventures to read it.`
          : `${who}: ${n.title}.`
    void Promise.resolve()
      .then(() => this.d.telegram(line))
      .catch(() => undefined)
  }
}
