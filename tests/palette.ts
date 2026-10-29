// Checks for the command palette's rules (matching, ranking, recent tools, actions). Needs no DOM or React:
//   npm test
import assert from 'node:assert/strict'
import { fuzzyMatch, pushRecent, resolveRecent, searchEntries, validateActions, MAX_RECENT_TOOLS, type PaletteEntry } from '../src/shared/palette'
import { normalizeSettings } from '../src/shared/appearance'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const entry = (id: string, title: string, group: string, keywords: string[] = []): PaletteEntry => ({ id, title, group, keywords })
const entries = [
  entry('tool:dashboard', 'Dashboard', 'Overview', ['home', 'summary']),
  entry('tool:logbook', 'Logbook', 'Notes', ['journal', 'diary']),
  entry('tool:trades', 'Trades', 'Money', ['trade tracker', 'p&l', 'gold']),
  entry('tool:savings', 'Savings', 'Money', ['goals', 'money']),
  entry('tool:habits', 'Habits', 'Productivity', ['streak']),
  entry('tool:search', 'Search', 'Utilities', ['find']),
  entry('tool:settings', 'Settings', 'Utilities', ['theme', 'backup']),
  entry('action:toggle-theme', 'Switch theme', 'Action', ['dark', 'light'])
]
const ids = (q: string) => searchEntries(entries, q).map((h) => h.entry.id)

// ---- the matcher ----
test('no match is null, and an empty needle matches nothing', () => {
  assert.equal(fuzzyMatch('xyz', 'Trades'), null)
  assert.equal(fuzzyMatch('', 'Trades'), null)
})
test('matching ignores case and reports which letters matched', () => {
  assert.deepEqual(fuzzyMatch('TRAD', 'Trades')?.indices, [0, 1, 2, 3])
  assert.deepEqual(fuzzyMatch('trd', 'Trades')?.indices, [0, 1, 3])
})
test('letters in order are found ("lgb" finds Logbook)', () => assert.ok(fuzzyMatch('lgb', 'Logbook')))
test('letters out of order are not', () => assert.equal(fuzzyMatch('bgl', 'Logbook'), null))
test('a run of text beats scattered letters, and a word start beats the middle of a word', () => {
  assert.ok(fuzzyMatch('trad', 'Trades')!.score > fuzzyMatch('trd', 'Trades')!.score)
  assert.ok(fuzzyMatch('rad', 'Trade tracker')!.score < fuzzyMatch('tra', 'Trade tracker')!.score)
  assert.ok(fuzzyMatch('track', 'Trade tracker')!.score > fuzzyMatch('rack', 'Trade tracker')!.score) // second word start beats mid-word
})
test('matches spread too thin are rejected', () => assert.equal(fuzzyMatch('gold', 'good old days'), null))

// ---- ranking ----
test('an empty or blank query matches nothing (the palette shows recent tools instead)', () => {
  assert.deepEqual(ids(''), [])
  assert.deepEqual(ids('   '), [])
})
test('names are found by prefix, by abbreviation and by typing in the wrong case', () => {
  assert.equal(ids('trad')[0], 'tool:trades')
  assert.equal(ids('lgb')[0], 'tool:logbook')
  assert.equal(ids('SAV')[0], 'tool:savings')
})
test('categories are searchable: "money" finds both tools in Money', () => {
  const found = ids('money')
  assert.ok(found.includes('tool:trades') && found.includes('tool:savings'))
  assert.equal(found.includes('tool:habits'), false)
})
test('keywords are searchable, and a title match outranks a keyword match', () => {
  assert.equal(ids('journal')[0], 'tool:logbook')
  assert.equal(ids('gold')[0], 'tool:trades')
  const both = [entry('a', 'Other', 'Notes', ['search']), entry('b', 'Search', 'Notes')]
  assert.equal(searchEntries(both, 'search')[0].entry.id, 'b')
})
test('every word must match something, so more words narrow the list', () => {
  assert.deepEqual(ids('money trades'), ['tool:trades'])
  assert.deepEqual(ids('trades banana'), [])
})
test('actions are found the same way as tools', () => {
  assert.equal(ids('switch')[0], 'action:toggle-theme')
  assert.equal(ids('dark')[0], 'action:toggle-theme')
  assert.ok(ids('theme').includes('tool:settings')) // by keyword: both appear
})
test('the highlighted letters are only the ones matched in the title', () => {
  const hit = searchEntries(entries, 'trad')[0]
  assert.deepEqual(hit.titleIndices, [0, 1, 2, 3])
  assert.deepEqual(searchEntries(entries, 'journal')[0].titleIndices, [])
})
test('equal scores keep the original order', () => {
  const same = [entry('x1', 'Alpha', 'G'), entry('x2', 'Alpha', 'G'), entry('x3', 'Alpha', 'G')]
  assert.deepEqual(searchEntries(same, 'alpha').map((h) => h.entry.id), ['x1', 'x2', 'x3'])
})
test('searching never changes the list it is given', () => {
  const copy = JSON.stringify(entries)
  searchEntries(entries, 'money')
  assert.equal(JSON.stringify(entries), copy)
})

test('punctuation inside a word still matches (\"p&l\", \"check-in\"), and extra spaces do not matter', () => {
  assert.equal(ids('p&l')[0], 'tool:trades')
  assert.deepEqual(ids('  money    trades  '), ['tool:trades'])
  const hyphen = [entry('h', 'Habits', 'Productivity', ['check-in'])]
  assert.equal(searchEntries(hyphen, 'check-in').length, 1)
})
test('only the first 6 words of a query are used, so a long pasted line cannot make everything fail', () => {
  assert.deepEqual(ids('money trades gold p&l trade tracker banana').slice(0, 1), ['tool:trades'])
})
test('a query longer than every title matches nothing instead of throwing', () => {
  assert.deepEqual(ids('a'.repeat(200)), [])
})
test('one entry with a very long title and many keywords is still matched quickly and correctly', () => {
  const long = entry('long', 'Quarterly estimated tax payment planner for freelancers', 'Money', Array.from({ length: 200 }, (_, i) => `keyword${i}`))
  assert.equal(searchEntries([long], 'quar tax')[0]?.entry.id, 'long')
  assert.equal(searchEntries([long], 'keyword150')[0]?.entry.id, 'long')
})
test('typing the group name ranks tools of that group together, in registry order', () => {
  assert.deepEqual(ids('utilities'), ['tool:search', 'tool:settings'])
})

// ---- recent tools ----
test('the newest tool goes first, repeats move to the front, the list is capped', () => {
  assert.deepEqual(pushRecent(['a', 'b'], 'c'), ['c', 'a', 'b'])
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b'])
  const long = Array.from({ length: MAX_RECENT_TOOLS }, (_, i) => `t${i}`)
  const next = pushRecent(long, 'new')
  assert.equal(next.length, MAX_RECENT_TOOLS)
  assert.equal(next[0], 'new')
  assert.equal(next.includes(`t${MAX_RECENT_TOOLS - 1}`), false) // the oldest fell off
})
test('opening the tool that is already first changes nothing (same list back, so nothing is saved)', () => {
  const list = ['a', 'b']
  assert.equal(pushRecent(list, 'a'), list)
})
test('pushRecent does not change the original list', () => {
  const list = ['a', 'b']
  pushRecent(list, 'c')
  assert.deepEqual(list, ['a', 'b'])
})
test('saved ids become items: unknown ids and the current page are skipped, order is kept', () => {
  const items = [{ id: 'trades' }, { id: 'habits' }, { id: 'logbook' }]
  assert.deepEqual(resolveRecent(['logbook', 'gone', 'trades', 'habits'], items), [{ id: 'logbook' }, { id: 'trades' }, { id: 'habits' }])
  assert.deepEqual(resolveRecent(['logbook', 'trades'], items, 'logbook'), [{ id: 'trades' }])
})
test('saved recent tools are cleaned: tidy ids only, no repeats, at most 8', () => {
  const messy = ['trades', 'trades', 'Bad Id', 7, null, '../x', ...Array.from({ length: 20 }, (_, i) => `t${i}`)]
  const s = normalizeSettings({ recentTools: messy })
  assert.equal(s.recentTools[0], 'trades')
  assert.equal(s.recentTools.length, MAX_RECENT_TOOLS)
  assert.equal(new Set(s.recentTools).size, s.recentTools.length)
})
test('missing or damaged recent tools fall back to an empty list', () => {
  for (const raw of [undefined, {}, { recentTools: 'trades' }, { recentTools: { a: 1 } }]) assert.deepEqual(normalizeSettings(raw as never).recentTools, [])
})

// ---- actions ----
test('a correct action list has no problems, and an empty one is fine', () => {
  assert.deepEqual(validateActions([]), [])
  assert.deepEqual(validateActions([{ id: 'toggle-theme', title: 'Switch theme', keywords: ['dark'] }, { id: 'new-entry', title: 'New log entry' }]), [])
})
test('bad action ids, duplicates, blank titles and keywords are caught', () => {
  const bad = (list: Parameters<typeof validateActions>[0], pattern: RegExp) => assert.ok(validateActions(list).some((p) => pattern.test(p)), `expected ${pattern}`)
  bad([{ id: 'Switch Theme', title: 'x' }], /id must be/)
  bad([{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }], /already used/)
  bad([{ id: 'a', title: '  ' }], /title is empty/)
  bad([{ id: 'a', title: 'x', keywords: ['Dark'] }], /keywords/)
})

console.log(`\n${n} command palette checks passed`)
