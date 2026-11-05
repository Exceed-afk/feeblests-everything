// Main process: creates the window and answers requests from the UI.
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { basename, join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { initDatabase, getSettings, setSetting, dataDir, getDb, safetyCopy, templateResetAt } from './db'
import { runDailyChecksIfNeeded } from './dailyCheck'
import { collectBackup, currentCounts, restoreBackup } from './backup'
import { countsOf, parseBackup, tradesToCsv, type BackupFile } from '../shared/backup'
import { normalizeSettings, resolveTokens } from '../shared/appearance'
import { mergeFeatures } from '../shared/intelligence'
import { MIGRATIONS } from './migrations'
import { startReminders } from './reminders'
import { listEntries, listTags as listLogbookTags, createEntry, updateEntry, deleteEntry, getEntriesByIds } from './logbook'
import { listTrades, tradeMeta, createTrade, updateTrade, deleteTrade } from './trades'
import * as savings from './savings'
import * as habits from './habits'
import * as tasks from './tasks'
import { runSearch } from './search'
import { listTrash, restoreBatch, deleteBatchForever, purgeTrash } from './trash'
import { DEFAULT_TRASH_PURGE_DAYS } from '../shared/trash'
import { addLink, listLinksFor, removeLink } from './links'
import * as notes from './notes'
import * as toolsHub from './tools'
import * as content from './content'
import * as focus from './focus'
import * as calc from './calculator'
import { listTags, tagCounts, setEntityTags, tagsOf, setTagColour, isTagEntityType, renameTag, mergeTags, deleteTag, listTaggedItems } from './tags'
import { listTemplates, removeTemplate, restoreBuiltinTemplates, saveTemplate } from './templates'
import { seedBuiltinTemplates } from './builtinTemplates'

import { isTemplateKind } from '../shared/templates'
import { logbookToNoteInput } from './notes'
import { isContentStage } from '../shared/content'
import {
  computeLeftToSpend, listDueBillsThisMonth, listCategories, listExpenseTransactions,
  createExpenseTransaction, updateExpenseTransaction, deleteExpenseTransaction,
  listBudgets, setBudget, deleteBudget, copyBudgetsFromPreviousMonth,
  listRecurringBills, createRecurringBill, updateRecurringBill, deleteRecurringBill,
  markRecurringBillPaid, transferLeftoverToSavings
} from '../modules/expenses/service'
import type {
  ListExpenseTransactionsFilter, ExpenseTransactionInput, ExpenseBudgetInput,
  RecurringBillInput, MarkBillPaidOptions, SavingsTransferInput
} from '../modules/expenses/service'
import { DEFAULT_RELATION, isLinkType, type LinkEndpoint, type LinkType } from '../shared/links'
import type { ContentStage } from '../shared/content'
import { isWebUrl } from '../shared/url'
import { getDashboard } from './dashboard'
import { getReview } from './review'
import { getCalendar } from './calendar'
import { getBriefing } from './briefing'
import { createCapture, type Capture } from './capture'
import { automationSettings, setAutomationSettings, automationActivity, deleteAutomationActivity, clearAutomationActivity } from './automations'
import { getInsights, setInsightDismissed } from './insights'
import {
  assistantSettings, setAssistantSettings, keyStatus, storeKey, clearKey,
  assistantFunctionList, askAssistant
} from './assistant'
import type { AssistantSettings } from '../shared/assistant'
import type { AutomationSettings } from '../shared/automations'
import type { CaptureSettings, HabitInput, IntelligenceFeatureToggles, ReviewKind, TaskInput, TaskStatus, TaskFilter, ExportResult, ImportPreview, ImportResult, SavingsGoalInput, SavingsTxInput, LogEntryInput, LogFilter, TradeFilter, TradeInput } from '../shared/types'
import { DEFAULT_INTELLIGENCE, DEFAULT_SETTINGS, type IntelligenceSettings } from '../shared/types'
import { localDate } from './util'

const APP_NAME = "Feeblest's Everything"
const MAIN_ONLY_SETTINGS = new Set([
  'intelligence', 'automations', 'insightDismissals', 'assistant', 'assistantKeyBlob', 'dailyCheckState'
])

let mainWindow: BrowserWindow | null = null
let quitting = false // set once the app is really quitting, so the hidden capture window may close then
let capture: Capture // Quick capture: the global shortcut, tray icon and small window (src/main/capture.ts)

// The window colour of the saved look, so a light-theme user never sees a dark window flash before the page loads.
function windowBackground(): string {
  const saved = normalizeSettings(getSettings())
  nativeTheme.themeSource = saved.theme // native parts (dialogs, menus) follow the app's mode
  return resolveTokens(saved, nativeTheme.shouldUseDarkColors).bg
}

const keepsRunning = (): boolean => { const s = capture.status(); return s.enabled && s.keepRunning }

// Tells the main window to reload what it shows when data changes somewhere
// else (a trash restore, for example). It is the same push the Quick capture
// window triggers after saving (lib/dataChanged.ts listens for it).
function broadcastChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('data:changed')
}

// The startup purge, kept in one function so the try/catch above stays tiny.
function purgeOldTrashAtStartup(): void {
  const { trash } = getSettings()
  purgeTrash(getDb(), trash?.purgeDays ?? DEFAULT_TRASH_PURGE_DAYS, localDate())
}

// Brings the main window to the front, making a new one if it was closed (the app can run on in the tray).
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  const background = windowBackground()
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: background,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // keeps the web page separated from Node.js
      nodeIntegration: false
    }
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
    // Closing the window quits the app, unless "keep running" is on (then the shortcut and tray icon stay).
    // A Mac always keeps running when its window is closed, as Macs do.
    if (process.platform !== 'darwin' && !keepsRunning()) app.quit()
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (isWebUrl(url)) shell.openExternal(url); return { action: 'deny' } })
  // The app never navigates away from itself. A web link opens in the browser; anything else is blocked.
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return // reload
    e.preventDefault()
    if (isWebUrl(url)) shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// A checked backup file waiting for the user to confirm the import.
let pendingImport: BackupFile | null = null

const parentOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined

async function saveFile(e: Electron.IpcMainInvokeEvent, defaultName: string, filterName: string, ext: string, content: string): Promise<string | null> {
  const win = parentOf(e)
  const opts = { defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: filterName, extensions: [ext] }] }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, content, 'utf8')
  return r.filePath
}

// Only one copy may run: two would fight over the database and the global shortcut. Starting a second copy
// (for example from the Start menu while the first sits in the tray) brings the first one to the front instead.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => showMainWindow())
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => capture?.dispose())

app.whenReady().then(async () => {
  if (!gotLock) return // a second copy: the first one was asked to come forward and this one is closing
  if (!await initDatabase()) return
  // Trash auto-purge (Phase 0): batches trashed more than `trash.purgeDays`
  // days ago go away for good, every launch, after the pre-migration backup
  // that initDatabase just verified. Runs before anything else touches data.
  try { purgeOldTrashAtStartup() } catch (error) {
    console.error('Trash purge failed (continuing without it):', error)
  }
  focus.setupFocusPowerMonitor(getDb())
  // The once-per-local-day checks (first thing after startup, then again from
  // the reminder loop if the app stays open past midnight).
  runDailyChecksIfNeeded(getDb())
  // Habit reminders: a check every minute while the app runs. It needs the
  // database once it exists, and clicking a notification focuses the app.
  startReminders(getDb, showMainWindow)
  capture = createCapture({
    appName: APP_NAME,
    preload: join(__dirname, '../preload/index.js'),
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    htmlFile: join(__dirname, '../renderer/index.html'),
    background: windowBackground,
    readSettings: () => getSettings() as unknown as Record<string, unknown>,
    saveSetting: setSetting,
    showMain: showMainWindow,
    mainVisible: () => mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized(),
    quit: () => app.quit(),
    isQuitting: () => quitting
  })

  // Each ipcMain.handle is one function the UI may call (see preload/index.ts).
  ipcMain.handle('settings:getAll', () => {
    const { assistantKeyBlob, ...safeSettings } =
      getSettings() as ReturnType<typeof getSettings> & { assistantKeyBlob?: unknown }
    void assistantKeyBlob
    return safeSettings
  })
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    if (MAIN_ONLY_SETTINGS.has(key) || !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
      throw new Error('That setting cannot be changed from here.')
    }
    setSetting(key, value)
    if (key === 'theme' && (value === 'dark' || value === 'light' || value === 'system')) nativeTheme.themeSource = value
  })
  ipcMain.handle('logbook:list', (_e, f?: LogFilter) => listEntries(getDb(), f))
  ipcMain.handle('logbook:tags', () => listLogbookTags(getDb()))
  ipcMain.handle('logbook:create', (_e, input: LogEntryInput) => createEntry(getDb(), input))
  ipcMain.handle('logbook:update', (_e, id: number, input: LogEntryInput) => updateEntry(getDb(), id, input))
  ipcMain.handle('logbook:remove', (_e, id: number) => deleteEntry(getDb(), id)) // returns the delete batch id (undo)
  ipcMain.handle('trades:list', (_e, f?: TradeFilter) => listTrades(getDb(), f))
  ipcMain.handle('trades:meta', () => tradeMeta(getDb()))
  ipcMain.handle('trades:create', (_e, input: TradeInput) => createTrade(getDb(), input))
  ipcMain.handle('trades:update', (_e, id: number, input: TradeInput) => updateTrade(getDb(), id, input))
  ipcMain.handle('trades:remove', (_e, id: number) => deleteTrade(getDb(), id))
  ipcMain.handle('savings:listGoals', () => savings.listGoals(getDb()))
  ipcMain.handle('savings:createGoal', (_e, i: SavingsGoalInput) => savings.createGoal(getDb(), i))
  ipcMain.handle('savings:updateGoal', (_e, id: number, i: SavingsGoalInput) => savings.updateGoal(getDb(), id, i))
  ipcMain.handle('savings:removeGoal', (_e, id: number) => savings.deleteGoal(getDb(), id))
  ipcMain.handle('savings:listTransactions', (_e, goalId: number) => savings.listTransactions(getDb(), goalId))
  ipcMain.handle('savings:addTransaction', (_e, i: SavingsTxInput) => savings.addTransaction(getDb(), i))
  ipcMain.handle('savings:updateTransaction', (_e, id: number, i: SavingsTxInput) => savings.updateTransaction(getDb(), id, i))
  ipcMain.handle('savings:removeTransaction', (_e, id: number) => savings.deleteTransaction(getDb(), id))
  ipcMain.handle('tasks:list', (_e, f?: TaskFilter) => tasks.listFilteredTasks(getDb(), f ?? {}))
  ipcMain.handle('tasks:completed', (_e, date: string) => tasks.listCompletedTasks(getDb(), date))
  ipcMain.handle('tasks:trash', () => tasks.listDeletedTasks(getDb()))
  ipcMain.handle('tasks:create', (_e, i: TaskInput) => tasks.createTask(getDb(), i))
  ipcMain.handle('tasks:update', (_e, id: number, i: TaskInput) => tasks.updateTask(getDb(), id, i))
  ipcMain.handle('tasks:remove', (_e, id: number) => tasks.deleteTask(getDb(), id))
  ipcMain.handle('tasks:restore', (_e, id: number) => tasks.restoreTask(getDb(), id))
  ipcMain.handle('tasks:deleteForever', (_e, id: number) => tasks.deleteTaskForever(getDb(), id))
  ipcMain.handle('tasks:clearTrash', () => tasks.clearTrash(getDb()))
  ipcMain.handle('tasks:rescheduleMany', (_e, ids: number[], dueDate: string, dueTime?: string | null) => tasks.rescheduleTasks(getDb(), ids, dueDate, dueTime ?? null))
  ipcMain.handle('tasks:setStatus', (_e, id: number, status: TaskStatus) => tasks.setTaskStatus(getDb(), id, status))
  ipcMain.handle('tasks:undoStatus', (_e, id: number, status: TaskStatus, completedAt: string | null, recurrenceNext: string | null) => tasks.undoTaskStatus(getDb(), id, status, completedAt, recurrenceNext))
  ipcMain.handle('tasks:setStatusMany', (_e, ids: number[], status: TaskStatus) => tasks.setTasksStatus(getDb(), ids, status))
  ipcMain.handle('tasks:removeMany', (_e, ids: number[]) => tasks.deleteTasks(getDb(), ids))
  ipcMain.handle('tasks:reorder', (_e, ids: number[]) => tasks.reorderTasks(getDb(), ids))
  ipcMain.handle('tasks:setSubtaskDone', (_e, taskId: number, subtaskId: number, done: boolean) => tasks.setSubtaskDone(getDb(), taskId, subtaskId, done))
  ipcMain.handle('tasks:reorderSubtasks', (_e, taskId: number, ids: number[]) => tasks.reorderSubtasks(getDb(), taskId, ids))
  ipcMain.handle('tasks:promoteSubtask', (_e, taskId: number, subtaskId: number) => tasks.promoteSubtask(getDb(), taskId, subtaskId))
  ipcMain.handle('tasks:skipOccurrence', (_e, id: number, today: string) => tasks.skipTaskOccurrence(getDb(), id, today))
  ipcMain.handle('habits:list', () => habits.listHabits(getDb()))
  ipcMain.handle('habits:create', (_e, i: HabitInput) => habits.createHabit(getDb(), i))
  ipcMain.handle('habits:update', (_e, id: number, i: HabitInput) => habits.updateHabit(getDb(), id, i))
  ipcMain.handle('habits:remove', (_e, id: number) => habits.deleteHabit(getDb(), id))
  ipcMain.handle('habits:setCheckin', (_e, habitId: number, date: string, done: boolean) => habits.setCheckin(getDb(), habitId, date, Boolean(done)))
  ipcMain.handle('habits:setDayStatus', (_e, habitId: number, date: string, status: 'done' | 'skipped' | null, value?: number | null) => habits.setDayStatus(getDb(), habitId, date, status ?? null, value ?? null))
  // Logs how much of a count/duration habit was done on a day.
  ipcMain.handle('habits:logValue', (_e, habitId: number, date: string, value: number) => habits.logHabitValue(getDb(), habitId, date, Number(value)))
  ipcMain.handle('habits:reorder', (_e, ids: number[]) => habits.reorderHabits(getDb(), ids))
  ipcMain.handle('dashboard:summary', (_e, today: string) => getDashboard(getDb(), today))
  ipcMain.handle('review:build', (_e, kind: ReviewKind, anchor: string, today: string) => getReview(getDb(), kind, anchor, today))
  ipcMain.handle('calendar:month', (_e, month: string, today: string) => getCalendar(getDb(), month, today))
  ipcMain.handle('briefing:build', (_e, today: string) => getBriefing(getDb(), today))
  ipcMain.handle('automations:get', () => automationSettings())
  ipcMain.handle('automations:set', (_e, patch: Partial<AutomationSettings>) => setAutomationSettings(patch))
  ipcMain.handle('automations:activity', () => automationActivity(getDb()))
  ipcMain.handle('automations:activity:delete', (_e, id: number) => deleteAutomationActivity(getDb(), id))
  ipcMain.handle('automations:activity:clear', () => clearAutomationActivity(getDb()))
  ipcMain.handle('automations:staleTasks', () => tasks.overdueTasks(getDb(), localDate()))
  ipcMain.handle('insights:build', (_e, today: string) => getInsights(getDb(), today))
  ipcMain.handle('insights:dismiss', (_e, id: string, dismissed: boolean, mode?: 'snooze' | 'hide' | 'restore', today?: string) =>
    setInsightDismissed(getDb(), id, dismissed, mode, today))
  ipcMain.handle('capture:status', () => capture.status())
  ipcMain.handle('capture:configure', (_e, patch: Partial<CaptureSettings>) => capture.configure(patch && typeof patch === 'object' ? patch : {}))
  ipcMain.handle('capture:open', () => capture.show())
  ipcMain.handle('capture:hide', () => capture.hide(true))
  ipcMain.handle('capture:openMain', () => { showMainWindow(); capture.hide() })
  ipcMain.handle('capture:resize', (_e, height: number) => capture.resize(Number(height)))
  // Something was saved from the small window: the main window reloads what it shows (see lib/dataChanged.ts).
  ipcMain.handle('capture:saved', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('data:changed') })
  ipcMain.handle('search:run', (_e, query: string, limit?: number) => runSearch(getDb(), String(query ?? ''), limit))

  // ---- Phase 0: trash, links, tags, templates ----
  ipcMain.handle('trash:list', () => listTrash(getDb()))
  ipcMain.handle('trash:restore', (_e, batchId: string) => {
    const restored = restoreBatch(getDb(), String(batchId ?? ''))
    broadcastChanged()
    return restored
  })
  ipcMain.handle('trash:deleteForever', (_e, batchId: string) => deleteBatchForever(getDb(), String(batchId ?? '')))
  ipcMain.handle('links:add', (_e, a: LinkEndpoint, b: LinkEndpoint, relation?: string) =>
    addLink(getDb(), a, b, relation ?? DEFAULT_RELATION))
  ipcMain.handle('links:list', (_e, type: LinkType, id: number) => {
    if (!isLinkType(type)) throw new Error('That kind of item cannot be linked')
    return listLinksFor(getDb(), type, Number(id))
  })
  ipcMain.handle('links:remove', (_e, linkId: number) => removeLink(getDb(), Number(linkId)))
  ipcMain.handle('tags:list', () => listTags(getDb()))
  ipcMain.handle('tags:counts', () => tagCounts(getDb()))
  ipcMain.handle('tags:setEntityTags', (_e, type: unknown, entityId: number, names: string[]) => {
    if (!isTagEntityType(type)) throw new Error('That kind of item cannot be tagged')
    setEntityTags(getDb(), type, Number(entityId), Array.isArray(names) ? names : [])
  })
  ipcMain.handle('tags:of', (_e, type: unknown, entityId: number) => {
    if (!isTagEntityType(type)) throw new Error('That kind of item cannot be tagged')
    return tagsOf(getDb(), type, Number(entityId))
  })
  ipcMain.handle('tags:setColour', (_e, name: string, colour: string | null) => setTagColour(getDb(), String(name ?? ''), colour))
  ipcMain.handle('templates:list', (_e, kind?: string) => listTemplates(getDb(), isTemplateKind(kind) ? kind : undefined))
  ipcMain.handle('templates:save', (_e, kind: string, name: string, payload: unknown) => {
    if (!isTemplateKind(kind)) throw new Error('Unknown template kind')
    return saveTemplate(getDb(), kind, String(name ?? ''), payload)
  })
  ipcMain.handle('templates:remove', (_e, id: number) => removeTemplate(getDb(), Number(id)))
  // Phase 6: Settings > Templates. Trash the built-ins and re-seed them; the
  // user's own templates are left exactly as they are.
  ipcMain.handle('templates:restoreBuiltins', () => {
    const db = getDb()
    restoreBuiltinTemplates(db)
    seedBuiltinTemplates(db, templateResetAt(db))
    return listTemplates(db)
  })

  // ---- Phase 2: Notes ----
  ipcMain.handle('notes:list', (_e, filter?: import('../shared/notes').NoteFilter) => notes.listNotes(getDb(), filter ?? {}))
  ipcMain.handle('notes:get', (_e, id: number) => notes.getNote(getDb(), Number(id)))
  ipcMain.handle('notes:create', (_e, input: import('../shared/notes').NoteInput) => notes.createNote(getDb(), input))
  ipcMain.handle('notes:update', (_e, id: number, input: import('../shared/notes').NoteInput) => notes.updateNote(getDb(), Number(id), input))
  ipcMain.handle('notes:remove', (_e, id: number) => notes.deleteNote(getDb(), Number(id)))
  ipcMain.handle('notes:setPinned', (_e, id: number, pinned: boolean) => notes.setNotePinned(getDb(), Number(id), pinned === true))
  ipcMain.handle('notes:setArchived', (_e, id: number, archived: boolean) => notes.setNoteArchived(getDb(), Number(id), archived === true))
  ipcMain.handle('notes:backlinks', (_e, id: number) => notes.listBacklinks(getDb(), Number(id)))
  ipcMain.handle('notes:findByTitle', (_e, title: string) => notes.findNoteByTitle(getDb(), String(title ?? '')))
  // "Convert to note": the entry stays where it is; a new note copies it.
  ipcMain.handle('notes:promoteEntry', (_e, entryId: number) => {
    const db = getDb()
    const [entry] = getEntriesByIds(db, [Number(entryId)])
    if (!entry) throw new Error('Entry not found')
    return notes.createNote(db, logbookToNoteInput(entry.title, entry.body, entry.tags, entry.date))
  })

  // ---- Phase 3: Content planner ----
  ipcMain.handle('content:list', () => content.listContentItems(getDb()))
  ipcMain.handle('content:get', (_e, id: number) => content.getContentItem(getDb(), Number(id)))
  ipcMain.handle('content:create', (_e, input: import('../shared/content').ContentInput) => content.createContentItem(getDb(), input))
  ipcMain.handle('content:update', (_e, id: number, input: import('../shared/content').ContentInput) => content.updateContentItem(getDb(), Number(id), input))
  ipcMain.handle('content:move', (_e, id: number, stage: ContentStage) => {
    if (!isContentStage(stage)) throw new Error('Unknown stage')
    return content.moveContentItem(getDb(), Number(id), stage)
  })
  ipcMain.handle('content:reorder', (_e, stage: ContentStage, ids: number[]) => {
    if (!isContentStage(stage)) throw new Error('Unknown stage')
    content.reorderContentItems(getDb(), stage, Array.isArray(ids) ? ids.map(Number) : [])
  })
  ipcMain.handle('content:setChecklistDone', (_e, id: number, lineId: string, done: boolean) => content.setChecklistDone(getDb(), Number(id), String(lineId), done === true))
  ipcMain.handle('content:addChecklistLine', (_e, id: number, stage: ContentStage, text: string) => {
    if (!isContentStage(stage)) throw new Error('Unknown stage')
    return content.addChecklistLine(getDb(), Number(id), stage, String(text ?? ''))
  })
  ipcMain.handle('content:removeChecklistLine', (_e, id: number, lineId: string) => content.removeChecklistLine(getDb(), Number(id), String(lineId)))
  ipcMain.handle('content:setScript', (_e, id: number, noteId: number | null) => {
    const db = getDb()
    const item = content.setScriptNote(db, Number(id), noteId === null ? null : Number(noteId))
    // Keep the generic link in step, so backlinks show on the note too.
    if (item.scriptNoteId !== null) addLink(db, { type: 'content', id: item.id }, { type: 'note', id: item.scriptNoteId })
    return item
  })
  // One click from a card: create the script note, link it both ways, move on.
  ipcMain.handle('content:createScript', (_e, id: number, title: string) => {
    const db = getDb()
    const item = content.getContentItem(db, Number(id))
    const note = notes.createNote(db, {
      title: String(title ?? '').trim() || `Script: ${item.title}`,
      body: '## Hook\n\n\n## Outline\n\n- \n\n## Call to action\n\n',
      tags: item.tags, pinned: false, archived: false
    })
    const updated = content.setScriptNote(db, item.id, note.id)
    addLink(db, { type: 'content', id: item.id }, { type: 'note', id: note.id })
    return updated
  })
  ipcMain.handle('content:addAsset', (_e, id: number, asset: import('../shared/content').ContentAsset) => content.addAsset(getDb(), Number(id), asset))
  ipcMain.handle('content:removeAsset', (_e, id: number, path: string) => content.removeAsset(getDb(), Number(id), String(path)))
  ipcMain.handle('content:remove', (_e, id: number) => content.deleteContentItem(getDb(), Number(id)))
  // Only a path check: nothing is read or opened. The renderer shows a warning.
  ipcMain.handle('content:missingAssets', (_e, paths: string[]) =>
    (Array.isArray(paths) ? paths.map(String) : []).filter((p) => { try { return !existsSync(p) } catch { return true } }))

  // ---- Phase 2: the Tags page ----
  ipcMain.handle('tags:rename', (_e, from: string, to: string) => renameTag(getDb(), String(from ?? ''), String(to ?? '')))
  ipcMain.handle('tags:merge', (_e, from: string, into: string) => mergeTags(getDb(), String(from ?? ''), String(into ?? '')))
  ipcMain.handle('tags:delete', (_e, name: string) => deleteTag(getDb(), String(name ?? '')))
  ipcMain.handle('tags:items', (_e, name: string) => listTaggedItems(getDb(), String(name ?? '')))
  // Phase 1: Expenses (logic layer in src/modules/expenses/service). Amounts are
  // integer cents; every read excludes trashed rows inside the service.
  ipcMain.handle('expenses:overview', (_e, month: string, today: string, currency?: string) =>
    computeLeftToSpend(getDb(), { month, today, currency }))
  ipcMain.handle('expenses:dueBills', (_e, month: string, asOfDate: string) =>
    listDueBillsThisMonth(getDb(), month, asOfDate))
  ipcMain.handle('expenses:listCategories', (_e, includeArchived?: boolean) => listCategories(getDb(), includeArchived ? true : false))
  ipcMain.handle('expenses:listTransactions', (_e, filter?: ListExpenseTransactionsFilter) => listExpenseTransactions(getDb(), filter ?? {}))
  ipcMain.handle('expenses:createTransaction', (_e, input: ExpenseTransactionInput) => createExpenseTransaction(getDb(), input))
  ipcMain.handle('expenses:updateTransaction', (_e, id: number, input: ExpenseTransactionInput) => updateExpenseTransaction(getDb(), Number(id), input))
  ipcMain.handle('expenses:deleteTransaction', (_e, id: number) => deleteExpenseTransaction(getDb(), Number(id)))
  ipcMain.handle('expenses:listBudgets', (_e, month: string) => listBudgets(getDb(), month))
  ipcMain.handle('expenses:setBudget', (_e, input: ExpenseBudgetInput) => setBudget(getDb(), input))
  ipcMain.handle('expenses:deleteBudget', (_e, id: number) => deleteBudget(getDb(), Number(id)))
  ipcMain.handle('expenses:copyBudgets', (_e, targetMonth: string) => copyBudgetsFromPreviousMonth(getDb(), targetMonth))
  ipcMain.handle('expenses:listRecurringBills', (_e, includeArchived?: boolean) => listRecurringBills(getDb(), includeArchived ? true : false))
  ipcMain.handle('expenses:createRecurringBill', (_e, input: RecurringBillInput) => createRecurringBill(getDb(), input))
  ipcMain.handle('expenses:updateRecurringBill', (_e, id: number, input: RecurringBillInput) => updateRecurringBill(getDb(), Number(id), input))
  ipcMain.handle('expenses:deleteRecurringBill', (_e, id: number) => deleteRecurringBill(getDb(), Number(id)))
  ipcMain.handle('expenses:markBillPaid', (_e, options: MarkBillPaidOptions) => markRecurringBillPaid(getDb(), options))
  ipcMain.handle('expenses:transferLeftover', (_e, input: SavingsTransferInput) => transferLeftoverToSavings(getDb(), input))

  // ---- Phase 4: Focus timer and time tracking ----
  ipcMain.handle('focus:active', () => focus.getActiveSession(getDb()))
  ipcMain.handle('focus:start', (_e, p) => focus.startTimer(getDb(), p))
  ipcMain.handle('focus:pause', () => focus.pauseTimer(getDb()))
  ipcMain.handle('focus:resume', () => focus.resumeTimer(getDb()))
  ipcMain.handle('focus:stop', (_e, completed?: boolean, note?: string) => focus.stopTimer(getDb(), completed !== false, note))
  ipcMain.handle('focus:discard', () => focus.discardActiveTimer(getDb()))
  ipcMain.handle('focus:summary', (_e, today: string) => focus.getFocusSummary(getDb(), today))
  ipcMain.handle('focus:report', (_e, from: string, to: string) => focus.getFocusReport(getDb(), from, to))
  ipcMain.handle('focus:listSessions', (_e, filter) => focus.listSessions(getDb(), filter))
  ipcMain.handle('focus:logManual', (_e, input) => focus.logManualSession(getDb(), input))
  ipcMain.handle('focus:updateSession', (_e, id: number, input) => focus.updateSession(getDb(), Number(id), input))
  ipcMain.handle('focus:deleteSession', (_e, id: number) => focus.deleteSession(getDb(), Number(id)))
  ipcMain.handle('focus:taskSeconds', (_e, taskId: number) => focus.getTaskFocusSeconds(getDb(), Number(taskId)))

  ipcMain.handle('projects:list', (_e, includeArchived?: boolean) => focus.listProjects(getDb(), includeArchived === true))
  ipcMain.handle('projects:create', (_e, input) => focus.createProject(getDb(), input))
  ipcMain.handle('projects:update', (_e, id: number, input) => focus.updateProject(getDb(), Number(id), input))
  ipcMain.handle('projects:delete', (_e, id: number) => focus.deleteProject(getDb(), Number(id)))

  // ---- Phase 5: Tools hub (snippets, scratchpads, clipboard) ----
  ipcMain.handle('snippets:list', () => toolsHub.listSnippets(getDb()))
  ipcMain.handle('snippets:create', (_e, input) => toolsHub.createSnippet(getDb(), input))
  ipcMain.handle('snippets:update', (_e, id: number, input) => toolsHub.updateSnippet(getDb(), Number(id), input))
  ipcMain.handle('snippets:remove', (_e, id: number) => toolsHub.deleteSnippet(getDb(), Number(id)))
  ipcMain.handle('scratchpads:list', () => toolsHub.listScratchpads(getDb()))
  ipcMain.handle('scratchpads:ensure', () => toolsHub.ensureScratchpad(getDb()))
  ipcMain.handle('scratchpads:create', (_e, input) => toolsHub.createScratchpad(getDb(), input ?? {}))
  ipcMain.handle('scratchpads:update', (_e, id: number, patch) => toolsHub.updateScratchpad(getDb(), Number(id), patch ?? {}))
  ipcMain.handle('scratchpads:remove', (_e, id: number) => toolsHub.deleteScratchpad(getDb(), Number(id)))
  ipcMain.handle('scratchpads:saveAsNote', (_e, id: number) => {
    const note = toolsHub.scratchpadToNote(getDb(), Number(id))
    return { id: note.id, title: note.title }
  })
  // Copying uses Electron's clipboard (the OS clipboard), never the network.
  ipcMain.handle('tools:copyText', (_e, text: string) => { clipboard.writeText(String(text ?? '')) })
  ipcMain.handle('app:dataPath', () => dataDir())
  ipcMain.handle('app:openDataFolder', () => shell.openPath(dataDir()).then(() => undefined))

  ipcMain.handle('backup:exportJson', async (e, today: string): Promise<ExportResult | null> => {
    const data = collectBackup(getDb())
    const path = await saveFile(e, `feeblests-everything-backup-${today}.json`, 'Backup (JSON)', 'json', JSON.stringify(data, null, 2))
    return path ? { path, counts: countsOf(data) } : null
  })
  ipcMain.handle('backup:exportTradesCsv', async (e, today: string): Promise<ExportResult | null> => {
    const data = collectBackup(getDb())
    const path = await saveFile(e, `feeblests-trades-${today}.csv`, 'Trades (CSV)', 'csv', tradesToCsv(data.trades))
    return path ? { path, counts: { entries: 0, trades: data.trades.length, goals: 0, transactions: 0, habits: 0, checkins: 0, tasks: 0, subtasks: 0 } } : null
  })
  ipcMain.handle('backup:chooseImport', async (e): Promise<ImportPreview | null> => {
    const win = parentOf(e)
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Backup (JSON)', extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    pendingImport = null
    const parsed = parseBackup(readFileSync(file, 'utf8'), MIGRATIONS.length) // throws a readable message if wrong
    pendingImport = parsed
    return { fileName: basename(file), exportedAt: parsed.exportedAt, counts: countsOf(parsed), current: currentCounts(getDb()) }
  })
  ipcMain.handle('intelligence:get', () => {
    const saved = getSettings()
    return { features: mergeFeatures(saved.intelligence?.features, {}) }
  })
  ipcMain.handle('intelligence:set', (_e, features: Partial<IntelligenceFeatureToggles>): IntelligenceSettings => {
    const saved = getSettings()
    const next: IntelligenceSettings = {
      features: mergeFeatures(saved.intelligence?.features, features)
    }
    setSetting('intelligence', next)
    return next
  })

  // ---- AI assistant (step 6) ----
  ipcMain.handle('assistant:get', () => assistantSettings())
  ipcMain.handle('assistant:set', (_e, patch: Partial<AssistantSettings>) => setAssistantSettings(patch))
  ipcMain.handle('assistant:keyStatus', () => keyStatus())
  ipcMain.handle('assistant:setKey', (_e, key: string) => storeKey(String(key ?? '')))
  ipcMain.handle('assistant:clearKey', () => { clearKey() })
  ipcMain.handle('assistant:functions', () => assistantFunctionList())
  ipcMain.handle('assistant:ask', (_e, question: string, today: string, previousRequest: unknown) =>
    askAssistant(getDb(), String(question ?? ''), today, previousRequest))

  // ---- Calculator (calc_* tables) ----
  ipcMain.handle('calculator:saveHistory', (_e, item) => calc.saveCalcHistory(getDb(), item))
  ipcMain.handle('calculator:listHistory', (_e, limit?: number) => calc.listCalcHistory(getDb(), limit))
  ipcMain.handle('calculator:clearHistory', () => { calc.clearCalcHistory(getDb()) })
  ipcMain.handle('calculator:deleteHistoryItem', (_e, id: string) => { calc.deleteCalcHistoryItem(getDb(), id) })
  ipcMain.handle('calculator:togglePinHistory', (_e, id: string) => { calc.togglePinCalcHistory(getDb(), id) })
  ipcMain.handle('calculator:saveVariable', (_e, name: string, value: string) => { calc.saveCalcVariable(getDb(), name, value) })
  ipcMain.handle('calculator:listVariables', () => calc.listCalcVariables(getDb()))
  ipcMain.handle('calculator:deleteVariable', (_e, name: string) => { calc.deleteCalcVariable(getDb(), name) })
  ipcMain.handle('calculator:saveProgram', (_e, program) => calc.saveCalcProgram(getDb(), program))
  ipcMain.handle('calculator:listPrograms', () => calc.listCalcPrograms(getDb()))
  ipcMain.handle('calculator:deleteProgram', (_e, id: string) => { calc.deleteCalcProgram(getDb(), id) })
  ipcMain.handle('calculator:saveRateSet', (_e, rateSet) => calc.saveCalcRateSet(getDb(), rateSet))
  ipcMain.handle('calculator:renameRateSet', (_e, id: string, newName: string) => calc.renameCalcRateSet(getDb(), id, newName))
  ipcMain.handle('calculator:deleteRateSet', (_e, id: string) => { calc.deleteCalcRateSet(getDb(), id) })
  ipcMain.handle('calculator:selectRateSet', (_e, id: string) => { calc.selectCalcRateSet(getDb(), id) })
  ipcMain.handle('calculator:listRateSets', () => calc.listCalcRateSets(getDb()))
  ipcMain.handle('calculator:saveRate', (_e, rate) => calc.saveCalcRate(getDb(), rate))
  ipcMain.handle('calculator:updateRate', (_e, id: string, rateToBase: string, note?: string, name?: string) =>
    calc.updateCalcRate(getDb(), id, rateToBase, note, name)
  )
  ipcMain.handle('calculator:listRates', (_e, rateSetId: string) => calc.listCalcRates(getDb(), rateSetId))
  ipcMain.handle('calculator:saveRateOverride', (_e, override) => calc.saveCalcRateOverride(getDb(), override))
  ipcMain.handle('calculator:listRateOverrides', (_e, rateSetId: string) => calc.listCalcRateOverrides(getDb(), rateSetId))
  ipcMain.handle('calculator:deleteRateOverride', (_e, id: string) => { calc.deleteCalcRateOverride(getDb(), id) })
  ipcMain.handle('calculator:importRateSet', (_e, rateSetId: string, rows, mode: 'merge' | 'replace') =>
    calc.importCalcRateSet(getDb(), rateSetId, rows, mode)
  )
  ipcMain.handle('calculator:getSetting', (_e, key) => calc.getCalcSetting(getDb(), key))
  ipcMain.handle('calculator:setSetting', (_e, key, value) => { calc.setCalcSetting(getDb(), key, value) })
  ipcMain.handle('calculator:getAllSettings', () => calc.getAllCalcSettings(getDb()))

  ipcMain.handle('backup:applyImport', async (): Promise<ImportResult> => {
    if (!pendingImport) throw new Error('Choose a backup file first.')
    const copy = await safetyCopy() // so a wrong import can be undone
    const counts = restoreBackup(getDb(), pendingImport)
    pendingImport = null
    capture.apply() // the restored settings may hold a different capture shortcut
    return { counts, safetyCopy: copy }
  })

  createWindow()
  capture.apply() // after the main window exists, so start-up is not slowed by it
  // Clicking the Dock icon on a Mac: the hidden capture window counts as a window, so ask about the main one.
  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
