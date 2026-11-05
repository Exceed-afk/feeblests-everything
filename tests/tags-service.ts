// Phase 2: the Tags page service — counts across both tag stores, rename,
// merge, delete, and the mixed-type item list.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { deleteTag, listTaggedItems, mergeTags, renameTag, tagCounts } from '../src/main/tags'
import { createEntry } from '../src/main/logbook'
import { createTrade } from '../src/main/trades'
import { createTask } from '../src/main/tasks'
import { createNote } from '../src/main/notes'
import { createGoal } from '../src/main/savings'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

const countOf = (db: ReturnType<typeof openDb>, name: string) =>
  tagCounts(db).find((c) => c.tag.name === name)?.counts

const seed = (db: ReturnType<typeof openDb>) => {
  createEntry(db, { date: '2026-11-01', title: 'Day one', body: '', mood: null, tags: ['work'] })
  createEntry(db, { date: '2026-11-02', title: 'Day two', body: '', mood: null, tags: ['work', 'home'] })
  createTrade(db, { date: '2026-11-01', asset: 'XAUUSD', direction: 'long', entryPrice: 1, exitPrice: 2, quantity: 1, fees: 0, notes: '', tags: ['work'] })
  createTask(db, {
    title: 'Ship it', notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null,
    project: null, tags: ['home'], subtasks: [], recurrenceRule: null, recurrenceNext: null
  })
  createNote(db, { title: 'Ideas', body: '', tags: ['work', 'ideas'], pinned: false, archived: false })
  createGoal(db, { name: 'Trip', target: 100, notes: '' })
}

test('counts see JSON tags (journal, trades, tasks) AND taggings (notes, goals)', () => {
  const db = openDb()
  seed(db)
  assert.deepEqual(countOf(db, 'work'), { logbook: 2, trade: 1, goal: 0, task: 0, note: 1, content: 0 })
  assert.deepEqual(countOf(db, 'home'), { logbook: 1, trade: 0, goal: 0, task: 1, note: 0, content: 0 })
  assert.deepEqual(countOf(db, 'ideas'), { logbook: 0, trade: 0, goal: 0, task: 0, note: 1, content: 0 })
  db.close()
})

test('trashed items are not counted', () => {
  const db = openDb()
  seed(db)
  const entryId = 1
  db.prepare('UPDATE logbook_entries SET deleted_at = ? WHERE id = ?').run('2026-11-03T00:00:00.000Z', entryId)
  assert.equal(countOf(db, 'work')?.logbook, 1)
  db.close()
})

test('rename applies everywhere: JSON columns and taggings', () => {
  const db = openDb()
  seed(db)
  renameTag(db, 'work', 'job')
  assert.equal(countOf(db, 'work'), undefined, 'the old tag is gone')
  assert.deepEqual(countOf(db, 'job'), { logbook: 2, trade: 1, goal: 0, task: 0, note: 1, content: 0 })
  const entry = db.prepare('SELECT tags FROM logbook_entries WHERE id = 1').get() as { tags: string }
  assert.deepEqual(JSON.parse(entry.tags), ['job'])
  db.close()
})

test('renaming onto an existing name merges instead of colliding', () => {
  const db = openDb()
  seed(db)
  renameTag(db, 'home', 'work')
  assert.equal(countOf(db, 'home'), undefined)
  assert.deepEqual(countOf(db, 'work'), { logbook: 2, trade: 1, goal: 0, task: 1, note: 1, content: 0 })
  // No item ends up listing the same tag twice.
  const rows = db.prepare('SELECT tags FROM logbook_entries').all() as { tags: string }[]
  for (const r of rows) {
    const list = JSON.parse(r.tags) as string[]
    assert.equal(new Set(list).size, list.length)
  }
  db.close()
})

test('merge combines two tags and keeps every item', () => {
  const db = openDb()
  seed(db)
  mergeTags(db, 'ideas', 'work')
  assert.deepEqual(countOf(db, 'work'), { logbook: 2, trade: 1, goal: 0, task: 0, note: 1, content: 0 })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get() && (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n, 1)
  db.close()
})

test('merging a tag into itself is refused', () => {
  const db = openDb()
  seed(db)
  assert.throws(() => mergeTags(db, 'work', 'work'), /different tags/)
  db.close()
})

test('delete removes the tag from every item and never deletes the items', () => {
  const db = openDb()
  seed(db)
  const touched = deleteTag(db, 'work')
  assert.ok(touched >= 3)
  assert.equal(countOf(db, 'work'), undefined)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM logbook_entries').get() as { n: number }).n, 2)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trades').get() as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n, 1)
  const entry = db.prepare('SELECT tags FROM logbook_entries WHERE id = 1').get() as { tags: string }
  assert.deepEqual(JSON.parse(entry.tags), [])
  // Only `ideas` is left: every `work` tagging is gone.
  const remaining = db.prepare('SELECT t.name FROM taggings tg JOIN tags t ON t.id = tg.tag_id WHERE tg.deleted_at IS NULL').all() as { name: string }[]
  assert.deepEqual(remaining.map((r) => r.name), ['ideas'])
  db.close()
})

test('the tagged-items list is grouped by tool and only holds live items', () => {
  const db = openDb()
  seed(db)
  const items = listTaggedItems(db, 'work')
  assert.deepEqual(items.map((i) => i.type).sort(), ['logbook', 'logbook', 'note', 'trade'])
  db.prepare('UPDATE trades SET deleted_at = ? WHERE id = 1').run('2026-11-03T00:00:00.000Z')
  assert.equal(listTaggedItems(db, 'work').filter((i) => i.type === 'trade').length, 0)
  db.close()
})

test('deleting a tag that does not exist throws', () => {
  const db = openDb()
  assert.throws(() => deleteTag(db, 'ghost'), /not found/)
  db.close()
})

console.log(`\n${n} tag service checks passed`)
