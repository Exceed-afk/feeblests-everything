// The only bridge between the UI and the main process.
// Exposes a small, named API as `window.api`.
import { contextBridge, ipcRenderer } from 'electron'
import type { EverythingApi } from '../shared/types'

const api: EverythingApi = {
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  logbook: {
    list: (filter) => ipcRenderer.invoke('logbook:list', filter),
    tags: () => ipcRenderer.invoke('logbook:tags'),
    create: (input) => ipcRenderer.invoke('logbook:create', input),
    update: (id, input) => ipcRenderer.invoke('logbook:update', id, input),
    remove: (id) => ipcRenderer.invoke('logbook:remove', id)
  },
  trades: {
    list: (filter) => ipcRenderer.invoke('trades:list', filter),
    meta: () => ipcRenderer.invoke('trades:meta'),
    create: (input) => ipcRenderer.invoke('trades:create', input),
    update: (id, input) => ipcRenderer.invoke('trades:update', id, input),
    remove: (id) => ipcRenderer.invoke('trades:remove', id)
  },
  savings: {
    listGoals: () => ipcRenderer.invoke('savings:listGoals'),
    createGoal: (input) => ipcRenderer.invoke('savings:createGoal', input),
    updateGoal: (id, input) => ipcRenderer.invoke('savings:updateGoal', id, input),
    removeGoal: (id) => ipcRenderer.invoke('savings:removeGoal', id),
    listTransactions: (goalId) => ipcRenderer.invoke('savings:listTransactions', goalId),
    addTransaction: (input) => ipcRenderer.invoke('savings:addTransaction', input),
    updateTransaction: (id, input) => ipcRenderer.invoke('savings:updateTransaction', id, input),
    removeTransaction: (id) => ipcRenderer.invoke('savings:removeTransaction', id)
  },
  dashboard: {
    summary: (today) => ipcRenderer.invoke('dashboard:summary', today)
  },
  search: {
    run: (query, limit) => ipcRenderer.invoke('search:run', query, limit)
  },
  app: {
    dataPath: () => ipcRenderer.invoke('app:dataPath'),
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder')
  },
  backup: {
    exportJson: (today) => ipcRenderer.invoke('backup:exportJson', today),
    exportTradesCsv: (today) => ipcRenderer.invoke('backup:exportTradesCsv', today),
    chooseImport: () => ipcRenderer.invoke('backup:chooseImport'),
    applyImport: () => ipcRenderer.invoke('backup:applyImport')
  }
}

contextBridge.exposeInMainWorld('api', api)
