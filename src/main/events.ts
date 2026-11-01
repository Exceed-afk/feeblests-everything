// A tiny event bus, so main-process modules can react to each other without
// importing each other. The Logbook emits "an entry was created"; the habits
// module listens. Neither module knows anything about the other, so the
// features stay separate (see the Phase 6 brief: "decoupled").
//
// The `db` rides along with the event. The handler works on whatever
// database it is given, which keeps this simple to test: a test can pass its
// own in-memory database to the emitter and check what happened to it.
import type Database from 'better-sqlite3'

// What the Logbook says when the user writes a new entry.
export interface LogbookEntryCreated {
  date: string // the entry's date, "YYYY-MM-DD"
}

type LogbookHandler = (db: Database.Database, event: LogbookEntryCreated) => void

const logbookHandlers = new Set<LogbookHandler>()

// Subscribes to new Logbook entries. Call this once, e.g. when the habits
// module is loaded.
export function onLogbookEntryCreated(handler: LogbookHandler): void {
  logbookHandlers.add(handler)
}

// Announces a new Logbook entry to whoever is listening. One broken listener
// must never break saving the entry, so each handler is wrapped in try/catch.
export function emitLogbookEntryCreated(db: Database.Database, event: LogbookEntryCreated): void {
  for (const handler of [...logbookHandlers]) {
    try {
      handler(db, event)
    } catch (error) {
      // A listener failing (a habit that could not be marked done, say) must
      // not stop the user's entry from being saved.
      console.error('A logbook-event listener failed:', error)
    }
  }
}
