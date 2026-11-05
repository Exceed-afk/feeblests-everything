// Phase 2: the Notes service (CRUD, pin/archive, tags, wiki links, promote,
// search index, trash). Runs against a real in-memory SQLite database.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  createNote, deleteNote, deleteNoteForever, findNoteByTitle, getNote, getNotesByIds, listBacklinks,
  listNotes, logbookToNoteInput, setNoteArchived, setNotePinned, updateNote
} from '../src/main/notes'
import { listTrash, restoreBatch } from '../src/main/trash'
import { listLinksFor } from '../src/main/links'
import { runSearch } from '../src/main/search'
import { tagsOf, tagCounts } from '../src/main/tags'
import { createEntry } from '../src/main/logbook'
import { createTask } from '../src/main/tasks'
import { deriveTitle, mergeNoteTags, sortNotes, type Note } from '../src/shared/notes'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

const note = (over: Partial<{ title: string; body: string; tags: string[]; pinned: boolean; archived: boolean }> = {}) => ({
  title: over.title ?? 'Note', body: over.body ?? 'Body', tags: over.tags ?? [], pinned: over.pinned ?? false, archived: over.archived ?? false
})

// ---------- pure rules ----------

test('note sort puts pinned first, then newest edit', () => {
  const mk = (id: number, pinned: boolean, updatedAt: string): Note => ({
    id, title: `n${id}`, body: '', tags: [], pinned, archived: false, createdAt: '', updatedAt
  })
  const sorted = sortNotes([mk(1, false, '2026-11-02'), mk(2, true, '2026-11-01'), mk(3, false, '2026-11-03')])
  assert.deepEqual(sorted.map((x) => x.id), [2, 3, 1])
})

test('a note without a title takes its first line', () => {
  assert.equal(deriveTitle('# Shopping list\nmilk'), 'Shopping list')
  assert.equal(deriveTitle('\n\nJust text'), 'Just text')
  assert.equal(deriveTitle('   \n\n'), 'Untitled note')
})

test('effective tags merge the explicit list and body hashtags, deduplicated', () => {
  assert.deepEqual(mergeNoteTags(['Work'], ['#work', 'ideas', '#Ideas']), ['work', 'ideas'])
})

// ---------- CRUD ----------

test('create, read and update a note; the title derives from the first line', () => {
  const db = openDb()
  const created = createNote(db, note({ title: '', body: '# Planning\n\n- item' }))
  assert.equal(created.title, 'Planning')
  assert.equal(created.wordCount, 2) // "Planning item" — the list marker is not a word

  const updated = updateNote(db, created.id, note({ title: 'Planning 2026', body: 'rewritten' }))
  assert.equal(updated.title, 'Planning 2026')
  assert.equal(updated.id, created.id)
  assert.equal(getNote(db, created.id).body, 'rewritten')
  db.close()
})

test('notes are listed pinned first and archived notes leave the normal list', () => {
  const db = openDb()
  const a = createNote(db, note({ title: 'A' }))
  const b = createNote(db, note({ title: 'B' }))
  setNotePinned(db, a.id, true)
  assert.deepEqual(listNotes(db).map((x) => x.title), ['A', 'B'])

  setNoteArchived(db, b.id, true)
  assert.deepEqual(listNotes(db).map((x) => x.title), ['A'])
  assert.deepEqual(listNotes(db, { archived: true }).map((x) => x.title), ['B'])
  db.close()
})

test('a body #tag is stored as a tag and appears on the Tags page counts', () => {
  const db = openDb()
  const created = createNote(db, note({ title: 'Video ideas', body: 'shoot the intro #video-idea' }))
  assert.deepEqual(created.tags, ['video-idea'])
  assert.deepEqual(tagsOf(db, 'note', created.id).map((t) => t.name), ['video-idea'])
  const counts = tagCounts(db).find((c) => c.tag.name === 'video-idea')
  assert.equal(counts?.counts.note, 1)
  db.close()
})

test('tags are filtered by the same normalised name', () => {
  const db = openDb()
  createNote(db, note({ title: 'One', tags: ['Work'] }))
  createNote(db, note({ title: 'Two', tags: ['home'] }))
  assert.deepEqual(listNotes(db, { tag: '  #WORK ' }).map((n) => n.title), ['One'])
  db.close()
})

// ---------- search ----------

test('notes are in the shared search index, and leave it when trashed', () => {
  const db = openDb()
  const created = createNote(db, note({ title: 'Quarterly planning', body: 'budget review' }))
  const hit = runSearch(db, 'quarterly').notes.items[0]
  assert.equal(hit.id, created.id)
  assert.ok(hit.preview.includes('budget'))

  const batch = deleteNote(db, created.id)
  assert.equal(runSearch(db, 'quarterly').notes.items.length, 0)
  restoreBatch(db, batch)
  assert.equal(runSearch(db, 'quarterly').notes.items.length, 1)
  db.close()
})

// ---------- wiki links ----------

test('[[wiki links]] create note-to-note links that show on both sides', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Meeting Notes' }))
  const source = createNote(db, note({ title: 'Index', body: 'See [[Meeting Notes]] for details.' }))

  const fromSource = listLinksFor(db, 'note', source.id)
  assert.equal(fromSource.length, 1)
  assert.equal(fromSource[0].id, target.id)
  assert.equal(fromSource[0].label, 'Meeting Notes')

  const backlinks = listBacklinks(db, target.id)
  assert.deepEqual(backlinks.map((b) => b.title), ['Index'])
})

test('a wiki link matches case-insensitively, and is dropped when the text is removed', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Ideas' }))
  const source = createNote(db, note({ title: 'Index', body: 'see [[ideas]]' }))
  assert.equal(listLinksFor(db, 'note', source.id).length, 1)

  updateNote(db, source.id, note({ title: 'Index', body: 'no links now' }))
  assert.equal(listLinksFor(db, 'note', source.id).length, 0)
  assert.equal(listBacklinks(db, target.id).length, 0)
})

test('removing a link and adding the same link again revives it (no UNIQUE error)', () => {
  const db = openDb()
  const created = createNote(db, note({ title: 'N' }))
  const task = createTask(db, {
    title: 'T', notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null,
    project: null, tags: [], subtasks: [], recurrenceRule: null, recurrenceNext: null
  })
  const { addLink, removeLink } = require('../src/main/links') as typeof import('../src/main/links')
  const first = addLink(db, { type: 'note', id: created.id }, { type: 'task', id: task.id })
  removeLink(db, first)
  assert.equal(listLinksFor(db, 'note', created.id).length, 0)
  const again = addLink(db, { type: 'note', id: created.id }, { type: 'task', id: task.id })
  assert.equal(again, first, 'the same row is revived, not duplicated')
  assert.equal(listLinksFor(db, 'note', created.id).length, 1)
  db.close()
})

test('a wiki link removed from the text and typed again works', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Loop target' }))
  const source = createNote(db, note({ title: 'Loop source', body: '[[Loop target]]' }))
  updateNote(db, source.id, note({ title: 'Loop source', body: 'plain text now' }))
  assert.equal(listLinksFor(db, 'note', source.id).length, 0)
  updateNote(db, source.id, note({ title: 'Loop source', body: '[[Loop target]] again' }))
  assert.equal(listLinksFor(db, 'note', source.id).length, 1)
  assert.equal(listBacklinks(db, target.id).length, 1)
  db.close()
})

test('a revived link is pruned when its target is deleted for good', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Doomed' }))
  const source = createNote(db, note({ title: 'Keeper', body: '[[Doomed]]' }))
  // Remove and re-add so the row is a revived one.
  const { removeLink } = require('../src/main/links') as typeof import('../src/main/links')
  removeLink(db, listLinksFor(db, 'note', source.id)[0].linkId)
  updateNote(db, source.id, note({ title: 'Keeper', body: 'plain' }))
  updateNote(db, source.id, note({ title: 'Keeper', body: '[[Doomed]] again' }))

  const batch = deleteNote(db, target.id)
  deleteNoteForever(db, target.id)
  assert.equal(listLinksFor(db, 'note', source.id).length, 0, 'no link may point at a gone row')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM links').get() as { n: number }).n, 0)
  void batch
  db.close()
})

test('a wiki link to a title that does not exist yet creates nothing', () => {
  const db = openDb()
  const source = createNote(db, note({ title: 'Index', body: '[[Not written yet]]' }))
  assert.equal(listLinksFor(db, 'note', source.id).length, 0)
  assert.equal(findNoteByTitle(db, 'Not written yet'), null)
})

test('findNoteByTitle ignores trashed notes', () => {
  const db = openDb()
  const noteA = createNote(db, note({ title: 'Archived idea' }))
  deleteNote(db, noteA.id)
  assert.equal(findNoteByTitle(db, 'Archived idea'), null)
  db.close()
})

test('deleting the target hides the link, restoring it brings it back', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Target' }))
  const source = createNote(db, note({ title: 'Source', body: '[[Target]]' }))
  const batch = deleteNote(db, target.id)
  assert.equal(listLinksFor(db, 'note', source.id).length, 0)
  restoreBatch(db, batch)
  assert.equal(listLinksFor(db, 'note', source.id).length, 1)
  db.close()
})

// ---------- trash ----------

test('a trashed note shows in Trash and restores with its tags and links', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Target', tags: ['tagged'] }))
  const batch = deleteNote(db, target.id)
  assert.equal(getNotesByIds(db, [target.id]).length, 0)

  const batchRow = listTrash(db).find((b) => b.batchId === batch)
  assert.equal(batchRow?.items[0].type, 'note')
  assert.equal(batchRow?.items[0].label, 'Target')

  restoreBatch(db, batch)
  assert.equal(getNote(db, target.id).title, 'Target')
  assert.deepEqual(tagsOf(db, 'note', target.id).map((t) => t.name), ['tagged'])
})

test('a tag removed and re-added comes back (the hidden tagging is revived)', () => {
  const db = openDb()
  const created = createNote(db, note({ title: 'Tagged', tags: ['alpha'] }))
  updateNote(db, created.id, note({ title: 'Tagged', tags: [] }))
  assert.equal(tagsOf(db, 'note', created.id).length, 0)
  updateNote(db, created.id, note({ title: 'Tagged', tags: ['alpha'] }))
  assert.deepEqual(tagsOf(db, 'note', created.id).map((t) => t.name), ['alpha'])
})

test('delete forever removes the note, its taggings and its links', () => {
  const db = openDb()
  const target = createNote(db, note({ title: 'Gone', tags: ['x'] }))
  const source = createNote(db, note({ title: 'Kept', body: '[[Gone]]' }))
  const batch = deleteNote(db, target.id)
  deleteNoteForever(db, target.id)
  assert.equal(db.prepare('SELECT id FROM notes WHERE id = ?').get(target.id), undefined)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM taggings WHERE entity_type = 'note' AND entity_id = ?").get(target.id) as { n: number }).n, 0)
  assert.equal(listLinksFor(db, 'note', source.id).length, 0)
  // A live note cannot be deleted forever.
  assert.throws(() => deleteNoteForever(db, source.id), /not in Trash/)
  void batch
  db.close()
})

// ---------- promote ----------

test('a journal entry converts to a note input that keeps title, body and tags', () => {
  const db = openDb()
  const entry = createEntry(db, { date: '2026-11-02', title: 'Rough day', body: 'noted', mood: 'low', tags: ['work'] })
  const input = logbookToNoteInput(entry.title, entry.body, entry.tags, entry.date)
  const created = createNote(db, input)
  assert.equal(created.title, 'Rough day')
  assert.equal(created.body, 'noted')
  assert.deepEqual(created.tags, ['work'])
  db.close()
})

test('listNotes with archived: false returns unarchived notes and ignores trashed', () => {
  const db = openDb()
  const live = createNote(db, note({ title: 'Live Note' }))
  const archived = createNote(db, note({ title: 'Archived Note', archived: true }))
  const trashed = createNote(db, note({ title: 'Trashed Note' }))
  deleteNote(db, trashed.id)

  const active = listNotes(db, { archived: false })
  assert.equal(active.length, 1)
  assert.equal(active[0].id, live.id)
  db.close()
})

console.log(`\n${n} notes checks passed`)
