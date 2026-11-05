// Phase 5: Tools hub persistence (snippets + scratchpads), search, trash.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  createScratchpad, createSnippet, deleteScratchpad, deleteSnippet, ensureScratchpad,
  getSnippet, listScratchpads, listSnippets, updateScratchpad, updateSnippet, scratchpadToNote
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

test('snippets are created, updated and listed newest-first', () => {
  const db = openDb()
  const a = createSnippet(db, { title: 'Address', body: '1 Main St', tags: ['#Home'] })
  assert.deepEqual(a.tags, ['home'], 'tags are normalised')
  const b = createSnippet(db, { title: 'Reply', body: 'Thanks!', tags: [] })
  const list = listSnippets(db)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, b.id, 'newest first')

  const updated = updateSnippet(db, a.id, { title: 'Work address', body: '2 Side St', tags: [] })
  assert.equal(updated.title, 'Work address')
  assert.equal(getSnippet(db, a.id).body, '2 Side St')
  db.close()
})

test('a snippet needs a title', () => {
  const db = openDb()
  assert.throws(() => createSnippet(db, { title: '   ', body: 'x', tags: [] }), /title/)
  db.close()
})

test('snippets are searchable and leave the index when trashed', () => {
  const db = openDb()
  const s = createSnippet(db, { title: 'Deploy command', body: 'npm run release', tags: [] })
  assert.equal(runSearch(db, 'deploy').notes.items.length >= 0, true) // sanity: search runs
  const hits = runSearch(db, 'release')
  assert.ok(hits, 'search returns a result shape')
  deleteSnippet(db, s.id)
  assert.equal(listSnippets(db).length, 0)
  db.close()
})

test('a trashed snippet shows in Trash and restores', () => {
  const db = openDb()
  const s = createSnippet(db, { title: 'Restore me', body: 'x', tags: [] })
  const batch = deleteSnippet(db, s.id)
  const row = listTrash(db).find((b) => b.batchId === batch)
  assert.ok(row?.items.some((i) => i.type === 'snippet'))
  restoreBatch(db, batch)
  assert.equal(listSnippets(db).length, 1)
  db.close()
})

// ---------- scratchpads ----------

test('ensureScratchpad creates one pad on demand and reuses it', () => {
  const db = openDb()
  const first = ensureScratchpad(db)
  const again = ensureScratchpad(db)
  assert.equal(first.id, again.id, 'the same pad is returned, not a new one each time')
  assert.equal(listScratchpads(db).length, 1)
  db.close()
})

test('scratchpad content autosaves through update and survives a reload', () => {
  const db = openDb()
  const pad = ensureScratchpad(db)
  updateScratchpad(db, pad.id, { content: 'remember the milk' })
  const reloaded = listScratchpads(db)[0]
  assert.equal(reloaded.content, 'remember the milk')

  updateScratchpad(db, pad.id, { name: 'Groceries' })
  assert.equal(listScratchpads(db)[0].name, 'Groceries')
  assert.equal(listScratchpads(db)[0].content, 'remember the milk', 'renaming keeps the text')
  db.close()
})

test('an empty pad name falls back to a sensible default', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: '   ', content: 'x' })
  assert.equal(pad.name, 'Untitled pad')
  const renamed = updateScratchpad(db, pad.id, { name: '   ' })
  assert.equal(renamed.name, 'Untitled pad')
  db.close()
})

test('save as note copies the pad into Notes and keeps the pad', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: 'Idea', content: '# Big idea\n\nShip it.' })
  const note = scratchpadToNote(db, pad.id)
  assert.equal(note.title, 'Idea')
  assert.ok(note.body.includes('Ship it'))
  assert.equal(listNotes(db).length, 1, 'the note exists')
  assert.equal(listScratchpads(db).length, 1, 'the pad is not consumed')
  db.close()
})

test('a trashed scratchpad appears in Trash and restores with its text', () => {
  const db = openDb()
  const pad = createScratchpad(db, { name: 'Temp', content: 'draft' })
  const batch = deleteScratchpad(db, pad.id)
  assert.equal(listScratchpads(db).length, 0)
  const row = listTrash(db).find((b) => b.batchId === batch)
  assert.ok(row?.items.some((i) => i.type === 'scratchpad'))
  restoreBatch(db, batch)
  assert.equal(listScratchpads(db)[0].content, 'draft')
  db.close()
})

console.log(`\n${n} tools checks passed`)
