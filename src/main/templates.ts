// The templates engine (Phase 0). Owns the `templates` table.
//
// The MANAGER UI arrives in Phase 6; today the engine offers: list, create
// ("Save as template" from an editor), remove and the variable render
// ({{date}}, {{weekday}}, {{time}} via src/shared/templates.ts). No rule
// lives anywhere else, so Phase 2/3 templates (Notes, Content checklists)
// plug straight in.
import type Database from 'better-sqlite3'
import { isTemplateKind, type Template, TemplateKind } from '../shared/templates'
import { nowIso } from './repo'

interface Row {
  id: number; kind: string; name: string; payload: string; is_builtin: number
  created_at: string; updated_at: string; deleted_at: string | null
}

const toTemplate = (r: Row): Template => ({
  id: r.id, kind: isTemplateKind(r.kind) ? r.kind : 'logbook', name: r.name, payload: JSON.parse(r.payload),
  isBuiltin: r.is_builtin === 1, createdAt: r.created_at, updatedAt: r.updated_at
})

// One kind's templates, saved first. Built-ins come after user templates so
// the manager (Phase 6) can put "mine" at the top.
export function listTemplates(db: Database.Database, kind?: TemplateKind): Template[] {
  // The live-only filter is always there; the kind filter is optional.
  const where = kind ? 'AND kind = ?' : ''
  const params = kind ? [kind] : []
  return (db.prepare(`SELECT * FROM templates WHERE deleted_at IS NULL ${where} ORDER BY created_at DESC, id DESC`).all(...params) as Row[])
    .map(toTemplate).sort((a, b) => (a.isBuiltin !== b.isBuiltin ? (a.isBuiltin ? 1 : -1) : 0))
}

// Saves (or replaces) a template. The name must be unique per kind but an
// existing row is UPDATED, so "Save as template" twice with the same name
// keeps one up-to-date copy instead of a pile.
export function saveTemplate(db: Database.Database, kind: TemplateKind, name: string, payload: unknown): Template {
  if (!isTemplateKind(kind)) throw new Error('Unknown template kind')
  const clean = name.trim()
  if (!clean) throw new Error('Give the template a name')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The template payload must be an object')
  if (clean.length > 80) throw new Error('Template names are at most 80 characters')
  const now = new Date().toISOString()
  const info = db.prepare(
    `UPDATE templates SET payload = ?, updated_at = ?, deleted_at = NULL
     WHERE kind = ? AND name = ? AND deleted_at IS NULL`
  ).run(JSON.stringify(payload), now, kind, clean)
  if (info.changes > 0) {
    return getByName(db, kind, clean)
  }
  const made = db.prepare(
    'INSERT INTO templates (kind, name, payload, is_builtin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(kind, clean, JSON.stringify(payload), now, now)
  return getByName(db, kind, clean)
}

export function removeTemplate(db: Database.Database, id: number): void {
  // Built-ins come back with the app (Phase 6 resets them); user templates
  // are trashed like any other item.
  const result = db.prepare('UPDATE templates SET deleted_at = ? WHERE id = ? AND is_builtin = 0').run(nowIso(), id)
  if (result.changes === 0) throw new Error('Template is built in and cannot be removed')
}

export function clearTemplates(db: Database.Database): void {
  db.prepare('DELETE FROM templates WHERE is_builtin = 1').run()
}

// "Restore built-ins" (Settings > Templates). Trashes the built-in rows that
// are still live and records the moment; seeding on the next load then brings
// the built-in templates back (see seedBuiltinTemplates). User templates are
// never touched. Returns how many built-ins were set aside.
export function restoreBuiltinTemplates(db: Database.Database, now: string = nowIso()): number {
  return db.transaction(() => {
    const changed = db.prepare('UPDATE templates SET deleted_at = ?, updated_at = ? WHERE is_builtin = 1 AND deleted_at IS NULL').run(now, now).changes
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('templatesResetAt', JSON.stringify(now))
    return changed
  })()
}

function getByName(db: Database.Database, kind: TemplateKind, name: string): Template {
  const row = db.prepare('SELECT * FROM templates WHERE kind = ? AND name = ? AND deleted_at IS NULL ORDER BY id DESC').get(kind, name) as Row | undefined
  if (!row) throw new Error('Template not found')
  return toTemplate(row)
}
