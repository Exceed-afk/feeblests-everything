// Backup file format + CSV, as plain functions with no Electron or database
// code, so they are easy to test. The database side is in src/main/backup.ts.
import { calcPnl } from './trades'
import type { BackupCounts, Direction, TxKind } from './types'

export const BACKUP_APP = 'feeblests-everything'
export const BACKUP_FORMAT = 1

// Raw rows as stored in the database (camelCase). P&L and balances are NOT in
// here because they are always calculated from these fields.
export interface BackupEntry { id: number; date: string; title: string; body: string; mood: string | null; tags: string[]; createdAt: string; updatedAt: string }
export interface BackupTrade { id: number; date: string; asset: string; direction: Direction; entryPrice: number; exitPrice: number | null; quantity: number; fees: number; notes: string; tags: string[]; createdAt: string; updatedAt: string }
export interface BackupGoal { id: number; name: string; target: number | null; notes: string; createdAt: string; updatedAt: string }
export interface BackupTx { id: number; goalId: number; date: string; kind: TxKind; amount: number; note: string; createdAt: string; updatedAt: string }

export interface BackupFile {
  app: typeof BACKUP_APP
  format: number // layout of this file
  schemaVersion: number // database version it was made from
  exportedAt: string
  settings: Record<string, unknown>
  logbook: BackupEntry[]
  trades: BackupTrade[]
  savingsGoals: BackupGoal[]
  savingsTransactions: BackupTx[]
}

export const countsOf = (b: Pick<BackupFile, 'logbook' | 'trades' | 'savingsGoals' | 'savingsTransactions'>): BackupCounts => ({
  entries: b.logbook.length, trades: b.trades.length, goals: b.savingsGoals.length, transactions: b.savingsTransactions.length
})

// ---------- Checking an imported file ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStrArray = (v: unknown): boolean => Array.isArray(v) && v.every(isStr)

// Throws an Error with a plain message pointing at the first problem found.
// `maxSchema` is the newest database version this app understands.
export function parseBackup(text: string, maxSchema: number): BackupFile {
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/, '')) } catch { throw new Error('This file is not valid JSON.') }
  if (!isObj(data) || data.app !== BACKUP_APP) throw new Error("This is not a Feeblest's Everything backup file.")
  if (data.format !== BACKUP_FORMAT) throw new Error('This backup was made by a different version of the app and cannot be read.')
  if (!isInt(data.schemaVersion) || data.schemaVersion > maxSchema)
    throw new Error('This backup comes from a newer version of the app. Update the app first, then import it.')
  for (const k of ['logbook', 'trades', 'savingsGoals', 'savingsTransactions'])
    if (!Array.isArray(data[k])) throw new Error(`The backup is missing its "${k}" list.`)
  if (!isObj(data.settings)) throw new Error('The backup is missing its settings.')

  const bad = (what: string, i: number, id: unknown): never => {
    throw new Error(`${what} #${i + 1} (id ${String(id)}) has a missing or invalid field.`)
  }
  const common = (r: Record<string, unknown>) => isInt(r.id) && isStr(r.createdAt) && isStr(r.updatedAt)

  const seen = (rows: { id: number }[], what: string) => {
    const ids = new Set<number>()
    for (const r of rows) {
      if (ids.has(r.id)) throw new Error(`${what} contains the id ${r.id} twice.`)
      ids.add(r.id)
    }
    return ids
  }

  const logbook = data.logbook as Record<string, unknown>[]
  logbook.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isDate(r.date) || !isStr(r.title) || !isStr(r.body) ||
        !(r.mood === null || isStr(r.mood)) || !isStrArray(r.tags)) bad('Logbook entry', i, isObj(r) ? r.id : '?')
  })
  const trades = data.trades as Record<string, unknown>[]
  trades.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isDate(r.date) || !isStr(r.asset) || !r.asset.trim() ||
        (r.direction !== 'long' && r.direction !== 'short') || !isNum(r.entryPrice) || !(r.entryPrice > 0) ||
        !(r.exitPrice === null || (isNum(r.exitPrice) && r.exitPrice > 0)) || !isNum(r.quantity) || !(r.quantity > 0) ||
        !isNum(r.fees) || r.fees < 0 || !isStr(r.notes) || !isStrArray(r.tags)) bad('Trade', i, isObj(r) ? r.id : '?')
  })
  const goals = data.savingsGoals as Record<string, unknown>[]
  goals.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isStr(r.name) || !(r.target === null || (isNum(r.target) && r.target > 0)) ||
        !isStr(r.notes)) bad('Savings goal', i, isObj(r) ? r.id : '?')
  })
  const txs = data.savingsTransactions as Record<string, unknown>[]
  txs.forEach((r, i) => {
    if (!isObj(r) || !common(r) || !isInt(r.goalId) || !isDate(r.date) || (r.kind !== 'deposit' && r.kind !== 'withdrawal') ||
        !isNum(r.amount) || !(r.amount > 0) || !isStr(r.note)) bad('Savings transaction', i, isObj(r) ? r.id : '?')
  })

  seen(logbook as never, 'The logbook'); seen(trades as never, 'The trades')
  const goalIds = seen(goals as never, 'The savings goals'); seen(txs as never, 'The savings transactions')
  for (const t of txs as unknown as BackupTx[])
    if (!goalIds.has(t.goalId)) throw new Error(`Savings transaction ${t.id} belongs to goal ${t.goalId}, which is not in the file.`)

  return data as unknown as BackupFile
}

// ---------- Trades as CSV (opens in Excel) ----------
const CSV_COLUMNS = ['id', 'date', 'asset', 'direction', 'entry_price', 'exit_price', 'quantity', 'fees', 'pnl', 'status', 'tags', 'notes']

// Quotes a value when needed. Text starting with = + - @ gets a leading ' so
// Excel cannot run it as a formula.
function cell(v: string | number | null, isText = false): string {
  if (v === null) return ''
  let s = String(v)
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// UTF-8 BOM first so Excel reads accents correctly; CRLF line endings.
export function tradesToCsv(trades: BackupTrade[]): string {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const lines = [CSV_COLUMNS.join(',')]
  for (const t of sorted) {
    lines.push([
      cell(t.id), cell(t.date), cell(t.asset, true), cell(t.direction), cell(t.entryPrice), cell(t.exitPrice),
      cell(t.quantity), cell(t.fees), cell(calcPnl(t)), t.exitPrice === null ? 'open' : 'closed',
      cell(t.tags.join(' '), true), cell(t.notes, true)
    ].join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
