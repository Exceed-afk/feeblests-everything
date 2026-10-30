import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { MIGRATIONS, applyMigrations } from '../src/main/migrations'

const db = new Database(':memory:')
for (let i = 0; i < 5; i++) db.exec(MIGRATIONS[i])
db.pragma('user_version = 5')
db.prepare("INSERT INTO settings (key, value) VALUES ('kept', 'yes')").run()
db.prepare("INSERT INTO logbook_entries (date, title, created_at, updated_at) VALUES ('2026-10-26', 'preserved', 'now', 'now')").run()

applyMigrations(db)
assert.equal(db.pragma('user_version', { simple: true }), 7)
assert.equal((db.prepare("SELECT title FROM logbook_entries").get() as { title: string }).title, 'preserved')
assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'kept'").get() as { value: string }).value, 'yes')
assert.deepEqual((db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((column) => column.name), [
  'id', 'title', 'notes', 'status', 'priority', 'due_date', 'created_at', 'completed_at', 'project', 'tags', 'sort_order', 'recurrence', 'parent_task_id'
])
db.prepare("INSERT INTO tasks (title, created_at) VALUES ('parent', 'now')").run()
db.prepare("INSERT INTO task_subtasks (task_id, title) VALUES (1, 'child')").run()
db.prepare('DELETE FROM tasks WHERE id = 1').run()
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM task_subtasks').get() as { n: number }).n, 0)
applyMigrations(db)
assert.equal(db.pragma('user_version', { simple: true }), 7)
db.close()

// Migration 7: at most one recurring child per task row, ever. A pre-rule database that
// somehow holds two children under one parent keeps the oldest link, unlinks the extras
// (nothing is deleted), and the unique index then refuses any second child at the schema level.
const db7 = new Database(':memory:')
for (let i = 0; i < 6; i++) db7.exec(MIGRATIONS[i])
db7.pragma('user_version = 6')
db7.exec("INSERT INTO tasks (title, created_at) VALUES ('parent', 'now')")
db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('oldest child', 'now', 1)")
db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('extra child', 'now', 1)")
applyMigrations(db7)
assert.equal(db7.pragma('user_version', { simple: true }), 7)
assert.deepEqual(
  (db7.prepare('SELECT id, parent_task_id AS p FROM tasks ORDER BY id').all() as { id: number; p: number | null }[]),
  [{ id: 1, p: null }, { id: 2, p: 1 }, { id: 3, p: null }]
)
assert.throws(() => db7.exec("INSERT INTO tasks (title, created_at, parent_task_id) VALUES ('again', 'now', 1)"))
applyMigrations(db7)
assert.equal(db7.pragma('user_version', { simple: true }), 7)
db7.close()
console.log('task schema migration checks passed')
