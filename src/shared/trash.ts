// Trash shapes and date math, pure so tests (and the Trash page) can share
// them without any database or Electron code (Phase 0).
//
// Rows trashed as ONE action share a delete_batch_id, and the Trash page shows
// one row per BATCH (a goal and its transactions are one undoable unit). A
// lone row is its own batch, so it shows the same way.

// What kind of item a trashed row is. The Trash page maps these to names and
// the restore/delete-forever queries to tables (src/main/trash.ts).
export type TrashType = 'logbook' | 'trade' | 'goal' | 'savings_tx' | 'habit' | 'task' | 'note' | 'content' | 'time_session' | 'project' | 'snippet' | 'scratchpad' | 'expense_tx' | 'recurring_bill'

// One trashed row as each module describes it (labels live in the module's
// own file, so no SQL for its table lives anywhere else).
export interface TrashEntry {
  type: TrashType
  id: number
  batchId: string | null
  trashedAt: string // ISO timestamp
  label: string // the main line, e.g. "Weekly review 19-25 Oct"
  sublabel?: string // the second line, e.g. "Deposit of 500"
}

export interface TrashItem { type: TrashType; id: number; label: string; sublabel?: string }

// One undoable group: one batch, its items, when the batch was trashed and how at
// many rows it holds.
export interface TrashBatch {
  batchId: string | null
  trashedAt: string
  count: number
  items: TrashItem[]
}

// The local-date math shared with the purge: days before today, on the user's
// clock, like every other day bucket in the app (and the backup filenames).
export function addDaysLocal(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}

// Default auto-purge window: 30 days in Trash, then gone for good.
export const DEFAULT_TRASH_PURGE_DAYS = 30

// The oldest trashed day that still stays. A batch purges when its OLDEST row
// went over the line, so batches never half-purge (see src/main/trash.ts).
export function purgeCutoff(purgeDays: number, today: string): string {
  return addDaysLocal(today, -Math.max(0, purgeDays))
}
