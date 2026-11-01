import assert from 'node:assert/strict'
import { createEntry, listEntries, logbookSummary } from '../src/main/logbook'
import { onLogbookEntryCreated } from '../src/main/events'
import { createTrade, updateTrade } from '../src/main/trades'
import { isAutomationEntry } from '../src/shared/automations'
import { prevDay } from '../src/shared/dashboard'
import { localDate } from '../src/main/util'
import { applyMigrations } from '../src/main/migrations'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('automation drafts stay visible but do not count as writing or extend a streak', () => {
  const db = openDatabase()
  applyMigrations(db)
  try {
    const today = localDate()
    createEntry(db, {
      date: prevDay(today), title: 'What I wrote', body: 'A real note', mood: null, tags: []
    })
    db.prepare("INSERT INTO settings (key, value) VALUES ('automations', ?)").run(
      JSON.stringify({ lossReflection: true, lossThreshold: 50 })
    )
    const trade = createTrade(db, {
      date: today, asset: 'XAUUSD', direction: 'long', entryPrice: 100,
      exitPrice: null, quantity: 1, fees: 0, notes: '', tags: []
    })
    updateTrade(db, trade.id, {
      date: today, asset: trade.asset, direction: trade.direction, entryPrice: trade.entryPrice,
      exitPrice: 40, quantity: trade.quantity, fees: trade.fees, notes: trade.notes, tags: trade.tags
    })

    const summary = logbookSummary(db, today)
    assert.deepEqual(
      { total: summary.total, thisMonth: summary.thisMonth, streak: summary.streak },
      { total: 1, thisMonth: prevDay(today).slice(0, 7) === today.slice(0, 7) ? 1 : 0, streak: 1 }
    )
    const entries = listEntries(db)
    assert.equal(entries.length, 2)
    assert.equal(isAutomationEntry(entries[0]), true)
    assert.deepEqual(entries[0].tags, ['automation', 'loss'])
  } finally {
    db.close()
  }
})

test('a similarly named user tag is not mistaken for the automation tag', () => {
  const db = openDatabase()
  applyMigrations(db)
  const announced: string[] = []
  onLogbookEntryCreated((_db, event) => announced.push(event.date))
  try {
    const entry = createEntry(db, {
      date: '2026-10-25', title: 'Marketing automation notes', body: '', mood: null,
      tags: ['#marketing-automation']
    })
    assert.deepEqual(entry.tags, ['marketing-automation'])
    assert.equal(isAutomationEntry(entry), false)
    assert.deepEqual(announced, ['2026-10-25'])
  } finally {
    db.close()
  }
})

console.log(`\n${n} logbook summary checks passed`)
