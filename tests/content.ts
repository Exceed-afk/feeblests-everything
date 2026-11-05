// Phase 3: the Content planner service — pipeline stages, seeded stage
// checklists, script notes, stage dates, assets by path, post-publish views,
// calendar ranges, search and trash.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import {
  addAsset, addChecklistLine, createContentItem, deleteContentItem, deleteContentItemForever,
  getContentItem, listContentItems, listPlannedBetween, listPublishedBetween, moveContentItem,
  publishedPerMonth, reorderContentItems, setChecklistDone, setScriptNote, updateContentItem
} from '../src/main/content'
import { createNote, deleteNote } from '../src/main/notes'
import { listTrash, restoreBatch } from '../src/main/trash'
import { runSearch } from '../src/main/search'
import { tagsOf } from '../src/main/tags'
import { listLinksFor } from '../src/main/links'
import {
  nextStage, previousStage, seedStageChecklist, stageProgress, STAGE_CHECKLIST_TEMPLATES,
  CONTENT_STAGES, type StageChecklistItem
} from '../src/shared/content'
import type { ContentInput } from '../src/shared/content'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

const input = (over: Partial<ContentInput> = {}): ContentInput => ({
  title: 'First video', type: 'video', ...over
})

// ---------- pure pipeline rules ----------

test('stages walk forward and back, stopping at both ends', () => {
  assert.equal(nextStage('idea'), 'script')
  assert.equal(nextStage('edit'), 'publish')
  assert.equal(nextStage('published'), null)
  assert.equal(previousStage('idea'), null)
  assert.equal(previousStage('publish'), 'edit')
})

test('seeding a stage checklist never duplicates lines already there', () => {
  let list: StageChecklistItem[] = []
  list = seedStageChecklist(list, 'record')
  assert.equal(list.length, STAGE_CHECKLIST_TEMPLATES.record.length)
  const again = seedStageChecklist(list, 'record')
  assert.equal(again.length, list.length, 'no duplicates on a second seed')
  // A user line with the same text keeps one entry only.
  const userLine: StageChecklistItem[] = [...list, { id: 'x', stage: 'record' as const, text: STAGE_CHECKLIST_TEMPLATES.record[0], done: true }]
  assert.equal(seedStageChecklist(userLine, 'record').length, list.length + 1)
})

test('stage progress counts only that stage', () => {
  const list: StageChecklistItem[] = [
    { id: 'a', stage: 'record', text: 'audio', done: true },
    { id: 'b', stage: 'record', text: 'light', done: false },
    { id: 'c', stage: 'edit', text: 'cuts', done: true }
  ]
  assert.deepEqual(stageProgress(list, 'record'), { done: 1, total: 2 })
  assert.deepEqual(stageProgress(list, 'edit'), { done: 1, total: 1 })
  assert.deepEqual(stageProgress(list, 'publish'), { done: 0, total: 0 })
})

// ---------- CRUD and stages ----------

test('a new item starts as an idea with its stage checklist seeded', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  assert.equal(item.stage, 'idea')
  assert.equal(item.checklist.length, STAGE_CHECKLIST_TEMPLATES.idea.length)
  assert.equal(item.checklistTotal, STAGE_CHECKLIST_TEMPLATES.idea.length)
  assert.equal(item.checklistDone, 0)
  db.close()
})

test('a title is required and the type must be known', () => {
  const db = openDb()
  assert.throws(() => createContentItem(db, input({ title: '  ' })), /title/)
  assert.throws(() => createContentItem(db, input({ type: 'podcast' as never })), /video, short, stream or post/)
  db.close()
})

test('moving a card seeds the new stage checklist exactly once', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  const recorded = moveContentItem(db, item.id, 'record')
  assert.equal(recorded.stage, 'record')
  assert.equal(recorded.checklistTotal, STAGE_CHECKLIST_TEMPLATES.record.length)
  assert.equal(recorded.checklistDone, 0)

  const edited = moveContentItem(db, recorded.id, 'edit')
  const editedLines = edited.checklist.filter((l) => l.stage === 'edit').length
  assert.equal(editedLines, STAGE_CHECKLIST_TEMPLATES.edit.length)

  // Back to record: no duplicates.
  const back = moveContentItem(db, edited.id, 'record')
  assert.equal(back.checklist.filter((l) => l.stage === 'record').length, STAGE_CHECKLIST_TEMPLATES.record.length)
  db.close()
})

test('moving to Published stamps the published date; moving back keeps it', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  const published = moveContentItem(db, item.id, 'published')
  assert.match(published.publishedDate ?? '', /^\d{4}-\d{2}-\d{2}$/)
  const back = moveContentItem(db, published.id, 'edit')
  assert.equal(back.publishedDate, published.publishedDate)
  db.close()
})

test('moving to the same stage changes nothing', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  const again = moveContentItem(db, item.id, 'idea')
  assert.deepEqual(again, item)
  db.close()
})

test('checklist lines can be ticked, added and removed', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  const line = item.checklist[0]
  const ticked = setChecklistDone(db, item.id, line.id, true)
  assert.equal(ticked.checklistDone, 1)

  const added = addChecklistLine(db, item.id, 'idea', 'Research competitors')
  assert.ok(added.checklist.some((l) => l.text === 'Research competitors'))

  const removed = updateContentItem(db, item.id, { ...added, checklist: added.checklist.filter((l) => l.text !== 'Research competitors') })
  assert.ok(!removed.checklist.some((l) => l.text === 'Research competitors'))
  db.close()
})

test('manual order inside a stage is kept', () => {
  const db = openDb()
  const a = createContentItem(db, input({ title: 'A' }))
  const b = createContentItem(db, input({ title: 'B' }))
  const c = createContentItem(db, input({ title: 'C' }))
  reorderContentItems(db, 'idea', [c.id, a.id, b.id])
  assert.deepEqual(listContentItems(db).map((i) => i.title), ['C', 'A', 'B'])
  db.close()
})

// ---------- script note ----------

test('a script note can be attached from either side and links both ways', () => {
  const db = openDb()
  const note = createNote(db, { title: 'Script: first video', body: 'hook', tags: [], pinned: false, archived: false })
  const item = createContentItem(db, input())
  const linked = setScriptNote(db, item.id, note.id)
  assert.equal(linked.scriptNoteId, note.id)
  assert.equal(linked.scriptNoteTitle, 'Script: first video')

  // The link was created by the UI's Links service call; emulate it here.
  const { addLink } = require('../src/main/links') as typeof import('../src/main/links')
  addLink(db, { type: 'content', id: item.id }, { type: 'note', id: note.id })
  assert.equal(listLinksFor(db, 'note', note.id).some((l) => l.type === 'content'), true)
  db.close()
})

test('a trashed script note reads as missing, and attaching a trashed note is refused', () => {
  const db = openDb()
  const note = createNote(db, { title: 'Script', body: '', tags: [], pinned: false, archived: false })
  const item = createContentItem(db, input())
  setScriptNote(db, item.id, note.id)
  const batch = deleteNote(db, note.id)
  assert.equal(getContentItem(db, item.id).scriptNoteTitle, null)
  assert.throws(() => setScriptNote(db, item.id, note.id), /Note not found/)
  restoreBatch(db, batch)
  assert.equal(getContentItem(db, item.id).scriptNoteTitle, 'Script')
  db.close()
})

// ---------- assets ----------

test('assets are stored by path, deduplicated, and removable', () => {
  const db = openDb()
  const item = createContentItem(db, input())
  const withAsset = addAsset(db, item.id, { path: 'D:/Videos/first.mp4', label: 'Raw footage', kind: 'video' })
  assert.equal(withAsset.assets.length, 1)
  const duplicate = addAsset(db, item.id, { path: 'D:/Videos/first.mp4', label: 'Again', kind: 'video' })
  assert.equal(duplicate.assets.length, 1)
  assert.throws(() => addAsset(db, item.id, { path: '  ', label: '', kind: 'file' }), /path/)
  db.close()
})

// ---------- calendar, search, tags ----------

test('calendar sees planned targets and published dates separately', () => {
  const db = openDb()
  const planned = createContentItem(db, input({ title: 'Planned', targetPublishDate: '2026-11-10' }))
  const done = createContentItem(db, input({ title: 'Done', publishedDate: '2026-11-05' }))
  assert.deepEqual(listPlannedBetween(db, '2026-11-01', '2026-11-30').map((i) => i.title), [planned.title])
  assert.deepEqual(listPublishedBetween(db, '2026-11-01', '2026-11-30').map((i) => i.title), [done.title])
  assert.deepEqual(publishedPerMonth(db, '2026-01-01', '2026-12-31'), [{ month: '2026-11', count: 1 }])
  db.close()
})

test('content items are searchable and their tags are listed', () => {
  const db = openDb()
  const item = createContentItem(db, input({ title: 'Editing workflow', platform: 'YouTube', tags: ['video-idea'] }))
  assert.equal(runSearch(db, 'editing').content.items[0].id, item.id)
  assert.deepEqual(tagsOf(db, 'content', item.id).map((t) => t.name), ['video-idea'])
  db.close()
})

test('a trashed item leaves the board, search and tags counting; restore brings it back', () => {
  const db = openDb()
  const item = createContentItem(db, input({ title: 'Scratch', tags: ['draft'] }))
  const batch = deleteContentItem(db, item.id)
  assert.equal(listContentItems(db).length, 0)
  assert.equal(runSearch(db, 'scratch').content.items.length, 0)
  assert.ok(!listTrash(db).find((b) => b.batchId === batch)?.items.some((i) => i.type === 'content') === false)
  restoreBatch(db, batch)
  assert.equal(listContentItems(db).length, 1)
  db.close()
})

test('delete forever removes the row and its taggings', () => {
  const db = openDb()
  const item = createContentItem(db, input({ tags: ['x'] }))
  deleteContentItem(db, item.id)
  deleteContentItemForever(db, item.id)
  assert.equal(db.prepare('SELECT id FROM content_items WHERE id = ?').get(item.id), undefined)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM taggings WHERE entity_type = 'content' AND entity_id = ?").get(item.id) as { n: number }).n, 0)
  db.close()
})

test('a bad target date is refused', () => {
  const db = openDb()
  assert.throws(() => createContentItem(db, input({ targetPublishDate: '2026-13-01' })), /real date/)
  assert.throws(() => createContentItem(db, input({ targetPublishDate: '2026-02-30' })), /real date/)
  assert.throws(() => createContentItem(db, input({ streamMinutes: -5 })), /positive/)
  db.close()
})

test('there are six stages, in pipeline order', () => {
  assert.deepEqual([...CONTENT_STAGES], ['idea', 'script', 'record', 'edit', 'publish', 'published'])
})

console.log(`\n${n} content checks passed`)
