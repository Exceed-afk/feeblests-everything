// Phase 6: the Templates manager's rules (src/shared/templateManager.ts) and
// the link between the dashboard presets and the widget registry.
//   npm test
import assert from 'node:assert/strict'
import { WIDGETS } from '../src/renderer/src/widgets'
import { DEFAULT_LAYOUT, LAYOUT_PRESETS } from '../src/shared/dashboardLayout'
import { BUILTIN_TEMPLATES } from '../src/main/builtinTemplates'
import { TEMPLATE_KINDS, renderTemplate, templateVars, type Template } from '../src/shared/templates'
import {
  TEMPLATE_KIND_LABELS, TEMPLATE_PAYLOAD_FIELDS, canRemoveTemplate, filledFields, groupTemplates, joinLines,
  splitLines, summaryOf, tradeChecklists
} from '../src/shared/templateManager'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// ---- the widget registry <-> the presets ----
const registryIds = new Set(WIDGETS.map((w) => w.id))
test('every widget in the default layout and every preset is a registered widget', () => {
  for (const [name, layout] of Object.entries(LAYOUT_PRESETS)) {
    for (const w of layout) assert.ok(registryIds.has(w.id), `${name} names "${w.id}", which is not a widget`)
  }
  for (const w of DEFAULT_LAYOUT) assert.ok(registryIds.has(w.id), `default names "${w.id}"`)
})
test('every widget offers at least one size, and its id, title and component are real', () => {
  for (const w of WIDGETS) {
    assert.match(w.id, /^[a-z][a-z0-9-]*$/, w.id)
    assert.ok(w.title.trim(), `${w.id}: title`)
    assert.ok(w.sizes.length > 0, `${w.id}: sizes`)
    assert.ok(w.sizes.every((s) => ['s', 'm', 'l'].includes(s)), `${w.id}: known sizes`)
    assert.equal(typeof w.component, 'object', `${w.id}: a lazy component`) // React.lazy returns an object
  }
  assert.equal(new Set(WIDGETS.map((w) => w.id)).size, WIDGETS.length, 'widget ids are unique')
})
test('every widget that belongs to a module names a real tool id', () => {
  // Tool ids from the registry (read lazily to keep this file free of React pages).
  const toolIds = new Set(['savings', 'trades', 'logbook', 'expenses', 'habits', 'tasks', 'focus', 'content', 'notes', 'tools'])
  for (const w of WIDGETS) if (w.module) assert.ok(toolIds.has(w.module), `${w.id}: module "${w.module}"`)
})

// ---- the template payload shapes ----
test('every kind has a label and a payload shape', () => {
  for (const kind of TEMPLATE_KINDS) {
    assert.ok(TEMPLATE_KIND_LABELS[kind], `${kind}: label`)
    assert.ok(TEMPLATE_PAYLOAD_FIELDS[kind].length > 0, `${kind}: fields`)
  }
})
test('task templates cover subtasks, default tags, priority and recurrence', () => {
  const keys = TEMPLATE_PAYLOAD_FIELDS.task.map((f) => f.key)
  for (const k of ['subtasks', 'tags', 'priority', 'recurrenceRule']) assert.ok(keys.includes(k), k)
})
test('trade templates cover a pre-trade and a post-trade checklist', () => {
  const keys = TEMPLATE_PAYLOAD_FIELDS.trade.map((f) => f.key)
  assert.ok(keys.includes('preTrade'))
  assert.ok(keys.includes('postTrade'))
})

test('every built-in template uses only the fields its kind documents', () => {
  for (const t of BUILTIN_TEMPLATES) {
    const allowed = new Set(TEMPLATE_PAYLOAD_FIELDS[t.kind].map((f) => f.key))
    for (const key of Object.keys(t.payload)) assert.ok(allowed.has(key), `${t.name}: unknown field "${key}"`)
    assert.ok(t.name.trim() && t.name.length <= 80, `${t.name}: a usable name`)
  }
})
test('built-in names are unique per kind (the engine keys a template on kind + name)', () => {
  const seen = new Set(BUILTIN_TEMPLATES.map((t) => `${t.kind}:${t.name}`))
  assert.equal(seen.size, BUILTIN_TEMPLATES.length)
})
test('there is a built-in for every kind the manager shows', () => {
  for (const kind of TEMPLATE_KINDS) assert.ok(BUILTIN_TEMPLATES.some((t) => t.kind === kind), `${kind} has a starter`)
})
test('a built-in task template repeats, and its subtasks are plain lines', () => {
  const task = BUILTIN_TEMPLATES.find((t) => t.kind === 'task')!
  const rule = task.payload.recurrenceRule as { frequency: string; intervalDays: number }
  assert.ok(['daily', 'weekly', 'monthly', 'custom'].includes(rule.frequency))
  assert.ok(Array.isArray(task.payload.subtasks) && (task.payload.subtasks as string[]).every((s) => typeof s === 'string'))
})

// ---- reading a payload ----
const tpl = (kind: Template['kind'], payload: unknown): Template => ({
  id: 1, kind, name: 'T', payload, isBuiltin: false, createdAt: '', updatedAt: ''
})
test('filled fields ignore empty values and list the labels a person sees', () => {
  assert.deepEqual(filledFields('logbook', { title: 'Hi', body: '', tags: [], mood: 'great' }).map((f) => f.key), ['title', 'mood'])
  assert.deepEqual(filledFields('logbook', null), [])
  assert.equal(summaryOf(tpl('logbook', { title: 'Hi', tags: ['a'] })), 'title, tags')
  assert.equal(summaryOf(tpl('logbook', {})), 'Nothing set')
})
test('trade checklists read plain strings, {text} rows, and skip blanks', () => {
  const out = tradeChecklists({ preTrade: ['One', '', { text: 'Two' }, { other: 1 }], postTrade: 'nope' })
  assert.deepEqual(out, { preTrade: ['One', 'Two'], postTrade: [] })
  assert.deepEqual(tradeChecklists(null), { preTrade: [], postTrade: [] })
  const builtin = BUILTIN_TEMPLATES.find((t) => t.kind === 'trade')!
  assert.ok(tradeChecklists(builtin.payload).preTrade.length > 0)
  assert.ok(tradeChecklists(builtin.payload).postTrade.length > 0)
})
test('the editor splits and joins one line each, dropping blanks', () => {
  assert.deepEqual(splitLines(' a \n\n b\n  '), ['a', 'b'])
  assert.equal(joinLines(['a', 'b']), 'a\nb')
  assert.deepEqual(splitLines(joinLines(['a', 'b'])), ['a', 'b'])
})
test('templates are grouped in a fixed kind order, whatever order they arrive in', () => {
  const groups = groupTemplates([tpl('trade', {}), tpl('logbook', {}), tpl('logbook', {})])
  assert.deepEqual(groups.map((g) => g.kind), [...TEMPLATE_KINDS])
  assert.equal(groups.find((g) => g.kind === 'logbook')!.items.length, 2)
})
test('a built-in cannot be removed, a user template can', () => {
  assert.equal(canRemoveTemplate(tpl('note', {})), true)
  assert.equal(canRemoveTemplate({ ...tpl('note', {}), isBuiltin: true }), false)
})

// ---- the built-ins use the same variable rules as every other template ----
test('a built-in renders its {{variables}} with the local day', () => {
  const vars = templateVars(new Date(2026, 10, 3, 9, 5)) // Tuesday 3 November 2026, local time
  const note = BUILTIN_TEMPLATES.find((t) => t.name === 'Meeting note')!
  const out = renderTemplate(note.payload, vars) as { title: string }
  assert.equal(out.title, 'Meeting with Tuesday 2026-11-03')
})

console.log(`\n${n} template manager checks passed`)
