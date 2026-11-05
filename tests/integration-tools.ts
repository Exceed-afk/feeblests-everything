// Integration tests for Tools (Phase 6):
// Search (scratchpad), Dashboard (pinned-tools widget), Quick capture (append to scratchpad).
import assert from 'node:assert/strict'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { createScratchpad } from '../src/main/tools'
import { runSearch } from '../src/main/search'
import { findWidget, WIDGETS } from '../src/renderer/src/widgets'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const openDb = () => {
  const db = openDatabase()
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

test('Tools in Search: scratchpads are indexed and searchable via FTS5', () => {
  const db = openDb()
  const pad = createScratchpad(db, {
    name: 'Docker cheatsheet',
    content: 'docker compose up -d --build and docker ps -a'
  })

  const res = runSearch(db, 'cheatsheet')
  assert.ok(res.scratchpads.items.length >= 1)
  assert.equal(res.scratchpads.items[0].name, 'Docker cheatsheet')
  assert.ok(res.scratchpads.items[0].content.includes('docker compose'))
  db.close()
})

test('Tools in Dashboard: pinned-tools widget is registered and valid', () => {
  const widget = findWidget('pinned-tools')
  assert.ok(widget, 'pinned-tools widget exists in widget registry')
  assert.equal(widget.title, 'Pinned tools')
  assert.equal(widget.module, 'tools')
  assert.ok(widget.sizes.includes('m'))
})

console.log(`\n${n} tools integration checks passed`)
