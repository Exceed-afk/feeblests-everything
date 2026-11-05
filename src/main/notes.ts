// Notes queries (Phase 2). Owns `notes` plus everything a note touches:
// the shared search index, the tag rows, and [[wiki links]] through the Links
// service (wiki links are ordinary `links` rows with relation 'wiki').
//
// Deletes are soft: deleteNote trashes the row under one batch id, so Undo and
// the Trash page bring it back with its links and tags intact.
import type Database from 'better-sqlite3'
import type { Note, NoteFilter, NoteInput } from '../shared/notes'
import { deriveTitle, sortNotes } from '../shared/notes'
// DOM-free helpers only: this file is in the MAIN process, where `marked` and DOMPurify cannot load.
import { findHashtags, findWikiLinks, plainSummary, wordCount, wikiSlug } from '../shared/markdownText'
import { normalizeTags } from '../shared/tags'
import { LIVE, newBatchId, nowIso, trashByWhere } from './repo'
import { indexOne, removeOne } from './searchIndex'
import { setEntityTags } from './tags'
import { addLink, pruneLinks, removeLink } from './links'
import type { TrashEntry } from '../shared/trash'

// The relation stored on `links` for a [[wiki link]].
export const WIKI_RELATION = 'wiki'

interface NoteRow {
  id: number
  title: string
  title_key: string
  body: string
  tags: string
  pinned: number
  archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  delete_batch_id: string | null
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  tags: JSON.parse(r.tags || '[]'),
  pinned: r.pinned === 1,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  wordCount: wordCount(r.body)
})

// The explicit tags plus any #tag typed in the body, normalised. Body tags are
// stored on the row too, so the Tags page and search see one list per note.
const effectiveTags = (input: NoteInput): string[] =>
  normalizeTags([...(input.tags ?? []), ...findHashtags(input.body ?? '')])

function prepare(input: NoteInput) {
  const body = input.body ?? ''
  const title = (input.title ?? '').trim() || deriveTitle(body)
  return {
    title,
    titleKey: wikiSlug(title),
    body,
    tags: JSON.stringify(effectiveTags(input)),
    pinned: input.pinned ? 1 : 0,
    archived: input.archived ? 1 : 0
  }
}

export function getNote(db: Database.Database, id: number): Note {
  const row = db.prepare(`SELECT * FROM notes WHERE id = ? AND ${LIVE()}`).get(id) as NoteRow | undefined
  if (!row) throw new Error('Note not found')
  return toNote(row)
}

// Live notes, pinned first then most recently edited. `archived: true` lists
// the archive; leaving it undefined lists only unarchived notes.
export function listNotes(db: Database.Database, filter: NoteFilter = {}): Note[] {
  const where = [LIVE()]
  const params: unknown[] = []
  if (filter.archived === true) where.push('archived = 1')
  else where.push('archived = 0')
  if (filter.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)')
    params.push(normalizeTags([filter.tag])[0] ?? filter.tag)
  }
  if (filter.text?.trim()) {
    where.push('(title LIKE ? OR body LIKE ?)')
    const like = `%${filter.text.trim()}%`
    params.push(like, like)
  }
  const rows = db.prepare(`SELECT * FROM notes WHERE ${where.join(' AND ')}`).all(...params) as NoteRow[]
  return sortNotes(rows.map(toNote))
}

// How many live notes exist, archived included (empty-state copy).
export function countNotes(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE ${LIVE()}`).get() as { n: number }).n
}

export function createNote(db: Database.Database, input: NoteInput): Note {
  const n = prepare(input)
  const now = nowIso()
  const id = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO notes (title, title_key, body, tags, pinned, archived, created_at, updated_at)
       VALUES (@title, @titleKey, @body, @tags, @pinned, @archived, @now, @now)`
    ).run({ ...n, now })
    const newId = Number(info.lastInsertRowid)
    afterWrite(db, newId)
    return newId
  })()
  return getNote(db, id)
}

export function updateNote(db: Database.Database, id: number, input: NoteInput): Note {
  getNote(db, id)
  const n = prepare(input)
  db.transaction(() => {
    const changes = db.prepare(
      `UPDATE notes SET title=@title, title_key=@titleKey, body=@body, tags=@tags, pinned=@pinned,
         archived=@archived, updated_at=@now WHERE id=@id AND ${LIVE()}`
    ).run({ ...n, id, now: nowIso() }).changes
    if (changes === 0) throw new Error('Note not found')
    afterWrite(db, id)
  })()
  return getNote(db, id)
}

export function setNotePinned(db: Database.Database, id: number, pinned: boolean): Note {
  getNote(db, id)
  db.prepare(`UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`).run(pinned ? 1 : 0, nowIso(), id)
  return getNote(db, id)
}

export function setNoteArchived(db: Database.Database, id: number, archived: boolean): Note {
  getNote(db, id)
  db.prepare(`UPDATE notes SET archived = ?, updated_at = ? WHERE id = ? AND ${LIVE()}`).run(archived ? 1 : 0, nowIso(), id)
  return getNote(db, id)
}

export function deleteNote(db: Database.Database, id: number): string {
  getNote(db, id)
  const batch = newBatchId()
  db.transaction(() => {
    const trashed = trashByWhere(db, 'notes', `id = ? AND ${LIVE()}`, [id], batch)
    if (trashed === 0) throw new Error('Note not found')
    removeOne(db, 'note', id)
  })()
  return batch
}

// Everything a write changes besides the row itself: the search index, the tag
// rows (so the Tags page counts notes), and the wiki links in the body.
function afterWrite(db: Database.Database, id: number): void {
  indexOne(db, 'note', id)
  const note = getNote(db, id)
  setEntityTags(db, 'note', id, note.tags)
  syncWikiLinks(db, id, note.body)
}

// Makes the note's outgoing wiki links match its body: missing targets are
// linked, links the user deleted from the text are removed. A target is the
// live note whose title key matches; when two share a title the oldest wins.
function syncWikiLinks(db: Database.Database, noteId: number, body: string): void {
  const wanted = new Map<number, string>() // target note id -> display title
  for (const link of findWikiLinks(body)) {
    const target = db.prepare(
      `SELECT id, title FROM notes WHERE title_key = ? AND ${LIVE()} AND id != ? ORDER BY created_at, id LIMIT 1`
    ).get(link.slug, noteId) as { id: number; title: string } | undefined
    if (target) wanted.set(target.id, target.title)
  }
  const existing = db.prepare(
    `SELECT id, source_type, source_id, target_type, target_id FROM links
     WHERE deleted_at IS NULL AND relation = ?
       AND ((source_type = 'note' AND source_id = ?) OR (target_type = 'note' AND target_id = ?))`
  ).all(WIKI_RELATION, noteId, noteId) as {
    id: number; source_type: string; source_id: number; target_type: string; target_id: number
  }[]

  const kept = new Set<number>()
  for (const row of existing) {
    const otherIsNote = row.source_type === 'note' && row.source_id === noteId
    const otherType = otherIsNote ? row.target_type : row.source_type
    const otherId = otherIsNote ? row.target_id : row.source_id
    if (otherType !== 'note') continue
    if (wanted.has(otherId) && !kept.has(otherId)) kept.add(otherId)
    else removeLink(db, row.id)
  }
  for (const targetId of wanted.keys()) {
    if (kept.has(targetId)) continue
    addLink(db, { type: 'note', id: noteId }, { type: 'note', id: targetId }, WIKI_RELATION)
  }
}

// The notes that link TO this one (backlinks), live only. The link is stored
// once with a normalised direction (see shared/links.ts), so the SOURCE note is
// whichever end is not this note.
export function listBacklinks(db: Database.Database, noteId: number): Note[] {
  const rows = db.prepare(
    `SELECT n.* FROM links l
     JOIN notes n ON n.id = CASE WHEN l.target_type = 'note' AND l.target_id = ?
                                 THEN l.source_id ELSE l.target_id END
     WHERE l.deleted_at IS NULL AND l.relation = ?
       AND ((l.target_type = 'note' AND l.target_id = ?) OR (l.source_type = 'note' AND l.source_id = ?))
       AND n.deleted_at IS NULL AND n.id != ?
     ORDER BY n.updated_at DESC`
  ).all(noteId, WIKI_RELATION, noteId, noteId, noteId) as NoteRow[]
  return rows.map(toNote)
}

// The note a [[title]] points at, or null. Newest live note with that key.
export function findNoteByTitle(db: Database.Database, title: string): Note | null {
  const row = db.prepare(
    `SELECT * FROM notes WHERE title_key = ? AND ${LIVE()} ORDER BY archived ASC, created_at, id LIMIT 1`
  ).get(wikiSlug(title)) as NoteRow | undefined
  return row ? toNote(row) : null
}

// ---------- promote between Notes and the Logbook ----------

// A journal entry's title and body, ready to become a note. "Convert to note"
// in the Logbook calls createNote with this; the entry itself stays put.
export function logbookToNoteInput(title: string, body: string, tags: string[], date: string): NoteInput {
  return {
    title: title || `Journal entry ${date}`,
    body: body,
    tags,
    pinned: false,
    archived: false
  }
}

// Used by the search provider and the UI: a short preview of a note.
export const notePreview = (note: Note, max = 160): string => plainSummary(note.body, max)

// Trash support (src/main/trash.ts collects these).
export function describeTrashed(db: Database.Database): TrashEntry[] {
  return (db.prepare('SELECT id, title, deleted_at, delete_batch_id FROM notes WHERE deleted_at IS NOT NULL').all() as {
    id: number; title: string; deleted_at: string; delete_batch_id: string | null
  }[]).map((r) => ({
    type: 'note' as const,
    id: r.id,
    batchId: r.delete_batch_id,
    trashedAt: r.deleted_at,
    label: r.title || 'Untitled note',
    sublabel: 'Note'
  }))
}

// Deleting a note for good takes its links with it.
export function deleteNoteForever(db: Database.Database, id: number): void {
  const changes = db.prepare('DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes
  if (changes === 0) throw new Error('Note is not in Trash')
  pruneLinks(db, 'note', [id])
  db.prepare(`DELETE FROM taggings WHERE entity_type = 'note' AND entity_id = ?`).run(id)
}

// Hydration for search results and the item picker.
export function getNotesByIds(db: Database.Database, ids: number[]): Note[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM notes WHERE id IN (${marks}) AND ${LIVE()}`).all(...ids) as NoteRow[])
    .map(toNote)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function listNotesCreatedBetween(db: Database.Database, fromIso: string, toIso: string): Note[] {
  const from = `${fromIso}T00:00:00.000Z`
  const to = `${toIso}T23:59:59.999Z`
  const rows = db.prepare(
    `SELECT * FROM notes WHERE ${LIVE()} AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC`
  ).all(from, to) as NoteRow[]
  return rows.map(toNote)
}
