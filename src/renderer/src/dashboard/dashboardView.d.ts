import type { DashboardSnapshot, WeekMap } from '@shared/dashboard'
import type { HomeSummary } from '@shared/home'

/** Runs the Home page inside a shadow root. Returns a function that stops its refresh timer. */
export function mountDashboard(
  root: ShadowRoot,
  loadSnapshot: (force?: boolean) => Promise<DashboardSnapshot | null>,
  loadTiles: () => Promise<HomeSummary>,
  onGo: (where: string) => void,
  loadWeek?: (offset: number) => Promise<WeekMap | null>,
): () => void
