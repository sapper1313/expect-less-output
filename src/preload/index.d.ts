import type { EloBridge } from '@shared/api'

declare global {
  interface Window {
    elo: EloBridge
  }
}
