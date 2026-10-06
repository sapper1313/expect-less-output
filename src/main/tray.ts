import { Menu, Tray, app, dialog, nativeImage } from 'electron'
import { join } from 'path'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { Scheduler } from './scheduler/scheduler'
import type { SettingsService } from './services/settings'

export interface TrayDeps {
  scheduler: Scheduler
  settings: SettingsService
  showWindow: () => void
  setPaused: (paused: boolean) => void
  requestQuit: () => void
}

export function createTray(d: TrayDeps): { refresh: () => void } {
  const icon = nativeImage.createFromPath(join(resourcesDir(), 'trayTemplate.png'))
  icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip(COPY.appName)

  const refresh = () => {
    const st = d.scheduler.status()
    const next = st.nextPost
      ? `Next post: ${st.nextPost.brandName}, ${formatEastern(st.nextPost.whenUtc)}`
      : 'Next post: nothing scheduled'
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${COPY.appName}`, click: d.showWindow },
        { type: 'separator' },
        { label: next, enabled: false },
        st.paused
          ? { label: 'Resume scheduler', click: () => d.setPaused(false) }
          : { label: 'Pause scheduler', click: () => d.setPaused(true) },
        { type: 'separator' },
        { label: 'Quit', click: d.requestQuit },
      ]),
    )
  }
  tray.on('click', d.showWindow)
  refresh()
  setInterval(refresh, 30_000)
  return { refresh }
}

export async function confirmQuit(pending: number): Promise<boolean> {
  if (pending === 0) return true
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Keep running', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    title: 'Posts are still scheduled',
    message: COPY.confirm.quitPending(pending),
  })
  return response === 1
}

export function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources')
}
