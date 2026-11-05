// Built-in starter templates (Phase 2/3, extended in Phase 6).
//
// These are DATA, not schema, so they are written here with real objects and
// `JSON.stringify` rather than typed into a migration's SQL string (a newline
// inside a SQL literal is not an escaped newline, which silently produced
// invalid JSON).
//
// Seeding is idempotent and never overwrites a user's edit: a built-in is only
// inserted when no row with that (kind, name) exists at all, live or trashed.
// Deleting one keeps it deleted - it is not re-created on the next launch.
// settings."templatesResetAt" changes that: Settings > Templates > "Restore
// built-ins" trashes the built-ins and records the time, and seeding then
// re-creates only the built-ins that were trashed BEFORE that moment. So the
// restore brings the starters back, and a built-in you delete afterwards
// stays deleted.
import type Database from 'better-sqlite3'
import { nowIso } from './repo'
import type { TemplateKind } from '../shared/templates'

export interface BuiltinTemplate { kind: TemplateKind; name: string; payload: Record<string, unknown> }

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    kind: 'note',
    name: 'Meeting note',
    payload: {
      title: 'Meeting with {{weekday}} {{date}}',
      body: [
        '## Attendees', '', '- ', '',
        '## Agenda', '', '- [ ] ', '',
        '## Notes', '', '',
        '## Decisions', '', '',
        '## Actions', '', '- [ ] '
      ].join('\n')
    }
  },
  {
    kind: 'note',
    name: 'Blank checklist',
    payload: { title: '', body: '- [ ] ' }
  },
  // ---- Phase 6: the other kinds ----
  {
    kind: 'logbook',
    name: 'Morning pages',
    payload: {
      title: '{{weekday}} {{date}}',
      body: [
        '## How I woke up', '', '',
        '## One thing for today', '', '',
        '## Gratitude', '', '- '
      ].join('\n'),
      mood: 'okay',
      tags: []
    }
  },
  {
    kind: 'logbook',
    name: 'Evening review',
    payload: {
      title: 'Evening review, {{date}}',
      body: [
        '## What went well', '', '- ',
        '', '## What I would do differently', '', '- ',
        '', '## Tomorrow', '', '- '
      ].join('\n'),
      tags: ['review']
    }
  },
  {
    kind: 'task',
    name: 'Deep work block',
    payload: {
      title: 'Deep work: {{weekday}}',
      notes: 'One clear outcome. Phone away, timer on.',
      priority: 'high',
      tags: ['focus'],
      subtasks: ['Turn on Focus for 25 minutes', 'Write down the one outcome', 'Close everything else'],
      recurrenceRule: { frequency: 'daily', intervalDays: 1 }
    }
  },
  {
    kind: 'task',
    name: 'Weekly review',
    payload: {
      title: 'Weekly review, week of {{date}}',
      priority: 'medium',
      tags: ['review', 'weekly'],
      subtasks: ['Close open tasks that no longer matter', 'Check savings and trades', 'Plan next week'],
      recurrenceRule: { frequency: 'weekly', intervalDays: 7 }
    }
  },
  {
    kind: 'content',
    name: 'Video: full checklist',
    payload: {
      checklists: {
        idea: ['Capture the idea in one sentence', 'Note who it is for and why it matters'],
        script: ['Hook in the first two lines', 'One outcome the viewer can use'],
        record: ['Audio check', 'Lighting check', 'Backup the raw files'],
        edit: ['Cut the dead air', 'Captions', 'Thumbnail'],
        publish: ['Title', 'Description', 'Tags', 'Schedule']
      }
    }
  },
  {
    kind: 'trade',
    name: 'Pre-trade and post-trade',
    payload: {
      preTrade: [
        'Setup matches my plan',
        'Risk on this trade is written down',
        'No trade out of boredom or revenge',
        'Screenshot of the setup taken'
      ],
      postTrade: [
        'Followed the plan, whichever way it went',
        'Stop and target respected',
        'One line on what I learned',
        'Journal entry written'
      ]
    }
  }
]

// Inserts the built-ins this app version offers that are missing. A built-in
// that was trashed on or before `resetAt` counts as missing (that is a
// "Restore built-ins"); one trashed after it stays deleted. Returns how many
// rows were created or brought back.
export function seedBuiltinTemplates(db: Database.Database, resetAt: string | null = null): number {
  let added = 0
  db.transaction(() => {
    const find = db.prepare('SELECT id, deleted_at FROM templates WHERE kind = ? AND name = ? ORDER BY id')
    const insert = db.prepare(
      `INSERT INTO templates (kind, name, payload, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    const revive = db.prepare('UPDATE templates SET deleted_at = NULL, updated_at = ? WHERE id = ?')
    // ISO-8601 UTC timestamps compare correctly as text. Both sides are put in
    // the same shape, so a same-millisecond trash and restore still counts.
    const at = (iso: string | null): string => (iso ?? '').replace(/[zZ]$/, '')
    const reset = resetAt === null ? null : at(resetAt)
    for (const t of BUILTIN_TEMPLATES) {
      const rows = find.all(t.kind, t.name) as { id: number; deleted_at: string | null }[]
      if (rows.some((r) => r.deleted_at === null)) continue // already there
      const now = nowIso()
      const goneEarly = reset !== null && rows.length > 0 && rows.every((r) => r.deleted_at !== null && at(r.deleted_at) <= reset)
      if (goneEarly) {
        for (const r of rows) revive.run(now, r.id)
        added++
        continue
      }
      if (rows.length > 0) continue // trashed after the last restore: the user means it
      insert.run(t.kind, t.name, JSON.stringify(t.payload), now, now)
      added++
    }
  })()
  return added
}
