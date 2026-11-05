// Tools hub data (Phase 5): snippets and scratchpads.
//
// Both are small, local, soft-deleted like every other user-facing table. The
// scratchpad is a plain-text pad that autosaves; "Save as note" copies it into
// the Notes module (the pad itself stays, so nothing is lost by accident).
import type Database from 'better-sqlite3'
import type { Snippet, SnippetInput, Scratchpad } from '../shared/toolsData'
import { LIVE, newBatchId, nowIso, trashByWhere } from './repo'
import { createNote } from './notes'
import { normalizeTags } from '../shared/tags'
import { indexOne, removeOne } from './searchIndex'

interface SnippetRow {
  id: number; title: string; body: string; tags: string
  created_at: string; updated_at: string; deleted_at: string | null; delete_batch_id: string | null
}
interface ScratchpadRow {
  id: number; name: string; content: string; position: number
  created_at: string; updated_at: string; deleted_at: string | null; delete_batch_id: string | null
}

const toSnippet = (r: SnippetRow): Snippet => ({
  id: r.id, title: r.title, body: r.body, tags: JSON.parse(r.tags || '[]'),
  createdAt: r.created_at, updatedAt: r.updated_at
})

const toPad = (r: ScratchpadRow): Scratchpad => ({
  id: r.id, name: r.name, content: r.content, position: r.position,
  createdAt: r.created_at, updatedAt: r.updated_at
})

// ---------- snippets ----------

export function listSnippets(db: Database.Database): Snippet[] {
  return (db.prepare(`SELECT * FROM snippets WHERE ${LIVE()} ORDER BY updated_at DESC, id DESC`).all() as SnippetRow[])
    .map(toSnippet)
}

export function getSnippet(db: Database.Database, id: number): Snippet {
  const row = db.prepare(`SELECT * FROM snippets WHERE id = ? AND ${LIVE()}`).get(id) as SnippetRow | undefined
  if (!row) throw new Error('Snippet not found')
  return toSnippet(row)
}

function prepareSnippet(input: SnippetInput) {
  const title = input.title.trim()
  if (!title) throw new Error('Give the snippet a title, even a short one.')
  return { title, body: input.body ?? '', tags: JSON.stringify(normalizeTags(input.tags ?? [])) }
}

export function createSnippet(db: Database.Database, input: SnippetInput): Snippet {
  const s = prepareSnippet(input)
  const now = nowIso()
  const info = db.prepare(
    `INSERT INTO snippets (title, body, tags, created_at, updated_at) VALUES (@title, @body, @tags, @now, @now)`
  ).run({ ...s, now })
  const id = Number(info.lastInsertRowid)
  indexOne(db, 'snippet', id)
  return getSnippet(db, id)
}

export function updateSnippet(db: Database.Database, id: number, input: SnippetInput): Snippet {
  getSnippet(db, id)
  const s = prepareSnippet(input)
  const changes = db.prepare(
    `UPDATE snippets SET title=@title, body=@body, tags=@tags, updated_at=@now WHERE id=@id AND ${LIVE()}`
  ).run({ ...s, id, now: nowIso() }).changes
  if (changes === 0) throw new Error('Snippet not found')
  indexOne(db, 'snippet', id)
  return getSnippet(db, id)
}

export function deleteSnippet(db: Database.Database, id: number): string {
  getSnippet(db, id)
  const batch = newBatchId()
  const trashed = trashByWhere(db, 'snippets', `id = ? AND ${LIVE()}`, [id], batch)
  if (trashed === 0) throw new Error('Snippet not found')
  removeOne(db, 'snippet', id)
  return batch
}

export function getSnippetsByIds(db: Database.Database, ids: number[]): Snippet[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM snippets WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as SnippetRow[]).map(toSnippet)
}

// ---------- scratchpads ----------

export function listScratchpads(db: Database.Database): Scratchpad[] {
  return (db.prepare(`SELECT * FROM scratchpads WHERE ${LIVE()} ORDER BY position ASC, id ASC`).all() as ScratchpadRow[])
    .map(toPad)
}

export function getScratchpad(db: Database.Database, id: number): Scratchpad {
  const row = db.prepare(`SELECT * FROM scratchpads WHERE id = ? AND ${LIVE()}`).get(id) as ScratchpadRow | undefined
  if (!row) throw new Error('Scratchpad not found')
  return toPad(row)
}

// The pad the hub opens by default: the first live one, created on demand so
// the tool is never an empty page with nothing to type into.
export function ensureScratchpad(db: Database.Database): Scratchpad {
  const existing = listScratchpads(db)
  if (existing.length > 0) return existing[0]
  return createScratchpad(db, { name: 'Notes', content: '' })
}

export function createScratchpad(db: Database.Database, input: { name?: string; content?: string }): Scratchpad {
  const now = nowIso()
  const next = (db.prepare(`SELECT MAX(position) AS p FROM scratchpads WHERE ${LIVE()}`).get() as { p: number | null }).p
  const info = db.prepare(
    `INSERT INTO scratchpads (name, content, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run((input.name ?? '').trim() || 'Untitled pad', input.content ?? '', next === null ? 0 : next + 1, now, now)
  const created = getScratchpad(db, Number(info.lastInsertRowid))
  indexOne(db, 'scratchpad', created.id)
  return created
}

// Autosave: the text is written as typed (debounced by the UI).
export function updateScratchpad(db: Database.Database, id: number, patch: { name?: string; content?: string }): Scratchpad {
  const existing = getScratchpad(db, id)
  const name = patch.name !== undefined ? patch.name.trim() || 'Untitled pad' : existing.name
  const content = patch.content !== undefined ? patch.content : existing.content
  db.prepare(`UPDATE scratchpads SET name = ?, content = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`)
    .run(name, content, nowIso(), id)
  const updated = getScratchpad(db, id)
  indexOne(db, 'scratchpad', updated.id)
  return updated
}

export function deleteScratchpad(db: Database.Database, id: number): string {
  getScratchpad(db, id)
  const batch = newBatchId()
  const trashed = trashByWhere(db, 'scratchpads', `id = ? AND ${LIVE()}`, [id], batch)
  if (trashed === 0) throw new Error('Scratchpad not found')
  removeOne(db, 'scratchpad', id)
  return batch
}

// "Save as note": copies the pad into Notes. The pad stays where it is.
export function scratchpadToNote(db: Database.Database, id: number) {
  const pad = getScratchpad(db, id)
  return createNote(db, {
    title: pad.name || 'Scratchpad',
    body: pad.content,
    tags: [],
    pinned: false,
    archived: false
  })
}

// ---------- trash ----------

export function describeTrashedSnippets(db: Database.Database) {
  const snippets = (db.prepare('SELECT id, title, deleted_at, delete_batch_id FROM snippets WHERE deleted_at IS NOT NULL').all() as {
    id: number; title: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'snippet' as const, id: r.id, batchId: r.delete_batch_id, trashedAt: r.deleted_at,
    label: r.title, sublabel: 'Snippet'
  }))
  const pads = (db.prepare('SELECT id, name, deleted_at, delete_batch_id FROM scratchpads WHERE deleted_at IS NOT NULL').all() as {
    id: number; name: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'scratchpad' as const, id: r.id, batchId: r.delete_batch_id, trashedAt: r.deleted_at,
    label: r.name || 'Scratchpad', sublabel: 'Scratchpad'
  }))
  return [...snippets, ...pads]
}

export function getScratchpadsByIds(db: Database.Database, ids: number[]): Scratchpad[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM scratchpads WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as ScratchpadRow[]).map(toPad)
}
