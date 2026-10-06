import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { EloBridge } from '@shared/api'
import type { AppEvent } from '@shared/types'

const bridge: EloBridge = {
  invoke: (name, ...args) => ipcRenderer.invoke('elo:invoke', name, ...args),
  on: (callback) => {
    const handler = (_: unknown, event: AppEvent) => callback(event)
    ipcRenderer.on('elo:event', handler)
    return () => ipcRenderer.removeListener('elo:event', handler)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('elo', bridge)
