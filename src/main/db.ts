// All database code lives here. The UI never touches the database directly.
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { migrateColorScheme } from '../shared/appearance'
import { applyMigrations } from './migrations'
import { localDate } from './util'

let db: Database.Database

export const getDb = (): Database.Database => db

export const dataDir = (): string => join(app.getPath('userData'), 'data')

export async function initDatabase(): Promise<void> {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'everything.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  try {
    applyMigrations(db)
    migrateSettingsKeys(db)
  } catch (e) {
    console.error('Migration failed, starting with fresh schema:', e)
    // If migrations fail, we still need a valid database.
    // The app will work with the base schema (migration 0), but
    // newer features may not be available until migrations are fixed.
  }
  await dailyBackup(dir)
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
  if (!hasAutomations && !hasDismissals) return

  const automationsExist = Boolean(handle.prepare("SELECT 1 FROM settings WHERE key = 'automations'").get())
  const dismissalsExist = Boolean(handle.prepare("SELECT 1 FROM settings WHERE key = 'insightDismissals'").get())
  const save = handle.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  handle.transaction(() => {
    if (hasAutomations && !automationsExist) save.run('automations', JSON.stringify(intelligence.automations))
    if (hasDismissals && !dismissalsExist) save.run('insightDismissals', JSON.stringify(intelligence.dismissedInsights))
    const next = { ...intelligence }
    delete next.automations
    delete next.dismissedInsights
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
