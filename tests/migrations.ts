import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'

const db = openDatabase()
for (let i = 0; i < 5; i++) db.exec(MIGRATIONS[i])
db.pragma('user_version = 5')
db.prepare("INSERT INTO settings (key, value) VALUES ('kept', 'yes')").run()
db.prepare("INSERT INTO logbook_entries (date, title, created_at, updated_at) VALUES ('2026-10-26', 'preserved', 'now', 'now')").run()

applyMigrations(db)
// The schema version is the number of migrations, so it grows when we add one.
assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length)
assert.equal((db.prepare("SELECT title FROM logbook_entries").get() as { title: string }).title, 'preserved')
assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'kept'").get() as { value: string }).value, 'yes')
assert.deepEqual((db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((column) => column.name), [
  'id', 'title', 'notes', 'status', 'priority', 'due_date', 'created_at', 'completed_at', 'project', 'tags',
  'due_time', 'deleted_at', 'position', 'recurrence_rule', 'recurrence_next'
])
db.prepare("INSERT INTO tasks (title, created_at) VALUES ('parent', 'now')").run()
db.prepare("INSERT INTO task_subtasks (task_id, title) VALUES (1, 'child')").run()
db.prepare('DELETE FROM tasks WHERE id = 1').run()
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM task_subtasks').get() as { n: number }).n, 0)
applyMigrations(db)
assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length)
db.close()

// Migration 7: at most one recurring child per task row, ever. A pre-rule database that
// somehow holds two children under one parent keeps the oldest link, unlinks the extras
// (nothing is deleted), and the unique index then refuses any second child at the schema level.
const db7 = openDatabase()
for (let i = 0; i < 6; i++) db7.exec(MIGRATIONS[i])
db7.pragma('user_version = 6')
db7.exec("INSERT INTO tasks (title, created_at) VALUES ('parent', 'now')")
db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('oldest child', 'now', 1)")
db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('extra child', 'now', 1)")
db7.exec(MIGRATIONS[6])
db7.pragma('user_version = 7')
assert.equal(db7.pragma('user_version', { simple: true }), 7)
assert.deepEqual(
  (db7.prepare('SELECT id, parent_task_id AS p FROM tasks ORDER BY id').all() as { id: number; p: number | null }[]),
  [{ id: 1, p: null }, { id: 2, p: 1 }, { id: 3, p: null }]
)
assert.throws(() => db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('again', 'now', 1)"))
db7.close()

// Migration 14 preserves currently completed tasks already in a version-13 database.
const db13 = openDatabase()
for (let i = 0; i < 13; i++) db13.exec(MIGRATIONS[i])
db13.pragma('user_version = 13')
db13.prepare(`INSERT INTO tasks
  (title, status, created_at, completed_at, tags, position)
  VALUES ('Previously completed', 'done', ?, ?, '[]', 0)`)
  .run('2026-10-26T10:00:00.000Z', '2026-10-26T11:00:00.000Z')
applyMigrations(db13)
assert.deepEqual(
  db13.prepare('SELECT task_id AS taskId, completed_at AS completedAt FROM task_completions').all(),
  [{ taskId: 1, completedAt: '2026-10-26T11:00:00.000Z' }]
)
db13.close()

// Migration 15 adds the hidden flag without hiding or removing existing activity.
const db14 = openDatabase()
for (let i = 0; i < 14; i++) db14.exec(MIGRATIONS[i])
db14.pragma('user_version = 14')
db14.prepare(`INSERT INTO automation_events (rule, event, event_key, label, entry_id, created_at)
  VALUES ('loss-reflection', 'trade-closed', 'loss-reflection:trade:1', 'A draft', 1, 'now')`).run()
applyMigrations(db14)
assert.equal(db14.pragma('user_version', { simple: true }), MIGRATIONS.length)
assert.deepEqual(
  db14.prepare('SELECT rule, event_key, hidden FROM automation_events').all(),
  [{ rule: 'loss-reflection', event_key: 'loss-reflection:trade:1', hidden: 0 }]
)
db14.close()

console.log('schema migration checks passed')
