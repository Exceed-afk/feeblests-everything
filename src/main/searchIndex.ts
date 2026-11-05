// The shared FTS5 search index (Phase 0).
//
// One row per LIVE item of the five searchable tables. `text` holds the same
// words the old per-module LIKE queries scanned (title/body/tags/date and so
// on), built here once per write, with every column's value joined by spaces.
// The migration (21) seeds the whole table the same way, so old and new data
// match alike.
//
// Maintenance rules:
//  - a create/update/upsert/re-index writes ONE row (indexOne);
//  - trashing a row removes it (removeOne), restoring adds it back; the
//    trash page and the delete-forever paths go through the same helpers;
//  - imports (restoreBackup) and any mass change call rebuild(), which
//    recopies every live row in one transaction;
//  - the index is DERIVED data: it is never exported to a backup, and a
//    restore rebuilds it.
import type Database from 'better-sqlite3'

// The searchable text of ONE live row. `row` comes straight from the table
// (snake_case columns). Keep this in step with migration 21's seed queries.
function contentOf(type: EntityType, row: Record<string, unknown>): string {
  switch (type) {
    case 'logbook':
      return [row.title, row.body, row.tags, row.date].join(' ')
    case 'trade':
      return [row.asset, row.notes, row.tags, row.date, row.direction].join(' ')
    case 'goal':
      return [row.name, row.notes].join(' ')
    case 'savings_tx':
      return [row.note, row.date, row.kind].join(' ')
    case 'task':
      return [row.title, row.notes, row.project ?? '', row.tags].join(' ')
    case 'note':
      return [row.title, row.body, row.tags].join(' ')
    case 'content':
      return [row.title, row.hook, row.platform, row.series, row.tags, row.post_notes].join(' ')
    case 'snippet':
      return [row.title, row.body, row.tags].join(' ')
    case 'expense_tx':
      return [row.payee, row.note, row.date, row.type, row.tags, (Number(row.amount || 0) / 100).toFixed(2)].join(' ')
    case 'time_session':
      return [row.project_name ?? '', row.note ?? '', row.type, row.started_at ? String(row.started_at).slice(0, 10) : ''].join(' ')
    case 'scratchpad':
      return [row.name ?? '', row.content ?? ''].join(' ')
  }
}

export type EntityType = 'logbook' | 'trade' | 'goal' | 'savings_tx' | 'task' | 'note' | 'content' | 'snippet' | 'expense_tx' | 'time_session' | 'scratchpad'

// Table + join for one (type, id): each entry selects the live row itself.
const SOURCE: Record<EntityType, { from: string; byId: string }> = {
  logbook: { from: 'logbook_entries', byId: 'id = ? AND deleted_at IS NULL' },
  trade: { from: 'trades', byId: 'id = ? AND deleted_at IS NULL' },
  goal: { from: 'savings_goals', byId: 'id = ? AND deleted_at IS NULL' },
  savings_tx: { from: 'savings_transactions', byId: 'id = ? AND deleted_at IS NULL' },
  task: { from: 'tasks', byId: 'id = ? AND deleted_at IS NULL' },
  note: { from: 'notes', byId: 'id = ? AND deleted_at IS NULL' },
  content: { from: 'content_items', byId: 'id = ? AND deleted_at IS NULL' },
  snippet: { from: 'snippets', byId: 'id = ? AND deleted_at IS NULL' },
  expense_tx: { from: 'expense_transactions', byId: 'id = ? AND deleted_at IS NULL' },
  time_session: { from: 'time_sessions', byId: 'id = ? AND deleted_at IS NULL' },
  scratchpad: { from: 'scratchpads', byId: 'id = ? AND deleted_at IS NULL' }
}

// Writes (or rewrites) the index row of one item. Safe to call after any
// write; nothing to do when the row is not live (it is trashed or gone).
export function indexOne(db: Database.Database, type: EntityType, id: number): void {
  const src = SOURCE[type]
  const row = db.prepare(`SELECT * FROM ${src.from} WHERE ${src.byId}`).get(id) as Record<string, unknown> | undefined
  if (!row) { removeOne(db, type, id); return }
  db.prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?').run(type, id)
  db.prepare('INSERT INTO search_index (entity_type, entity_id, text) VALUES (?, ?, ?)').run(type, id, contentOf(type, row))
}

// Removes one item's index row (when it is trashed or deleted forever).
export function removeOne(db: Database.Database, type: EntityType, id: number): void {
  db.prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?').run(type, id)
}

// Recopies every live row. Called from the migration, after an import and on
// trash-wide changes (purge, restore-all) so the index can never drift.
export function rebuild(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM search_index').run()
    for (const type of Object.keys(SOURCE) as EntityType[]) {
      const rows = db.prepare(`SELECT * FROM ${SOURCE[type].from} WHERE deleted_at IS NULL`).all() as Record<string, unknown>[]
      const insert = db.prepare('INSERT INTO search_index (entity_type, entity_id, text) VALUES (?, ?, ?)')
      for (const row of rows) insert.run(type, row.id, contentOf(type, row))
    }
  })()
}
