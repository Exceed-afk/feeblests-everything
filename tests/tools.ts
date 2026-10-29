// Checks for the rules every entry in the tool registry must follow. Needs no DOM or React:
//   npm test
// (The real registry is checked by the same function every time the app starts.)
import assert from 'node:assert/strict'
import { sidebarLayout, toggleId, validateTools, type ToolMeta } from '../src/shared/tools'
import { normalizeSettings } from '../src/shared/appearance'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const tool = (over: Partial<ToolMeta> = {}): ToolMeta =>
  ({ id: 'notes', name: 'Notes', route: '/notes', category: 'notes', keywords: ['memo'], ...over })
const bad = (list: ToolMeta[], pattern: RegExp) => assert.ok(validateTools(list).some((p) => pattern.test(p)), `expected a problem matching ${pattern}`)

test('a correct list has no problems', () => {
  assert.deepEqual(validateTools([tool(), tool({ id: 'todo', name: 'To-do', route: '/todo', shortcut: '3' }), tool({ id: 'settings', name: 'Settings', route: '/settings', footer: true })]), [])
})
test('an empty registry is a problem', () => bad([], /empty/))
test('duplicate ids, routes and shortcuts are caught', () => {
  bad([tool(), tool({ route: '/other' })], /id "notes" is already used/)
  bad([tool(), tool({ id: 'other' })], /route "\/notes" is already used/)
  bad([tool({ shortcut: '2' }), tool({ id: 'other', route: '/other', shortcut: '2' })], /shortcut "2" is already used/)
})
test('ids and routes must have a clean shape', () => {
  bad([tool({ id: 'My Notes' })], /id must be/)
  bad([tool({ id: '1notes' })], /id must be/)
  bad([tool({ route: 'notes' })], /route must look like/)
  bad([tool({ route: '/notes/' })], /route must look like/)
})
test('the name cannot be blank and the category must exist', () => {
  bad([tool({ name: '  ' })], /name is empty/)
  bad([tool({ category: 'fun' as ToolMeta['category'] })], /unknown category/)
})
test('keywords must be lowercase and non-empty', () => {
  bad([tool({ keywords: ['Memo'] })], /keywords/)
  bad([tool({ keywords: [''] })], /keywords/)
})
test('shortcuts are a single digit 1-9 (Ctrl+K, B and N are taken)', () => {
  for (const s of ['0', '10', 'k', 'b', 'n', '']) bad([tool({ shortcut: s })], /shortcut must be/)
})
test('the start page cannot be a footer tool', () => bad([tool({ footer: true })], /start page/))

// ---- Sidebar layout ----
const t = (id: string, category: ToolMeta['category'], extra: Partial<ToolMeta> = {}): ToolMeta =>
  ({ id, name: id, route: `/${id}`, category, keywords: [], ...extra })
const all = [t('home', 'overview'), t('trades', 'money'), t('savings', 'money'), t('habits', 'productivity'), t('logbook', 'notes'), t('search', 'utilities'), t('settings', 'utilities', { footer: true })]
const ids = (list: ToolMeta[]) => list.map((x) => x.id)

test('with nothing pinned, tools sit under their categories in category order, empty ones skipped', () => {
  const l = sidebarLayout(all, [])
  assert.deepEqual(l.pinned, [])
  assert.deepEqual(l.groups.map((g) => g.id), ['overview', 'money', 'productivity', 'notes', 'utilities']) // no health: it has no tools
  assert.deepEqual(ids(l.groups[1].tools), ['trades', 'savings'])
  assert.equal(l.groups[0].flat, true)
  assert.equal(l.groups[1].flat, false)
  assert.deepEqual(ids(l.footer), ['settings'])
})
test('a footer tool is not listed in a group', () => {
  assert.deepEqual(ids(sidebarLayout(all, []).groups[4].tools), ['search'])
})
test('pinned tools move to the top, in pin order, and leave their group (never shown twice)', () => {
  const l = sidebarLayout(all, ['savings', 'home'])
  assert.deepEqual(ids(l.pinned), ['savings', 'home'])
  assert.deepEqual(ids(l.groups.find((g) => g.id === 'money')!.tools), ['trades'])
  assert.equal(l.groups.some((g) => g.id === 'overview'), false) // its only tool is pinned, so the group disappears
})
test('unknown ids, repeats and footer tools in the pinned list are ignored', () => {
  const l = sidebarLayout(all, ['ghost', 'trades', 'trades', 'settings'])
  assert.deepEqual(ids(l.pinned), ['trades'])
  assert.deepEqual(ids(l.footer), ['settings'])
})
test('toggleId adds then removes, without touching the other ids or the original list', () => {
  const start = ['a', 'b']
  assert.deepEqual(toggleId(start, 'c'), ['a', 'b', 'c'])
  assert.deepEqual(toggleId(start, 'a'), ['b'])
  assert.deepEqual(start, ['a', 'b'])
})

// ---- Saved sidebar settings ----
test('saved pins and closed groups are cleaned: only tidy ids, no repeats', () => {
  const s = normalizeSettings({ pinnedTools: ['trades', 'trades', 'Bad Id', 7, null, 'habits'], sidebarClosedGroups: ['money', '../x'] })
  assert.deepEqual(s.pinnedTools, ['trades', 'habits'])
  assert.deepEqual(s.sidebarClosedGroups, ['money'])
})
test('missing or damaged sidebar settings fall back to empty lists (everything open, nothing pinned)', () => {
  for (const raw of [undefined, {}, { pinnedTools: 'trades', sidebarClosedGroups: { a: 1 } }]) {
    const s = normalizeSettings(raw as never)
    assert.deepEqual(s.pinnedTools, [])
    assert.deepEqual(s.sidebarClosedGroups, [])
  }
})
test('the icons-only setting stays a plain true / false', () => {
  assert.equal(normalizeSettings({ sidebarCollapsed: true }).sidebarCollapsed, true)
  assert.equal(normalizeSettings({ sidebarCollapsed: 'yes' as never }).sidebarCollapsed, false)
})

console.log(`\n${n} tool registry checks passed`)
