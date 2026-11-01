// Automation glue for the main process: receives events from the tools' own
// query code (src/main/trades.ts etc.), runs the pure engine
// (src/shared/automations.ts) and carries out the actions it returns. This file
// is deliberately the ONLY one that writes automation-made rows; the rules
// themselves stay pure and testable.
//
// Safety contract (see shared/automations.ts):
//  - automations only CREATE drafts or SHOW messages — this file never runs an
//    UPDATE or DELETE on user data because of an automation;
//  - every automation-made entry is tagged #automation and tagged in the body,
//    so the user can see it came from an automation and delete it like any entry;
//  - the automation_events table is the Activity list, unique per (rule, event_key),
//    so the same trigger never fires twice — that is the loop-prevention backstop.
import type Database from 'better-sqlite3'
import {
  DEFAULT_AUTOMATIONS, AUTOMATION_TAG, guardAction, runAutomation,
  type AutomationAction, type AutomationEvent, type AutomationEventKind, type AutomationSettings
} from '../shared/automations'
import { getSettings, setSetting } from './db'
import { getDb } from './db'

// Reads settings from ANY database handle (the app's global one, or a test's in-memory one),
// so emitAutomation works before the app's global handle exists.
function getSettingsFrom(handle: Database.Database): ReturnType<typeof getSettings> {
  const rows = handle.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as ReturnType<typeof getSettings>
}

interface Row { id: number; rule: string; event: string; event_key: string; label: string; entry_id: number | null; created_at: string }

const toActivity = (r: Row) => ({
  id: r.id, rule: r.rule, label: r.label, event: r.event, eventKey: r.event_key,
  entryId: r.entry_id, at: r.created_at
})

// ---------- settings ----------

export function automationSettings(handle?: Database.Database): AutomationSettings {
  const saved = (handle ? getSettingsFrom(handle) : getSettings()) as ReturnType<typeof getSettings> & { automations?: Partial<AutomationSettings> }
  const a = saved.automations
  return { ...DEFAULT_AUTOMATIONS, ...a }
}

export function setAutomationSettings(patch: Partial<AutomationSettings>): AutomationSettings {
  const next = { ...automationSettings(), ...patch }
  setSetting('automations', next)
  return next
}

// ---------- events in ----------

interface EmitResult { fired: { rule: string; label: string; entryId: number | null }[] }

// Emits one event. Returns what actually happened, so the caller can tell the UI.
// `overdueTasks` is the caller's cheap scan result for the stale-tasks rule (it
// needs list state, not event data, so the engine takes it as run context).
function emitAutomationUnsafe(
  db: Database.Database,
  event: AutomationEventKind,
  key: string, // "trade:12", "goal:3:first-reach": one event, once per rule, ever
  data: Parameters<typeof runAutomation>[0]['data'] extends never ? never : import('../shared/automations').AutomationEventData,
  extra: { overdueTasks?: { id: number; title: string; daysOverdue: number }[]; date?: string } = {}
): EmitResult {
  const settings = automationSettings(db)
  const today = extra.date ?? new Date().toISOString().slice(0, 10)
  const outcomes = runAutomation({ kind: event, date: today, data }, {
    settings,
    overdueTasks: extra.overdueTasks
  })
  if (outcomes.length === 0) return { fired: [] }

  const insert = db.prepare(
    `INSERT INTO automation_events (rule, event, event_key, label, entry_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const fired: EmitResult['fired'] = []
  for (const outcome of outcomes) {
    for (let i = 0; i < outcome.actions.length; i++) {
      const action = guardAction(outcome.actions[i]) // refuse anything but create/message
      if (!action) continue
      const label = outcome.labels[i]
      const dedupKey = `${outcome.ruleId}:${key}`
      const existing = db.prepare('SELECT id, entry_id FROM automation_events WHERE rule = ? AND event_key = ?')
        .get(outcome.ruleId, dedupKey) as { id: number; entry_id: number | null } | undefined
      if (existing) continue // this rule already answered this exact trigger: loop closed

      let entryId: number | null = null
      if (action.type === 'create-draft-entry') entryId = createAutomationEntry(db, action)

      const at = new Date().toISOString()
      const info = insert.run(outcome.ruleId, event, dedupKey, label, entryId, at)
      fired.push({ rule: outcome.ruleId, label, entryId })
      void info
    }
  }
  return { fired }
}

export function emitAutomation(...args: Parameters<typeof emitAutomationUnsafe>): EmitResult {
  try {
    return emitAutomationUnsafe(...args)
  } catch (error) {
    console.error('[automations] failed and was skipped:', args[1], args[2], error)
    return { fired: [] }
  }
}

// ---------- actions out ----------

// An automation-made entry: tagged #automation AND its first line says so, so it is
// obvious in the Logbook exactly where it came from. Deleting it in the Logbook
// deletes it like any other entry — automations never re-create the same one (the
// dedup row above stays, and the entry id recorded there goes stale, which is fine).
function createAutomationEntry(db: Database.Database, action: Extract<AutomationAction, { type: 'create-draft-entry' }>): number {
  const now = new Date().toISOString()
  const today = new Date().toISOString().slice(0, 10)
  const tags = JSON.stringify([...new Set([...action.tags, AUTOMATION_TAG])])
  const body = `Created by an automation — safe to delete.\n\n${action.body}`
  const info = db.prepare(
    `INSERT INTO logbook_entries (date, title, body, mood, tags, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`
  ).run(today, action.title, body, tags, now, now)
  return Number(info.lastInsertRowid)
}

// ---------- the Activity list ----------

// What each automation did and when, newest first. `limit` keeps the page quick;
// the Settings page offers "show all".
export function automationActivity(db: Database.Database, limit = 50): ReturnType<typeof toActivity>[] {
  const rows = limit > 0
    ? (db.prepare('SELECT * FROM automation_events ORDER BY id DESC LIMIT ?').all(limit) as Row[])
    : (db.prepare('SELECT * FROM automation_events ORDER BY id DESC').all() as Row[])
  return rows.map(toActivity)
}

export function deleteAutomationActivity(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM automation_events WHERE id = ?').run(id)
}

// Clear the whole Activity list (does NOT touch any entry an automation created).
export function clearAutomationActivity(db: Database.Database): void {
  db.prepare('DELETE FROM automation_events').run()
}

// Convenience for tool code: the db handle + emit, so a module can fire an event in one line.
export const emitOn = (db: Database.Database) =>
  (event: AutomationEventKind, key: string, data: import('../shared/automations').AutomationEventData, extra?: { overdueTasks?: { id: number; title: string; daysOverdue: number }[] }) =>
    emitAutomation(db, event, key, data, extra)

export { getDb }
