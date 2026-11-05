// Trash and purge (Phase 0). Everything the Trash page, the Undo toast and
// the startup purge need, in ONE place over all soft-deleted tables.
//
// Shapes:
//  - every trashed row carries deleted_at + delete_batch_id (migration 17);
//  - rows trashed as ONE action share one batch id (a goal and all of its
//    transactions; a multi-select task delete), so a batch restores (or is
//    deleted forever) as a whole;
//  - auto-purge: a batch whose OLDEST row was trashed more than `purgeDays`
//    days ago is deleted for good at startup (the daily backups are the real
//    recovery path - this is not a time machine). Batches purge whole so a
//    group never leaves a piece of itself behind.
//
// The LABELS come from each module file (its own table stays its own), and
// the shared FTS index is kept in step here for restores and deletions.
import type Database from 'better-sqlite3'
import { describeTrashed as describeLogbook } from './logbook'
import { describeTrashed as describeTrades } from './trades'
import { describeTrashed as describeSavings } from './savings'
import { describeTrashed as describeHabits } from './habits'
import { describeTrashed as describeTasks } from './tasks'
import { describeTrashed as describeNotes } from './notes'
import { describeTrashed as describeContent } from './content'
import { describeTrashed as describeFocus } from './focus'
import { describeTrashedSnippets } from './tools'
import { describeTrashedExpenses } from '../modules/expenses/service/transactions'
import { addDaysLocal, type TrashBatch, type TrashEntry } from '../shared/trash'
import { indexOne, removeOne, type EntityType } from './searchIndex'
import { pruneLinks } from './links'
import { setEntityTags } from './tags'
import type { LinkType } from '../shared/links'

// type -> table name. The id column is `id` in every one of them. `habit` has
// no search-index entry (habits do not appear in universal search), which the
// helpers handle.
const TABLES = {
  logbook: 'logbook_entries',
  trade: 'trades',
  savings_tx: 'savings_transactions',
  goal: 'savings_goals',
  habit: 'habits',
  task: 'tasks',
  note: 'notes',
  content: 'content_items',
  time_session: 'time_sessions',
  project: 'projects',
  snippet: 'snippets',
  scratchpad: 'scratchpads',
  expense_tx: 'expense_transactions',
  recurring_bill: 'recurring_bills'
} as const

type TrashTable = keyof typeof TABLES

// ---------- Trash page data ----------

export function listTrash(db: Database.Database): TrashBatch[] {
  const entries: TrashEntry[] = [
    ...describeLogbook(db),
    ...describeTrades(db),
    ...describeSavings(db),
    ...describeHabits(db),
    ...describeTasks(db),
    ...describeNotes(db),
    ...describeContent(db),
    ...describeFocus(db),
    ...describeTrashedSnippets(db),
    ...describeTrashedExpenses(db)
  ]
  const byBatch = new Map<string, TrashBatch>()
  for (const e of entries) {
    const key = e.batchId ?? `solo-${e.type}-${e.id}` // batch ids always exist; the fallback only guards hand-edited data
    const batch = byBatch.get(key) ?? { batchId: e.batchId, trashedAt: e.trashedAt, count: 0, items: [] }
    batch.count++
    batch.items.push({ type: e.type, id: e.id, label: e.label, sublabel: e.sublabel })
    byBatch.set(key, batch)
  }
  return [...byBatch.values()].sort((a, b) => b.trashedAt.localeCompare(a.trashedAt) || b.count - a.count)
}

// ---------- restore / delete forever (per batch) ----------

const idsInBatch = (db: Database.Database, table: string, batchId: string): number[] =>
  (db.prepare(`SELECT id FROM ${table} WHERE delete_batch_id = ? AND deleted_at IS NOT NULL ORDER BY id`).all(batchId) as { id: number }[])
    .map((r) => r.id)

const hasSearchIndex = (t: string): t is EntityType =>
  t !== 'habit' && t !== 'project' && t !== 'recurring_bill'

const isPrunableLinkType = (t: string): t is LinkType =>
  t !== 'habit' && t !== 'savings_tx' && t !== 'time_session' && t !== 'project' && t !== 'snippet' && t !== 'scratchpad' && t !== 'expense_tx' && t !== 'recurring_bill'

const reindexRestored = (db: Database.Database, type: TrashTable, ids: number[]): void => {
  if (hasSearchIndex(type)) {
    for (const id of ids) indexOne(db, type, id)
  }
}

export function restoreBatch(db: Database.Database, batchId: string): number {
  let restored = 0
  for (const [type, table] of Object.entries(TABLES) as [TrashTable, string][]) {
    const ids = idsInBatch(db, table, batchId)
    if (ids.length === 0) continue
    restored += db.prepare(`UPDATE ${table} SET deleted_at = NULL, delete_batch_id = NULL WHERE delete_batch_id = ? AND deleted_at IS NOT NULL`).run(batchId).changes
    reindexRestored(db, type, ids)
    // Notes carry their taggings; restoring one must bring its tags back too.
    if (type === 'note') restoreNoteTaggings(db, ids)
  }
  return restored
}

// The taggings of a trashed note are left alone by deleteNote (the note may
// come back). Restoring re-adds the ones it still holds in its tags column.
function restoreNoteTaggings(db: Database.Database, noteIds: number[]): void {
  for (const id of noteIds) {
    const row = db.prepare('SELECT tags FROM notes WHERE id = ?').get(id) as { tags: string } | undefined
    if (!row) continue
    setEntityTags(db, 'note', id, JSON.parse(row.tags || '[]') as string[])
  }
}

// A note deleted for good must not leave taggings pointing at a missing row.
function clearNoteTaggings(db: Database.Database, noteIds: number[]): void {
  if (noteIds.length === 0) return
  const marks = noteIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM taggings WHERE entity_type = 'note' AND entity_id IN (${marks})`).run(...noteIds)
}

export function deleteBatchForever(db: Database.Database, batchId: string): number {
  let removed = 0
  for (const [type, table] of Object.entries(TABLES) as [TrashTable, string][]) {
    const ids = idsInBatch(db, table, batchId)
    if (ids.length === 0) continue
    if (hasSearchIndex(type)) {
      for (const id of ids) removeOne(db, type, id)
    }
    if (isPrunableLinkType(type)) {
      pruneLinks(db, type, ids)
    }
    if (type === 'note') clearNoteTaggings(db, ids)
    // The tables' own foreign keys take the children with the parent (an
    // uncascaded goal's transactions were trashed under the same batch).
    removed += db.prepare(`DELETE FROM ${table} WHERE delete_batch_id = ? AND deleted_at IS NOT NULL`).run(batchId).changes
  }
  return removed
}

// ---------- auto-purge (runs at startup) ----------

// Deletes for good every stale row (search-index entries included). A batch
// is stale when its OLDEST trashed day is before the cutoff, so a group
// purges together; the cutoff is a local date compared on the date part of
// the ISO stamps, matching the bucketing the backup filenames use.
// Hidden links are swept by the same rule (they have no batches).
export function purgeTrash(db: Database.Database, purgeDays: number, today: string): number {
  const cutoff = addDaysLocal(today, -purgeDays) // the last day that still stays
  let removed = 0
  for (const [type, table] of Object.entries(TABLES) as [TrashTable, string][]) {
    // Rows of a batch whose oldest trashed day is over the line. For the rare
    // stray rows without a batch id, their own day decides.
    const stale = db.prepare(
      `SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND substr(deleted_at, 1, 10) <= ?
       AND substr(deleted_at, 1, 10) <= COALESCE((SELECT MIN(substr(t2.deleted_at, 1, 10)) FROM ${table} t2
             WHERE t2.delete_batch_id = ${table}.delete_batch_id AND t2.deleted_at IS NOT NULL), substr(deleted_at, 1, 10))`
    ).all(cutoff) as { id: number }[]
    if (stale.length === 0) continue
    const ids = stale.map((r) => r.id)
    if (hasSearchIndex(type)) {
      for (const id of ids) removeOne(db, type, id)
    }
    if (isPrunableLinkType(type)) {
      pruneLinks(db, type, ids)
    }
    removed += db.prepare(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes
  }
  // Hidden links (a link to a trashed item) never reappear for rows that were
  // purged; sweeping the old hidden ones by the same day rule keeps the table
  // from growing forever. The table has no batches, so the day decides.
  db.prepare('DELETE FROM links WHERE deleted_at IS NOT NULL AND substr(deleted_at, 1, 10) <= ?').run(cutoff)
  return removed
}
