// Categories service for Expenses (Phase 1).
import type Database from 'better-sqlite3'
import { LIVE, newBatchId, nowIso, trashByWhere } from '../../../main/repo'
import type { ExpenseCategory, ExpenseCategoryInput } from './types'

interface CategoryRow {
  id: number
  name: string
  colour: string
  icon: string
  archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toCategory = (r: CategoryRow): ExpenseCategory => ({
  id: r.id,
  name: r.name,
  colour: r.colour,
  icon: r.icon,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  deleteBatchId: r.delete_batch_id
})

export function listCategories(db: Database.Database, includeArchived = false): ExpenseCategory[] {
  const archiveFilter = includeArchived ? '' : 'AND archived = 0'
  const rows = db.prepare(
    `SELECT * FROM expense_categories WHERE ${LIVE()} ${archiveFilter} ORDER BY archived ASC, name ASC`
  ).all() as CategoryRow[]
  return rows.map(toCategory)
}

export function getCategory(db: Database.Database, id: number): ExpenseCategory {
  const row = db.prepare(
    `SELECT * FROM expense_categories WHERE id = ? AND ${LIVE()}`
  ).get(id) as CategoryRow | undefined
  if (!row) throw new Error('Category not found')
  return toCategory(row)
}

export function createCategory(db: Database.Database, input: ExpenseCategoryInput): ExpenseCategory {
  const name = input.name.trim()
  if (!name) throw new Error('Category name cannot be empty')
  const colour = input.colour.trim() || '#6b7280'
  const icon = input.icon.trim() || 'Tag'
  const now = nowIso()

  const info = db.prepare(
    `INSERT INTO expense_categories (name, colour, icon, archived, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run(name, colour, icon, now, now)

  return getCategory(db, Number(info.lastInsertRowid))
}

export function updateCategory(
  db: Database.Database,
  id: number,
  input: Partial<ExpenseCategoryInput>
): ExpenseCategory {
  const existing = getCategory(db, id)
  const name = input.name !== undefined ? input.name.trim() : existing.name
  if (!name) throw new Error('Category name cannot be empty')
  const colour = input.colour !== undefined ? input.colour.trim() : existing.colour
  const icon = input.icon !== undefined ? input.icon.trim() : existing.icon
  const now = nowIso()

  db.prepare(
    `UPDATE expense_categories SET name = ?, colour = ?, icon = ?, updated_at = ?
     WHERE id = ? AND ${LIVE()}`
  ).run(name, colour, icon, now, id)

  return getCategory(db, id)
}

export function archiveCategory(db: Database.Database, id: number, archived = true): ExpenseCategory {
  getCategory(db, id)
  const now = nowIso()
  db.prepare(
    `UPDATE expense_categories SET archived = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`
  ).run(archived ? 1 : 0, now, id)
  return getCategory(db, id)
}

export function deleteCategory(db: Database.Database, id: number): string {
  getCategory(db, id)
  const batchId = newBatchId()
  const changes = trashByWhere(db, 'expense_categories', `id = ? AND ${LIVE()}`, [id], batchId)
  if (changes === 0) throw new Error('Category not found')
  return batchId
}
