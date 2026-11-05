// What a template's payload may contain, per kind (Phase 6, the manager UI).
//
// The engine (src/shared/templates.ts, src/main/templates.ts) only knows a
// kind, a name and a payload object; the SHAPE of the payload is decided by the
// kind. This file writes that shape down once: the manager uses it to show what
// a template sets up and to absorb a "Save as template" payload, and a test
// checks that the built-ins match it.
//
// Nothing here reads or writes the database. A field this file does not know is
// kept as it is when a template is saved (so a newer module's field is never
// silently dropped), it is only not listed in the summary.

import type { Template, TemplateKind } from './templates'

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  logbook: 'Journal entry',
  task: 'Task',
  note: 'Note',
  content: 'Content checklist',
  trade: 'Trade checklist'
}

// One line of the "what it sets up" summary.
export interface PayloadField {
  key: string
  label: string
}

export const TEMPLATE_PAYLOAD_FIELDS: Record<TemplateKind, PayloadField[]> = {
  logbook: [
    { key: 'title', label: 'Title' },
    { key: 'body', label: 'Body' },
    { key: 'mood', label: 'Mood' },
    { key: 'tags', label: 'Tags' }
  ],
  // Task templates carry the whole task: subtasks, default tags, priority and a
  // repeat rule are the point of a task template.
  task: [
    { key: 'title', label: 'Title' },
    { key: 'notes', label: 'Notes' },
    { key: 'priority', label: 'Priority' },
    { key: 'project', label: 'Project' },
    { key: 'tags', label: 'Tags' },
    { key: 'subtasks', label: 'Subtasks' },
    { key: 'recurrenceRule', label: 'Repeats' }
  ],
  note: [
    { key: 'title', label: 'Title' },
    { key: 'body', label: 'Body' }
  ],
  // A content template is a per-stage checklist ("Record: audio check, lighting,
  // backups"). `checklists` maps a stage to its lines.
  content: [
    { key: 'checklists', label: 'Checklists by stage' },
    { key: 'title', label: 'Title' },
    { key: 'hook', label: 'Hook' }
  ],
  // A trade template is a pre-trade and post-trade checklist, copied onto each
  // trade it starts. This tracks a process; it is not trading advice.
  trade: [
    { key: 'preTrade', label: 'Before the trade' },
    { key: 'postTrade', label: 'After the trade' },
    { key: 'notes', label: 'Notes' }
  ]
}

// Which payload fields this template actually sets, for the manager's summary.
export function filledFields(kind: TemplateKind, payload: unknown): PayloadField[] {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as Record<string, unknown>
  return TEMPLATE_PAYLOAD_FIELDS[kind].filter((f) => {
    const v = body[f.key]
    if (v === undefined || v === null || v === '') return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object') return Object.keys(v as object).length > 0
    return true
  })
}

// The checklist lines a trade template sets, as plain text, both lists.
export function tradeChecklists(payload: unknown): { preTrade: string[]; postTrade: string[] } {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const lines = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).filter((s) => s.trim() !== '') : []
  return { preTrade: lines(body.preTrade), postTrade: lines(body.postTrade) }
}

// One line of checklist text per line typed into the editor.
export const splitLines = (text: string): string[] =>
  text.split('\n').map((l) => l.trim()).filter((l) => l !== '')

export const joinLines = (lines: string[]): string => lines.join('\n')

// Groups a list of templates by kind, in TEMPLATE_KINDS order, so the manager's
// sections always come in the same order however the rows were returned.
export function groupTemplates(templates: Template[]): { kind: TemplateKind; items: Template[] }[] {
  const order: TemplateKind[] = ['logbook', 'task', 'note', 'content', 'trade']
  return order.map((kind) => ({ kind, items: templates.filter((t) => t.kind === kind) }))
}

// A short, human summary of what a template sets up: "Title, Body, Tags".
export function summaryOf(t: Template): string {
  const fields = filledFields(t.kind, t.payload).map((f) => f.label.toLowerCase())
  return fields.length === 0 ? 'Nothing set' : fields.join(', ')
}

// Whether this template can be removed. Built-ins cannot (they are reset
// instead), which is the same rule the engine enforces.
export const canRemoveTemplate = (t: Template): boolean => !t.isBuiltin
