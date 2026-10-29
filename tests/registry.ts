// Checks the real tool registry (src/renderer/src/tools.ts) and how it feeds the sidebar and the command palette,
// plus a generated registry of 60 tools so the same rules are proven at a larger size. Needs no DOM or React:
//   npm test
// (tests/tools.ts covers the validation rules and the layout with small made-up lists; this file covers the real data.)
import assert from 'node:assert/strict'
import { TOOLS, START_TOOL, findTool, toolByShortcut } from '../src/renderer/src/tools'
import { toolItems, recentToolItems } from '../src/renderer/src/lib/paletteItems'
import { searchEntries } from '../src/shared/palette'
import { sidebarLayout, validateTools, TOOL_CATEGORIES, type ToolMeta } from '../src/shared/tools'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const noop = () => {}

// ---- the real registry ----
test('the real registry passes the same check the app runs at start-up', () => assert.deepEqual(validateTools(TOOLS), []))
test('every tool has a name, an icon and a page, and the start page is the first tool', () => {
  for (const t of TOOLS) {
    assert.ok(t.name.trim(), `${t.id}: name`)
    assert.ok(t.icon, `${t.id}: icon`)
    assert.equal(typeof t.component, 'function', `${t.id}: component`)
  }
  assert.equal(START_TOOL, TOOLS[0])
})
test('ids, routes, names and shortcuts are each unique (two rows with one name could not be told apart)', () => {
  for (const pick of [(t: ToolMeta) => t.id, (t: ToolMeta) => t.route, (t: ToolMeta) => t.name.toLowerCase()]) {
    const values = TOOLS.map(pick)
    assert.equal(new Set(values).size, values.length)
  }
  const keys = TOOLS.flatMap((t) => (t.shortcut ? [t.shortcut] : []))
  assert.equal(new Set(keys).size, keys.length)
})
test('every tool can be found by id and by route, and by its shortcut when it has one', () => {
  for (const t of TOOLS) {
    assert.equal(findTool(t.id), t)
    assert.equal(findTool(t.route), t)
    if (t.shortcut) assert.equal(toolByShortcut(t.shortcut), t)
  }
  assert.equal(findTool('no-such-tool'), undefined)
})

// ---- registry -> palette ----
const items = toolItems(TOOLS, START_TOOL.id, noop)
test('every tool becomes one palette row with a unique id, its category as the group, and only the start page marked current', () => {
  assert.equal(items.length, TOOLS.length)
  assert.equal(new Set(items.map((i) => i.id)).size, items.length)
  items.forEach((item, i) => {
    assert.equal(item.group, TOOL_CATEGORIES.find((c) => c.id === TOOLS[i].category)!.name)
    assert.equal(item.current, TOOLS[i] === START_TOOL)
  })
})
test('typing a tool\'s exact name puts that tool first', () => {
  for (const t of TOOLS) assert.equal(searchEntries(items, t.name)[0]?.entry.id, `tool:${t.id}`, t.name)
})
test('every keyword and every category name finds its tool', () => {
  for (const t of TOOLS) {
    for (const k of t.keywords) assert.ok(searchEntries(items, k).some((h) => h.entry.id === `tool:${t.id}`), `${t.id}: keyword "${k}"`)
    const group = items.find((i) => i.id === `tool:${t.id}`)!.group
    assert.ok(searchEntries(items, group).some((h) => h.entry.id === `tool:${t.id}`), `${t.id}: category "${group}"`)
  }
})
test('the empty-box list leaves out the page you are on and skips ids that no longer exist', () => {
  const recent = recentToolItems(items, ['trades', 'removed-tool', 'dashboard', 'habits'], 'dashboard')
  assert.deepEqual(recent.map((i) => i.id), ['tool:trades', 'tool:habits'])
})

// ---- registry -> sidebar ----
const everyId = (l: ReturnType<typeof sidebarLayout<ToolMeta>>) => [...l.pinned, ...l.groups.flatMap((g) => g.tools), ...l.footer].map((t) => t.id)
function assertEachToolShownOnce(tools: ToolMeta[], pins: string[], label: string) {
  const shown = everyId(sidebarLayout(tools, pins))
  assert.equal(shown.length, tools.length, `${label}: count`)
  assert.deepEqual([...shown].sort(), tools.map((t) => t.id).sort(), `${label}: same tools`)
}
const pinSets = (tools: ToolMeta[]): [string, string[]][] => [
  ['nothing pinned', []],
  ['everything pinned', tools.map((t) => t.id)],
  ['every second tool', tools.filter((_, i) => i % 2 === 0).map((t) => t.id)],
  ['reversed order', tools.map((t) => t.id).reverse()],
  ['unknown and repeated ids', ['ghost', tools[1].id, tools[1].id, 'Bad Id']]
]
test('whatever is pinned, every tool of the real registry appears exactly once in the sidebar', () => {
  for (const [label, pins] of pinSets(TOOLS)) assertEachToolShownOnce(TOOLS, pins, label)
})
test('footer tools stay in the footer even when their id is in the pinned list', () => {
  const l = sidebarLayout(TOOLS, TOOLS.map((t) => t.id))
  assert.deepEqual(l.footer.map((t) => t.id), TOOLS.filter((t) => t.footer).map((t) => t.id))
  assert.equal(l.pinned.some((t) => t.footer), false)
})

// ---- the same rules at 60 tools ----
const kinds = ['Budget', 'Invoice', 'Journal', 'Planner', 'Tracker', 'Converter', 'Calendar', 'Reports']
const topics = ['Daily', 'Weekly', 'Tax', 'Travel', 'Gym', 'Reading', 'Garden', 'Stock']
const big: ToolMeta[] = [
  { id: 'home', name: 'Home', route: '/home', category: 'overview', keywords: ['start'], shortcut: '1' },
  ...Array.from({ length: 58 }, (_, i): ToolMeta => ({
    id: `tool-${i}`, name: `${topics[i % 8]} ${kinds[Math.floor(i / 8) % 8]}`, route: `/tool-${i}`,
    category: TOOL_CATEGORIES[1 + (i % 5)].id, keywords: [`kw${i}`, topics[i % 8].toLowerCase()]
  })),
  { id: 'settings', name: 'Settings', route: '/settings', category: 'utilities', keywords: ['theme'], shortcut: '9', footer: true }
]
test('a 60-tool registry is valid, and every tool is shown exactly once in the sidebar however it is pinned', () => {
  assert.deepEqual(validateTools(big), [])
  for (const [label, pins] of pinSets(big)) assertEachToolShownOnce(big, pins, label)
})
test('at 60 tools every tool is still found first by its exact name', () => {
  const rows = toolItems(big.map((t) => ({ ...t, icon: undefined as never, component: undefined as never })), 'home', noop)
  assert.equal(new Set(rows.map((r) => r.title.toLowerCase())).size, rows.length) // the generated names are distinct
  for (const r of rows) assert.equal(searchEntries(rows, r.title)[0]?.entry.id, r.id, r.title)
})
test('searching 60 tools stays instant (200 searches in well under a second)', () => {
  const rows = toolItems(big.map((t) => ({ ...t, icon: undefined as never, component: undefined as never })), 'home', noop)
  const queries = ['t', 'tr', 'tax', 'budget', 'wk rep', 'daily plan', 'money', 'zzz', 'kw12', 'gym tr']
  const start = performance.now()
  for (let round = 0; round < 20; round++) for (const q of queries) searchEntries(rows, q)
  const ms = performance.now() - start
  assert.ok(ms < 1000, `200 searches took ${Math.round(ms)} ms`)
})

console.log(`\n${n} registry checks passed`)
