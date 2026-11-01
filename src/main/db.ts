// All database code lives here. The UI never touches the database directly.
import Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { migrateColorScheme } from '../shared/appearance'
import { applyMigrations } from './migrations'
import { localDate } from './util'

let db: Database.Database

export const getDb = (): Database.Database => db

export const dataDir = (): string => join(app.getPath('userData'), 'data')

export async function initDatabase(): Promise<boolean> {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'everything.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const ready = await runMigrationsWithBackup(db, dir, () => {
    applyMigrations(db)
    migrateSettingsKeys(db)
  }, (error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Database migration failed; startup is stopping:', error)
    dialog.showErrorBox('Database migration failed', `The database could not be upgraded, so the app will close.\n\n${message}`)
    app.quit()
  })
  if (!ready) return false
  await dailyBackup(dir)
  return true
}

export async function backupBeforeMigrations(
  handle: Database.Database,
  dir: string,
  now: Date = new Date()
): Promise<string> {
  const backupDir = join(dir, 'before-migrate')
  mkdirSync(backupDir, { recursive: true })
  const target = join(backupDir, `everything-${now.toISOString().replace(/[:.]/g, '-')}.db`)
  await handle.backup(target)
  readdirSync(backupDir).filter((file) => file.endsWith('.db')).sort().reverse().slice(3)
    .forEach((file) => unlinkSync(join(backupDir, file)))
  return target
}

export async function runMigrationsWithBackup(
  handle: Database.Database,
  dir: string,
  migrate: () => void,
  onFailure: (error: unknown) => void
): Promise<boolean> {
  try {
    await backupBeforeMigrations(handle, dir)
    migrate()
    return true
  } catch (error) {
    onFailure(error)
    return false
  }
}

export function migrateSettingsKeys(handle: Database.Database): void {
  const row = handle.prepare("SELECT value FROM settings WHERE key = 'intelligence'").get() as { value: string } | undefined
  if (!row) return

  const parsed: unknown = JSON.parse(row.value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The saved intelligence settings are not an object.')
  }
  const intelligence = parsed as Record<string, unknown>
  const hasAutomations = Object.prototype.hasOwnProperty.call(intelligence, 'automations')
  const hasDismissals = Object.prototype.hasOwnProperty.call(intelligence, 'dismissedInsights')
  const hasAiProvider = Object.prototype.hasOwnProperty.call(intelligence, 'aiProvider')
  if (!hasAutomations && !hasDismissals && !hasAiProvider) return

  const automationsExist = Boolean(handle.prepare("SELECT 1 FROM settings WHERE key = 'automations'").get())
  const dismissalsExist = Boolean(handle.prepare("SELECT 1 FROM settings WHERE key = 'insightDismissals'").get())
  const previousProvider = intelligence.aiProvider
  let assistantSettings: Record<string, unknown> = {}
  if (previousProvider === 'local' || previousProvider === 'cloud') {
    const assistantRow = handle.prepare("SELECT value FROM settings WHERE key = 'assistant'").get() as { value: string } | undefined
    if (assistantRow) {
      const savedAssistant: unknown = JSON.parse(assistantRow.value)
      if (!savedAssistant || typeof savedAssistant !== 'object' || Array.isArray(savedAssistant)) {
        throw new Error('The saved assistant settings are not an object.')
      }
      assistantSettings = savedAssistant as Record<string, unknown>
    }
  }
  const migrateProvider = (previousProvider === 'local' || previousProvider === 'cloud')
    && (assistantSettings.provider === undefined || assistantSettings.provider === null || assistantSettings.provider === 'off')
  const save = handle.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  handle.transaction(() => {
    if (hasAutomations && !automationsExist) save.run('automations', JSON.stringify(intelligence.automations))
    if (hasDismissals && !dismissalsExist) save.run('insightDismissals', JSON.stringify(intelligence.dismissedInsights))
    if (migrateProvider) save.run('assistant', JSON.stringify({ ...assistantSettings, provider: previousProvider }))
    const next = { ...intelligence }
    delete next.automations
    delete next.dismissedInsights
    delete next.aiProvider
    save.run('intelligence', JSON.stringify(next))
  })()
}

// One backup copy per day, keeping the newest 14, in data/backups.
async function dailyBackup(dir: string): Promise<void> {
  const backups = join(dir, 'backups')
  mkdirSync(backups, { recursive: true })
  const target = join(backups, `everything-${localDate()}.db`)
  if (!existsSync(target)) await db.backup(target)
  const old = readdirSync(backups).filter((f) => f.endsWith('.db')).sort().reverse().slice(14)
  old.forEach((f) => unlinkSync(join(backups, f)))
}

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const saved = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  const legacyScheme = saved.colorScheme ?? saved.colourScheme
  if (legacyScheme !== undefined) {
    const palette = migrateColorScheme(saved.palette, legacyScheme)
    if (palette) {
      db.transaction(() => {
        setSetting('palette', palette)
        db.prepare("DELETE FROM settings WHERE key IN ('colorScheme', 'colourScheme')").run()
      })()
      saved.palette = palette
    }
    delete saved.colorScheme
    delete saved.colourScheme
  }
  return { ...DEFAULT_SETTINGS, ...saved }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

// Copy of the whole database, made right before an import replaces it.
// Kept in its own folder so the daily-backup cleanup never deletes it; newest 5 stay.
export async function safetyCopy(): Promise<string> {
  const dir = join(dataDir(), 'before-import')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `everything-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  await db.backup(target)
  readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().slice(5).forEach((f) => unlinkSync(join(dir, f)))
  return target
}
