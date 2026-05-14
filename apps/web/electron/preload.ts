import { contextBridge } from 'electron'

// Expose a minimal API for the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
})
