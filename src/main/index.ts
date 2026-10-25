// Main process: creates the window and answers requests from the UI.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { initDatabase, getSettings, setSetting, dataDir, getDb, safetyCopy } from './db'
import { collectBackup, currentCounts, restoreBackup } from './backup'
import { countsOf, parseBackup, tradesToCsv, type BackupFile } from '../shared/backup'
import { MIGRATIONS } from './migrations'
import { listEntries, listTags, createEntry, updateEntry, deleteEntry } from './logbook'
import { listTrades, tradeMeta, createTrade, updateTrade, deleteTrade } from './trades'
import * as savings from './savings'
import { runSearch } from './search'
import { getDashboard } from './dashboard'
import type { ExportResult, ImportPreview, ImportResult, SavingsGoalInput, SavingsTxInput, LogEntryInput, LogFilter, TradeFilter, TradeInput } from '../shared/types'

const APP_NAME = "Feeblest's Everything"

function createWindow(): void {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117', // matches dark theme, avoids a white flash
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // keeps the web page separated from Node.js
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })

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

app.whenReady().then(async () => {
  await initDatabase()

  // Each ipcMain.handle is one function the UI may call (see preload/index.ts).
  ipcMain.handle('settings:getAll', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))
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
  ipcMain.handle('dashboard:summary', (_e, today: string) => getDashboard(getDb(), today))
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
    return path ? { path, counts: { entries: 0, trades: data.trades.length, goals: 0, transactions: 0 } } : null
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
  ipcMain.handle('backup:applyImport', async (): Promise<ImportResult> => {
    if (!pendingImport) throw new Error('Choose a backup file first.')
    const copy = await safetyCopy() // so a wrong import can be undone
    const counts = restoreBackup(getDb(), pendingImport)
    pendingImport = null
    return { counts, safetyCopy: copy }
  })

  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
