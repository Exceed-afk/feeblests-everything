// Main process: creates the window and answers requests from the UI.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { basename, join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { initDatabase, getSettings, setSetting, dataDir, getDb, safetyCopy } from './db'
import { runDailyChecksIfNeeded } from './dailyCheck'
import { collectBackup, currentCounts, restoreBackup } from './backup'
import { countsOf, parseBackup, tradesToCsv, type BackupFile } from '../shared/backup'
import { normalizeSettings, resolveTokens } from '../shared/appearance'
import { mergeFeatures } from '../shared/intelligence'
import { MIGRATIONS } from './migrations'
import { startReminders } from './reminders'
import { listEntries, listTags, createEntry, updateEntry, deleteEntry } from './logbook'
import { listTrades, tradeMeta, createTrade, updateTrade, deleteTrade } from './trades'
import * as savings from './savings'
import * as habits from './habits'
import * as tasks from './tasks'
import { runSearch } from './search'
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
  ipcMain.handle('logbook:tags', () => listTags(getDb()))
  ipcMain.handle('logbook:create', (_e, input: LogEntryInput) => createEntry(getDb(), input))
  ipcMain.handle('logbook:update', (_e, id: number, input: LogEntryInput) => updateEntry(getDb(), id, input))
  ipcMain.handle('logbook:remove', (_e, id: number) => deleteEntry(getDb(), id))
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
