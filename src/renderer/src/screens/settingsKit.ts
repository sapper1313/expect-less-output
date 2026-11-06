import type { Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'

/** Loads the app settings and gives a save function that shows a plain error if it fails. Used by Settings, AI Settings and Financial. */
export function useSettings() {
  const { toast } = useApp()
  const { data: s } = useLoad(() => api.settings.get())
  const save = async (patch: Partial<Settings>) => {
    try {
      await api.settings.set(patch)
    } catch (e) {
      toast({ kind: 'error', headline: 'That did not work.', detail: String((e as Error).message) })
    }
  }
  return { s, save }
}
