import type { DashboardSnapshot } from '@shared/dashboard'

/** Runs the dashboard page inside a shadow root. Returns a function that stops its refresh timer. */
export function mountDashboard(
  root: ShadowRoot,
  loadSnapshot: (force?: boolean) => Promise<DashboardSnapshot | null>,
): () => void
