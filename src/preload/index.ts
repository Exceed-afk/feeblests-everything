// The only bridge between the UI and the main process.
// Exposes a small, named API as `window.api`.
import { contextBridge, ipcRenderer } from 'electron'
import type { EverythingApi } from '../shared/types'

// Subscribes to a message from the main process (the callback gets no data, so nothing from outside reaches the page).
function listen(channel: string, cb: () => void): () => void {
  const handler = (): void => cb()
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

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
  tasks: {
    list: (filter) => ipcRenderer.invoke('tasks:list', filter),
    completed: (date) => ipcRenderer.invoke('tasks:completed', date),
    trash: () => ipcRenderer.invoke('tasks:trash'),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (id, input) => ipcRenderer.invoke('tasks:update', id, input),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    restore: (id) => ipcRenderer.invoke('tasks:restore', id),
    deleteForever: (id) => ipcRenderer.invoke('tasks:deleteForever', id),
    clearTrash: () => ipcRenderer.invoke('tasks:clearTrash'),
    rescheduleMany: (ids, dueDate, dueTime) => ipcRenderer.invoke('tasks:rescheduleMany', ids, dueDate, dueTime),
    setStatus: (id, status) => ipcRenderer.invoke('tasks:setStatus', id, status),
    undoStatus: (id, status, completedAt, recurrenceNext) => ipcRenderer.invoke('tasks:undoStatus', id, status, completedAt, recurrenceNext),
    setStatusMany: (ids, status) => ipcRenderer.invoke('tasks:setStatusMany', ids, status),
    removeMany: (ids) => ipcRenderer.invoke('tasks:removeMany', ids),
    reorder: (ids) => ipcRenderer.invoke('tasks:reorder', ids),
    setSubtaskDone: (taskId, subtaskId, done) => ipcRenderer.invoke('tasks:setSubtaskDone', taskId, subtaskId, done),
    reorderSubtasks: (taskId, ids) => ipcRenderer.invoke('tasks:reorderSubtasks', taskId, ids),
    promoteSubtask: (taskId, subtaskId) => ipcRenderer.invoke('tasks:promoteSubtask', taskId, subtaskId),
    skipOccurrence: (id, today) => ipcRenderer.invoke('tasks:skipOccurrence', id, today)
  },
  habits: {
    list: () => ipcRenderer.invoke('habits:list'),
    create: (input) => ipcRenderer.invoke('habits:create', input),
    update: (id, input) => ipcRenderer.invoke('habits:update', id, input),
    remove: (id) => ipcRenderer.invoke('habits:remove', id),
    setCheckin: (habitId, date, done) => ipcRenderer.invoke('habits:setCheckin', habitId, date, done),
    setDayStatus: (habitId, date, status, value) => ipcRenderer.invoke('habits:setDayStatus', habitId, date, status, value),
    // Logs how much of a count/duration habit was done on a day.
    logValue: (habitId, date, value) => ipcRenderer.invoke('habits:logValue', habitId, date, value),
    // Saves the new manual order after drag-and-drop (first id = top).
    reorder: (ids) => ipcRenderer.invoke('habits:reorder', ids)
  },
  dashboard: {
    summary: (today) => ipcRenderer.invoke('dashboard:summary', today)
  },
  calendar: {
    month: (month, today) => ipcRenderer.invoke('calendar:month', month, today)
  },
  briefing: {
    build: (today) => ipcRenderer.invoke('briefing:build', today)
  },
  capture: {
    status: () => ipcRenderer.invoke('capture:status'),
    configure: (patch) => ipcRenderer.invoke('capture:configure', patch),
    open: () => ipcRenderer.invoke('capture:open'),
    hide: () => ipcRenderer.invoke('capture:hide'),
    openMain: () => ipcRenderer.invoke('capture:openMain'),
    resize: (height) => ipcRenderer.invoke('capture:resize', height),
    saved: () => ipcRenderer.invoke('capture:saved'),
    // Events from the main process. Each returns the function that stops listening.
    onShown: (cb) => listen('capture:shown', cb),
    onDataChanged: (cb) => listen('data:changed', cb)
  },
  review: {
    build: (kind, anchor, today) => ipcRenderer.invoke('review:build', kind, anchor, today)
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
  },
  intelligence: {
    get: () => ipcRenderer.invoke('intelligence:get'),
    set: (features) => ipcRenderer.invoke('intelligence:set', features),
    automations: {
      get: () => ipcRenderer.invoke('automations:get'),
      set: (patch) => ipcRenderer.invoke('automations:set', patch),
      activity: () => ipcRenderer.invoke('automations:activity'),
      deleteActivity: (id) => ipcRenderer.invoke('automations:activity:delete', id),
      clearActivity: () => ipcRenderer.invoke('automations:activity:clear'),
      staleTasks: () => ipcRenderer.invoke('automations:staleTasks')
    },
    insights: {
      build: (today) => ipcRenderer.invoke('insights:build', today),
      dismiss: (id, dismissed) => ipcRenderer.invoke('insights:dismiss', id, dismissed)
    },
    assistant: {
      get: () => ipcRenderer.invoke('assistant:get'),
      set: (patch) => ipcRenderer.invoke('assistant:set', patch),
      keyStatus: () => ipcRenderer.invoke('assistant:keyStatus'),
      setKey: (key) => ipcRenderer.invoke('assistant:setKey', key),
      clearKey: () => ipcRenderer.invoke('assistant:clearKey'),
      functions: () => ipcRenderer.invoke('assistant:functions'),
      ask: (question, today) => ipcRenderer.invoke('assistant:ask', question, today)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
