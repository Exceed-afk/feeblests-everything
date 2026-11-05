// The soft-delete helpers every module's query file uses (Phase 0).
//
// One place for the rules:
//  - rows are trashed (deleted_at = now) instead of removed, in one
//    transaction, under one delete_batch_id;
//  - a delete batch groups rows that were trashed as ONE action (a savings
//    goal stamps all of its transactions with its own batch id), so an undo
//    or a restore brings the whole group back together;
//  - every live read filters `deleted_at IS NULL` (see liveSql);
//  - Trash itself lives in src/main/trash.ts (list, restore, purge), which
//    calls back into each module for its own table shapes.
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'

// Every ISO timestamp in the trash columns comes from here.
export const nowIso = (): string => new Date().toISOString()

// One batch id per delete action. Short, opaque and unique.
export const newBatchId = (): string => randomUUID()

// The standard live-only filter. Pass an alias when the query uses one
// (LIVE('t') becomes "t.deleted_at IS NULL"); plain LIVE() covers single-table
// selects. Every listing, total and count in the app goes through reads that
// include this filter, which is what keeps totals from counting trashed rows.
export const LIVE = (alias = ''): string => `${alias ? alias + '.' : ''}deleted_at IS NULL`

// Marks the matching rows as trashed under one batch id. Call inside a
// transaction. Returns how many rows it changed (0 = nothing matched).
export function trashByWhere(db: Database.Database, table: string, where: string, params: unknown[], batchId?: string): number {
  const id = batchId ?? newBatchId()
  return db.prepare(`UPDATE ${table} SET deleted_at = ?, delete_batch_id = ? WHERE ${where}`).run(nowIso(), id, ...params).changes
}

// Brings the matching rows back (clears deleted_at and the batch id).
export function restoreByWhere(db: Database.Database, table: string, where: string, params: unknown[]): number {
  return db.prepare(`UPDATE ${table} SET deleted_at = NULL, delete_batch_id = NULL WHERE ${where}`).run(...params).changes
}
