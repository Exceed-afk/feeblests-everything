// Phase 2: built-in Notes templates are seeded once, stay valid JSON, and are
// not re-created after the user deletes them.
//   npm test
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { BUILTIN_TEMPLATES, seedBuiltinTemplates } from '../src/main/builtinTemplates'
import { listTemplates, removeTemplate } from '../src/main/templates'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('the built-ins seed with valid JSON payloads and are marked built-in', () => {
  const db = openDb()
  assert.equal(seedBuiltinTemplates(db), BUILTIN_TEMPLATES.length)
  // Note templates are body text; the other kinds start with Phase 6 (tasks,
  // content checklists, trade checklists) and have their own shape.
  const notes = listTemplates(db, 'note')
  const builtinNotes = BUILTIN_TEMPLATES.filter((t) => t.kind === 'note')
  assert.ok(notes.length >= builtinNotes.length)
  for (const t of notes.filter((x) => x.isBuiltin)) {
    assert.equal(typeof t.payload, 'object')
    assert.ok(t.payload !== null)
    const payload = t.payload as { title?: string; body?: string }
    assert.equal(typeof payload.body, 'string')
    assert.ok(!payload.body!.includes('\\n'), 'a literal backslash-n must not survive: real newlines only')
  }
  assert.equal(listTemplates(db).length, BUILTIN_TEMPLATES.length, 'one built-in per kind is seeded too')
  db.close()
})

test('the meeting note contains real line breaks and its variables', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  const meeting = listTemplates(db, 'note').find((t) => t.name === 'Meeting note')
  assert.ok(meeting)
  const payload = meeting!.payload as { title: string; body: string }
  assert.ok(payload.body.includes('\n'))
  assert.ok(payload.body.startsWith('## Attendees'))
  assert.ok(payload.title.includes('{{date}}'))
  assert.ok(payload.title.includes('{{weekday}}'))
  db.close()
})

test('seeding twice adds nothing', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  const before = listTemplates(db, 'note').length
  assert.equal(seedBuiltinTemplates(db), 0)
  assert.equal(listTemplates(db, 'note').length, before)
  db.close()
})

test('a built-in cannot be removed yet (the Phase 6 manager will allow it), so it never vanishes', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  const blank = listTemplates(db, 'note').find((t) => t.name === 'Blank checklist')!
  assert.throws(() => removeTemplate(db, blank.id), /built in/)
  assert.equal(seedBuiltinTemplates(db), 0)
  assert.ok(listTemplates(db, 'note').some((t) => t.name === 'Blank checklist'))
  db.close()
})

test('a user template with the same name is never duplicated by seeding', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  db.prepare(
    `INSERT INTO templates (kind, name, payload, is_builtin, created_at, updated_at)
     VALUES ('note', 'Blank checklist', '{}', 0, '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`
  ).run()
  assert.equal(seedBuiltinTemplates(db), 0)
  db.close()
})

test('"Restore built-ins" brings a deleted starter back, and one deleted afterwards stays gone', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  const blank = listTemplates(db).find((t) => t.name === 'Blank checklist')!
  // One starter deleted on its own before the restore.
  db.prepare('UPDATE templates SET deleted_at = ? WHERE id = ?').run('2026-11-01T10:00:00.000Z', blank.id)
  assert.equal(seedBuiltinTemplates(db), 0, 'a deleted built-in is not quietly re-created')
  assert.ok(!listTemplates(db).some((t) => t.id === blank.id))

  // The settings > Templates button: trash the live built-ins and stamp the moment.
  const resetAt = '2026-11-03T11:00:00.000Z'
  db.prepare('UPDATE templates SET deleted_at = ? WHERE is_builtin = 1 AND deleted_at IS NULL').run(resetAt)
  assert.equal(seedBuiltinTemplates(db, resetAt), BUILTIN_TEMPLATES.length, 'the restore brings the starters back')
  const back = listTemplates(db).find((t) => t.name === 'Blank checklist')
  assert.ok(back, 'the starter is back after a restore')
  assert.equal(back!.id, blank.id, 'the same row came back, not a copy')
  assert.equal(listTemplates(db).length, BUILTIN_TEMPLATES.length)

  // Deleted AFTER the restore: the user means it, so it stays gone.
  db.prepare('UPDATE templates SET deleted_at = ? WHERE id = ?').run('2026-11-04T09:00:00.000Z', back!.id)
  assert.equal(seedBuiltinTemplates(db, resetAt), 0)
  assert.ok(!listTemplates(db).some((t) => t.id === back!.id))
  db.close()
})

test('restoring built-ins never touches a user template', () => {
  const db = openDb()
  seedBuiltinTemplates(db)
  db.prepare(
    `INSERT INTO templates (kind, name, payload, is_builtin, created_at, updated_at)
     VALUES ('trade', 'Mine', '{"preTrade":["x"]}', 0, '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`
  ).run()
  const resetAt = '2026-11-03T11:00:00.000Z'
  db.prepare('UPDATE templates SET deleted_at = ? WHERE is_builtin = 1 AND deleted_at IS NULL').run(resetAt)
  assert.equal(seedBuiltinTemplates(db, resetAt), BUILTIN_TEMPLATES.length)
  const mine = listTemplates(db).filter((t) => t.name === 'Mine')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].isBuiltin, false)
  db.close()
})

console.log(`\n${n} builtin template checks passed`)
