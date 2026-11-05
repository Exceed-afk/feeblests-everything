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
  // Phase 1: Expenses. One channel per service function in
  // src/modules/expenses/service (contract in its API.md).
  expenses: {
    overview: (month, today, currency) => ipcRenderer.invoke('expenses:overview', month, today, currency),
    dueBills: (month, asOfDate) => ipcRenderer.invoke('expenses:dueBills', month, asOfDate),
    listCategories: (includeArchived) => ipcRenderer.invoke('expenses:listCategories', includeArchived),
    listTransactions: (filter) => ipcRenderer.invoke('expenses:listTransactions', filter),
    createTransaction: (input) => ipcRenderer.invoke('expenses:createTransaction', input),
    updateTransaction: (id, input) => ipcRenderer.invoke('expenses:updateTransaction', id, input),
    deleteTransaction: (id) => ipcRenderer.invoke('expenses:deleteTransaction', id),
    listBudgets: (month) => ipcRenderer.invoke('expenses:listBudgets', month),
    setBudget: (input) => ipcRenderer.invoke('expenses:setBudget', input),
    deleteBudget: (id) => ipcRenderer.invoke('expenses:deleteBudget', id),
    copyBudgets: (targetMonth) => ipcRenderer.invoke('expenses:copyBudgets', targetMonth),
    listRecurringBills: (includeArchived) => ipcRenderer.invoke('expenses:listRecurringBills', includeArchived),
    createRecurringBill: (input) => ipcRenderer.invoke('expenses:createRecurringBill', input),
    updateRecurringBill: (id, input) => ipcRenderer.invoke('expenses:updateRecurringBill', id, input),
    deleteRecurringBill: (id) => ipcRenderer.invoke('expenses:deleteRecurringBill', id),
    markBillPaid: (options) => ipcRenderer.invoke('expenses:markBillPaid', options),
    transferLeftover: (input) => ipcRenderer.invoke('expenses:transferLeftover', input)
  },
  notes: {
    list: (filter) => ipcRenderer.invoke('notes:list', filter),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    create: (input) => ipcRenderer.invoke('notes:create', input),
    update: (id, input) => ipcRenderer.invoke('notes:update', id, input),
    remove: (id) => ipcRenderer.invoke('notes:remove', id),
    setPinned: (id, pinned) => ipcRenderer.invoke('notes:setPinned', id, pinned),
    setArchived: (id, archived) => ipcRenderer.invoke('notes:setArchived', id, archived),
    backlinks: (id) => ipcRenderer.invoke('notes:backlinks', id),
    findByTitle: (title) => ipcRenderer.invoke('notes:findByTitle', title),
    promoteEntry: (entryId) => ipcRenderer.invoke('notes:promoteEntry', entryId)
  },
  content: {
    list: () => ipcRenderer.invoke('content:list'),
    get: (id) => ipcRenderer.invoke('content:get', id),
    create: (input) => ipcRenderer.invoke('content:create', input),
    update: (id, input) => ipcRenderer.invoke('content:update', id, input),
    move: (id, stage) => ipcRenderer.invoke('content:move', id, stage),
    reorder: (stage, ids) => ipcRenderer.invoke('content:reorder', stage, ids),
    setChecklistDone: (id, lineId, done) => ipcRenderer.invoke('content:setChecklistDone', id, lineId, done),
    addChecklistLine: (id, stage, text) => ipcRenderer.invoke('content:addChecklistLine', id, stage, text),
    removeChecklistLine: (id, lineId) => ipcRenderer.invoke('content:removeChecklistLine', id, lineId),
    setScript: (id, noteId) => ipcRenderer.invoke('content:setScript', id, noteId),
    createScript: (id, title) => ipcRenderer.invoke('content:createScript', id, title),
    addAsset: (id, asset) => ipcRenderer.invoke('content:addAsset', id, asset),
    removeAsset: (id, path) => ipcRenderer.invoke('content:removeAsset', id, path),
    remove: (id) => ipcRenderer.invoke('content:remove', id),
    missingAssets: (paths) => ipcRenderer.invoke('content:missingAssets', paths)
  },
  projects: {
    list: (includeArchived) => ipcRenderer.invoke('projects:list', includeArchived),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    update: (id, input) => ipcRenderer.invoke('projects:update', id, input),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  focus: {
    active: () => ipcRenderer.invoke('focus:active'),
    start: (params) => ipcRenderer.invoke('focus:start', params),
    pause: () => ipcRenderer.invoke('focus:pause'),
    resume: () => ipcRenderer.invoke('focus:resume'),
    stop: (completed, note) => ipcRenderer.invoke('focus:stop', completed, note),
    discard: () => ipcRenderer.invoke('focus:discard'),
    summary: (today) => ipcRenderer.invoke('focus:summary', today),
    report: (from, to) => ipcRenderer.invoke('focus:report', from, to),
    listSessions: (filter) => ipcRenderer.invoke('focus:listSessions', filter),
    logManual: (input) => ipcRenderer.invoke('focus:logManual', input),
    updateSession: (id, input) => ipcRenderer.invoke('focus:updateSession', id, input),
    deleteSession: (id) => ipcRenderer.invoke('focus:deleteSession', id),
    taskSeconds: (taskId) => ipcRenderer.invoke('focus:taskSeconds', taskId)
  },
  snippets: {
    list: () => ipcRenderer.invoke('snippets:list'),
    create: (input) => ipcRenderer.invoke('snippets:create', input),
    update: (id, input) => ipcRenderer.invoke('snippets:update', id, input),
    remove: (id) => ipcRenderer.invoke('snippets:remove', id)
  },
  tools: {
    copyText: (text) => ipcRenderer.invoke('tools:copyText', text)
  },
  scratchpads: {
    list: () => ipcRenderer.invoke('scratchpads:list'),
    ensure: () => ipcRenderer.invoke('scratchpads:ensure'),
    create: (input) => ipcRenderer.invoke('scratchpads:create', input),
    update: (id, patch) => ipcRenderer.invoke('scratchpads:update', id, patch),
    remove: (id) => ipcRenderer.invoke('scratchpads:remove', id),
    saveAsNote: (id) => ipcRenderer.invoke('scratchpads:saveAsNote', id)
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
  // ---- Phase 0: trash (with Undo), links, tags, templates ----
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (batchId) => ipcRenderer.invoke('trash:restore', batchId),
    deleteForever: (batchId) => ipcRenderer.invoke('trash:deleteForever', batchId)
  },
  links: {
    add: (a, b, relation) => ipcRenderer.invoke('links:add', a, b, relation),
    list: (type, id) => ipcRenderer.invoke('links:list', type, id),
    remove: (linkId) => ipcRenderer.invoke('links:remove', linkId)
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    counts: () => ipcRenderer.invoke('tags:counts'),
    setEntityTags: (type, entityId, names) => ipcRenderer.invoke('tags:setEntityTags', type, entityId, names),
    tagsOf: (type, entityId) => ipcRenderer.invoke('tags:of', type, entityId),
    setColour: (name, colour) => ipcRenderer.invoke('tags:setColour', name, colour),
    rename: (from, to) => ipcRenderer.invoke('tags:rename', from, to),
    merge: (from, into) => ipcRenderer.invoke('tags:merge', from, into),
    delete: (name) => ipcRenderer.invoke('tags:delete', name),
    items: (name) => ipcRenderer.invoke('tags:items', name)
  },
  templates: {
    list: (kind) => ipcRenderer.invoke('templates:list', kind),
    save: (kind, name, payload) => ipcRenderer.invoke('templates:save', kind, name, payload),
    remove: (id) => ipcRenderer.invoke('templates:remove', id),
    restoreBuiltins: () => ipcRenderer.invoke('templates:restoreBuiltins')
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
      dismiss: (id, dismissed, mode, today) => ipcRenderer.invoke('insights:dismiss', id, dismissed, mode, today)
    },
    assistant: {
      get: () => ipcRenderer.invoke('assistant:get'),
      set: (patch) => ipcRenderer.invoke('assistant:set', patch),
      keyStatus: () => ipcRenderer.invoke('assistant:keyStatus'),
      setKey: (key) => ipcRenderer.invoke('assistant:setKey', key),
      clearKey: () => ipcRenderer.invoke('assistant:clearKey'),
      functions: () => ipcRenderer.invoke('assistant:functions'),
      ask: (question, today, previousRequest) => ipcRenderer.invoke('assistant:ask', question, today, previousRequest)
    }
  },
  calculator: {
    saveHistory: (item) => ipcRenderer.invoke('calculator:saveHistory', item),
    listHistory: (limit) => ipcRenderer.invoke('calculator:listHistory', limit),
    clearHistory: () => ipcRenderer.invoke('calculator:clearHistory'),
    deleteHistoryItem: (id) => ipcRenderer.invoke('calculator:deleteHistoryItem', id),
    togglePinHistory: (id) => ipcRenderer.invoke('calculator:togglePinHistory', id),
    saveVariable: (name, value) => ipcRenderer.invoke('calculator:saveVariable', name, value),
    listVariables: () => ipcRenderer.invoke('calculator:listVariables'),
    deleteVariable: (name) => ipcRenderer.invoke('calculator:deleteVariable', name),
    saveProgram: (program) => ipcRenderer.invoke('calculator:saveProgram', program),
    listPrograms: () => ipcRenderer.invoke('calculator:listPrograms'),
    deleteProgram: (id) => ipcRenderer.invoke('calculator:deleteProgram', id),
    saveRateSet: (rateSet) => ipcRenderer.invoke('calculator:saveRateSet', rateSet),
    renameRateSet: (id, newName) => ipcRenderer.invoke('calculator:renameRateSet', id, newName),
    deleteRateSet: (id) => ipcRenderer.invoke('calculator:deleteRateSet', id),
    selectRateSet: (id) => ipcRenderer.invoke('calculator:selectRateSet', id),
    listRateSets: () => ipcRenderer.invoke('calculator:listRateSets'),
    saveRate: (rate) => ipcRenderer.invoke('calculator:saveRate', rate),
    updateRate: (id, rateToBase, note, name) => ipcRenderer.invoke('calculator:updateRate', id, rateToBase, note, name),
    listRates: (rateSetId) => ipcRenderer.invoke('calculator:listRates', rateSetId),
    saveRateOverride: (override) => ipcRenderer.invoke('calculator:saveRateOverride', override),
    listRateOverrides: (rateSetId) => ipcRenderer.invoke('calculator:listRateOverrides', rateSetId),
    deleteRateOverride: (id) => ipcRenderer.invoke('calculator:deleteRateOverride', id),
    importRateSet: (rateSetId, rows, mode) => ipcRenderer.invoke('calculator:importRateSet', rateSetId, rows, mode),
    getSetting: (key) => ipcRenderer.invoke('calculator:getSetting', key),
    setSetting: (key, value) => ipcRenderer.invoke('calculator:setSetting', key, value),
    getAllSettings: () => ipcRenderer.invoke('calculator:getAllSettings')
  }
}

contextBridge.exposeInMainWorld('api', api)
