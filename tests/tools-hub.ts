// Phase 5: the Tools hub's stored data (snippets and scratchpads), plus how
// they behave with the shared services (search, trash, notes).
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  createScratchpad, createSnippet, deleteScratchpad, deleteSnippet, ensureScratchpad,
  getSnippet, listScratchpads, listSnippets, scratchpadToNote, updateScratchpad, updateSnippet
} from '../src/main/tools'
import { listTrash, restoreBatch } from '../src/main/trash'
import { runSearch } from '../src/main/search'
import { listNotes } from '../src/main/notes'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

// ---------- snippets ----------

test('a snippet is created, listed newest-first, and updated in place', () => {
  const db = openDb()
  const first = createSnippet(db, { title: 'Standup', body: 'Yesterday: x', tags: ['Work'] })
  const second = createSnippet(db, { title: 'Address', body: '12 High St', tags: [] })
  assert.equal(first.tags[0], 'work', 'tags are normalised')

  const titles = listSnippets(db).map((s) => s.title)
  assert.deepEqual(titles.sort(), ['Address', 'Standup'])

  const updated = updateSnippet(db, first.id, { title: 'Standup', body: 'Yesterday: y', tags: ['work'] })
  assert.equal(updated.body, 'Yesterday: y')
  assert.equal(listSnippets(db).find((s) => s.id === first.id)!.body, 'Yesterday: y')
  void second
  db.close()
})

test('a snippet needs a non-empty title', () => {
  const db = openDb()
  assert.throws(() => createSnippet(db, { title: '   ', body: 'x', tags: [] }), /title/)
  db.close()
})

test('snippets are searchable through the shared index', () => {
  const db = openDb()
  const s = createSnippet(db, { title: 'Deploy command', body: 'docker compose up -d', tags: ['ops'] })
  assert.equal(runSearch(db, 'docker').snippets?.items[0]?.id ?? -1, s.id)
  db.close()
})

test('a deleted snippet leaves search, shows in Trash, and restores', () => {
  const db = openDb()
  const s = createSnippet(db, { title: 'Temp note', body: 'throwaway', tags: [] })
  const batch = deleteSnippet(db, s.id)

  assert.equal(listSnippets(db).length, 0)
  const row = listTrash(db).find((b) => b.batchId === batch)
  assert.equal(row?.items[0].type, 'snippet')
  assert.equal(row?.items[0].label, 'Temp note')

  restoreBatch(db, batch)
  assert.equal(listSnippets(db).length, 1)
  assert.equal(getSnippet(db, s.id).title, 'Temp note')
  db.close()
})

// ---------- scratchpads ----------

test('ensureScratchpad creates the first pad only once', () => {
  const db = openDb()
  const first = ensureScratchpad(db)
  const second = ensureScratchpad(db)
  assert.equal(first.id, second.id)
  assert.equal(listScratchpads(db).length, 1)
  db.close()
})

test('a scratchpad autosaves its text and keeps a custom name', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: 'Groceries', content: 'milk' })
  updateScratchpad(db, pad.id, { content: 'milk\neggs' })
  const saved = updateScratchpad(db, pad.id, { name: 'Shopping' })
  assert.equal(saved.name, 'Shopping')
  assert.equal(saved.content, 'milk\neggs')
  db.close()
})

test('an empty pad name falls back to "Untitled pad"', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: '   ', content: '' })
  assert.equal(pad.name, 'Untitled pad')
  assert.equal(updateScratchpad(db, pad.id, { name: '  ' }).name, 'Untitled pad')
  db.close()
})

test('"Save as note" copies the pad into Notes and leaves the pad alone', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: 'Ideas', content: 'shoot a video about tools' })
  const note = scratchpadToNote(db, pad.id)
  assert.equal(note.title, 'Ideas')
  assert.equal(note.body, 'shoot a video about tools')
  assert.equal(listNotes(db).length, 1, 'the note exists')
  assert.equal(listScratchpads(db).length, 1, 'the pad is still there')
  db.close()
})

test('a deleted scratchpad shows in Trash and restores with its text', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: 'Kept', content: 'important text' })
  const batch = deleteScratchpad(db, pad.id)
  assert.equal(listScratchpads(db).length, 0)
  const row = listTrash(db).find((b) => b.batchId === batch)
  assert.equal(row?.items[0].type, 'scratchpad')
  restoreBatch(db, batch)
  assert.equal(listScratchpads(db)[0].content, 'important text')
  db.close()
})

console.log(`\n${n} tools hub checks passed`)
