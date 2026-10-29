// Checks for Quick capture's rules (src/shared/capture.ts). No Electron needed:
//   npm test
import assert from 'node:assert/strict'
import {
  DEFAULT_HOTKEY, NOTE_TITLE_MAX, acceleratorFromKeyEvent, buildDeposit, buildNote, buildTrade, checkAccelerator,
  formatAccelerator, habitsForToday, parseTags, readCaptureSettings
} from '../src/shared/capture'
import { computeHabitStats } from '../src/shared/habits'
import type { Habit } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }
const good = (s: string): string => { const r = checkAccelerator(s); assert.ok(r.ok, `${s} should be accepted: ${r.ok ? '' : r.reason}`); return r.ok ? r.value : '' }
const bad = (s: unknown): string => { const r = checkAccelerator(s); assert.ok(!r.ok, `${String(s)} should be refused`); return r.ok ? '' : r.reason }

// ---- shortcuts ----
test('the default shortcut is itself allowed', () => {
  assert.equal(good(DEFAULT_HOTKEY), DEFAULT_HOTKEY)
})
test('shortcuts are written one canonical way, whatever order, case or alias is typed', () => {
  assert.equal(good('ctrl+shift+k'), 'Control+Shift+K')
  assert.equal(good('Shift+Ctrl+K'), 'Control+Shift+K')
  assert.equal(good('cmdorctrl+alt+j'), 'CommandOrControl+Alt+J')
  assert.equal(good('Option+Shift+1'), 'Alt+Shift+1')
  assert.equal(good('meta+shift+n'), 'Shift+Super+N')
  assert.equal(good('Alt+Enter'), 'Alt+Return')
  assert.equal(good(' Ctrl + Alt + Space '), 'Control+Alt+Space')
})
test('function keys and Space need only one modifier; letters and digits need two', () => {
  assert.equal(good('Control+F9'), 'Control+F9')
  assert.equal(good('Alt+Space'), 'Alt+Space')
  assert.equal(good('CommandOrControl+Alt+F24'), 'CommandOrControl+Alt+F24')
  assert.match(bad('Control+C'), /almost every program/)
  assert.match(bad('Alt+S'), /almost every program/)
  assert.match(bad('CommandOrControl+1'), /almost every program/)
})
test('a shortcut with no real modifier is refused, because it would stop you typing', () => {
  assert.match(bad('K'), /Include Ctrl/)
  assert.match(bad('Shift+K'), /Shift alone/)
  assert.match(bad('F9'), /Include Ctrl/)
})
test('nonsense is refused with a reason a person can read', () => {
  for (const x of ['', '   ', undefined, null, 123, {}, 'Ctrl+', '+K', 'Ctrl++K']) assert.ok(bad(x).length > 5)
  assert.match(bad('Foo+Shift+K'), /"Foo" is not a modifier/)
  assert.match(bad('Ctrl+Shift+Ö'), /cannot be used/)
  assert.match(bad('Ctrl+Shift+F25'), /cannot be used/)
  assert.match(bad('Ctrl+Ctrl+K'), /repeated/)
  assert.match(bad('CommandOrControl+Control+K'), /either Ctrl or Command/)
})
test('Escape is refused (it closes the window) and the shortcuts the system keeps are refused', () => {
  assert.match(bad('Ctrl+Alt+Escape'), /Escape/)
  assert.match(bad('Alt+F4'), /system keeps/)
  assert.match(bad('Ctrl+Alt+Delete'), /system keeps/)
  assert.match(bad('CommandOrControl+Alt+Delete'), /system keeps/)
})
test('a checked shortcut checks again as itself (400 generated cases)', () => {
  const mods = ['Ctrl', 'Alt', 'Shift', 'Super', 'CmdOrCtrl', 'Command']
  const keys = ['A', 'z', '5', 'Space', 'F1', 'f12', 'Tab', 'Up', 'PageDown', '-', '/', 'Plus', 'Enter']
  let seed = 11, accepted = 0
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let i = 0; i < 400; i++) {
    const m = mods.filter(() => rnd() < 0.4)
    const s = [...m, keys[Math.floor(rnd() * keys.length)]].join('+')
    const r = checkAccelerator(s)
    if (!r.ok) continue
    accepted++
    const again = checkAccelerator(r.value)
    assert.ok(again.ok && again.value === r.value, s)
  }
  assert.ok(accepted > 40, `only ${accepted} accepted: the generator is not exercising the rules`)
})

// ---- recording a shortcut from key presses ----
const press = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })
test('a key press becomes a shortcut: Ctrl is the same on Windows and Linux, Cmd takes its place on a Mac', () => {
  assert.equal(acceleratorFromKeyEvent(press('Space', { ctrlKey: true, shiftKey: true }), false), 'CommandOrControl+Shift+Space')
  assert.equal(acceleratorFromKeyEvent(press('Space', { metaKey: true, shiftKey: true }), true), 'CommandOrControl+Shift+Space')
  assert.equal(acceleratorFromKeyEvent(press('KeyJ', { ctrlKey: true, altKey: true }), true), 'Control+Alt+J')
  assert.equal(acceleratorFromKeyEvent(press('KeyK', { metaKey: true, shiftKey: true }), false), 'Super+Shift+K')
})
test('the physical key is used, so Shift+1 is "1" and not "!"', () => {
  assert.equal(acceleratorFromKeyEvent(press('Digit1', { ctrlKey: true, shiftKey: true }), false), 'CommandOrControl+Shift+1')
  assert.equal(acceleratorFromKeyEvent(press('F9', { altKey: true }), false), 'Alt+F9')
  assert.equal(acceleratorFromKeyEvent(press('ArrowUp', { ctrlKey: true, altKey: true }), false), 'CommandOrControl+Alt+Up')
  assert.equal(acceleratorFromKeyEvent(press('Backquote', { ctrlKey: true, altKey: true }), false), 'CommandOrControl+Alt+`')
})
test('holding only modifiers, or a key that is not offered, gives nothing yet', () => {
  assert.equal(acceleratorFromKeyEvent(press('ShiftLeft', { shiftKey: true }), false), null)
  assert.equal(acceleratorFromKeyEvent(press('ControlLeft', { ctrlKey: true }), false), null)
  assert.equal(acceleratorFromKeyEvent(press('NumpadAdd', { ctrlKey: true }), false), null)
})
test('every recorded shortcut that is allowed is accepted by the checker as typed', () => {
  const r = acceleratorFromKeyEvent(press('KeyN', { ctrlKey: true, altKey: true }), false) as string
  assert.equal(good(r), 'CommandOrControl+Alt+N')
})

// ---- showing a shortcut ----
test('shortcuts are shown the way each system writes them', () => {
  assert.equal(formatAccelerator('CommandOrControl+Shift+Space', false), 'Ctrl+Shift+Space')
  assert.equal(formatAccelerator('CommandOrControl+Shift+Space', true), '⌘⇧Space')
  assert.equal(formatAccelerator('Super+Alt+K', false), 'Win+Alt+K')
  assert.equal(formatAccelerator('Control+Alt+J', true), '⌃⌥J')
})

// ---- stored settings ----
test('missing or damaged settings fall back to safe defaults', () => {
  assert.deepEqual(readCaptureSettings({}), { enabled: true, hotkey: DEFAULT_HOTKEY, keepRunning: false })
  assert.equal(readCaptureSettings({ captureHotkey: 'K' }).hotkey, DEFAULT_HOTKEY)
  assert.equal(readCaptureSettings({ captureHotkey: 42 }).hotkey, DEFAULT_HOTKEY)
  assert.equal(readCaptureSettings({ captureEnabled: 'no', captureKeepRunning: 'yes' }).enabled, true)
  assert.equal(readCaptureSettings({ captureKeepRunning: 'yes' }).keepRunning, false)
})
test('stored settings are used, and a stored shortcut is tidied', () => {
  assert.deepEqual(readCaptureSettings({ captureEnabled: false, captureHotkey: 'ctrl+alt+k', captureKeepRunning: true }),
    { enabled: false, hotkey: 'Control+Alt+K', keepRunning: true })
})

// ---- note ----
const TODAY = '2026-10-27'
const note = (text: string, extra: Partial<{ mood: any; tags: string }> = {}) => buildNote({ text, mood: null, tags: '', today: TODAY, ...extra })
test('an empty note is refused', () => {
  for (const t of ['', '   ', '\n\n  \n']) assert.deepEqual(note(t), { ok: false, error: 'Write something first.' })
})
test('a one-line note becomes a title with no body', () => {
  assert.deepEqual(note('  Call the bank about the card  '), { ok: true, value: { date: TODAY, title: 'Call the bank about the card', body: '', mood: null, tags: [] } })
})
test('the first line is the title and the rest is the body, with Windows line endings handled', () => {
  const r = note('Idea\r\n\r\nWhat if the review also showed fees?\r\nCheck on Friday.')
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.value.title, 'Idea'); assert.equal(r.value.body, 'What if the review also showed fees?\nCheck on Friday.') }
})
test('a first line too long for a title is cut, and the whole text is kept as the body', () => {
  const long = 'word '.repeat(40).trim()
  const r = note(`${long}\nsecond line`)
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(Array.from(r.value.title).length <= NOTE_TITLE_MAX + 1, true)
    assert.ok(r.value.title.endsWith('…'))
    assert.equal(r.value.body, `${long}\nsecond line`)
  }
})
test('cutting a long title never splits an emoji', () => {
  const r = note('😀'.repeat(100))
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.value.title, '😀'.repeat(NOTE_TITLE_MAX) + '…')
})
test('mood and tags are carried over, and tags are tidied', () => {
  const r = note('Good day', { mood: 'good', tags: '#Work, idea  work' })
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.value.mood, 'good'); assert.deepEqual(r.value.tags, ['work', 'idea']) }
  assert.deepEqual(parseTags(''), [])
  assert.deepEqual(parseTags(' ,, #, '), [])
})

// ---- trade ----
const T = (o: Partial<{ asset: string; direction: any; entry: string; exit: string; qty: string; fees: string }> = {}) =>
  buildTrade({ asset: 'XAUUSD', direction: 'long', entry: '2300', exit: '', qty: '1', fees: '', today: TODAY, ...o })
test('a trade with a blank exit is open, and blank fees are 0', () => {
  assert.deepEqual(T(), { ok: true, value: { date: TODAY, asset: 'XAUUSD', direction: 'long', entryPrice: 2300, exitPrice: null, quantity: 1, fees: 0, notes: '', tags: [] } })
})
test('a closed trade keeps its numbers', () => {
  const r = T({ asset: '  btc ', direction: 'short', entry: '60000.5', exit: '59000', qty: '0.25', fees: '3.5' })
  assert.deepEqual(r, { ok: true, value: { date: TODAY, asset: 'btc', direction: 'short', entryPrice: 60000.5, exitPrice: 59000, quantity: 0.25, fees: 3.5, notes: '', tags: [] } })
})
test('each trade mistake gets its own readable message', () => {
  assert.match((T({ asset: ' ' }) as any).error, /asset/)
  assert.match((T({ entry: '' }) as any).error, /Entry price/)
  assert.match((T({ entry: '0' }) as any).error, /Entry price/)
  assert.match((T({ entry: 'abc' }) as any).error, /Entry price/)
  assert.match((T({ exit: '-5' }) as any).error, /Exit price/)
  assert.match((T({ exit: 'x' }) as any).error, /Exit price/)
  assert.match((T({ qty: '' }) as any).error, /Size/)
  assert.match((T({ qty: '0' }) as any).error, /Size/)
  assert.match((T({ fees: '-1' }) as any).error, /Fees/)
  assert.match((T({ fees: 'abc' }) as any).error, /Fees/)
})
test('numbers that are not finite are refused (1e999 would otherwise pass "above 0")', () => {
  assert.equal(T({ entry: '1e999' }).ok, false)
  assert.equal(T({ qty: 'Infinity' }).ok, false)
  assert.equal(T({ fees: '1e999' }).ok, false)
})

// ---- deposit ----
test('a deposit or withdrawal needs a goal and an amount above 0', () => {
  assert.deepEqual(buildDeposit({ goalId: 3, kind: 'deposit', amount: '25.5', note: ' salary ', today: TODAY }),
    { ok: true, value: { goalId: 3, date: TODAY, kind: 'deposit', amount: 25.5, note: 'salary' } })
  assert.deepEqual(buildDeposit({ goalId: 3, kind: 'withdrawal', amount: '10', note: '', today: TODAY }),
    { ok: true, value: { goalId: 3, date: TODAY, kind: 'withdrawal', amount: 10, note: '' } })
  assert.match((buildDeposit({ goalId: null, kind: 'deposit', amount: '5', note: '', today: TODAY }) as any).error, /goal/)
  for (const a of ['', '0', '-3', 'abc', '1e999']) assert.match((buildDeposit({ goalId: 1, kind: 'deposit', amount: a, note: '', today: TODAY }) as any).error, /amount/)
})

// ---- habits ----
let id = 1
const habit = (name: string, days: number[], checkins: string[], o: { archived?: boolean } = {}): Habit => ({
  id: id++, name, notes: '', days, archived: o.archived ?? false, startDate: '2026-09-01', checkins,
  stats: computeHabitStats({ days, startDate: '2026-09-01' }, checkins, TODAY), createdAt: '', updatedAt: ''
})
test('the capture window lists habits scheduled today, unfinished first, and counts the resting ones', () => {
  // 2026-10-27 is a Tuesday (day 1)
  const r = habitsForToday([
    habit('Zeta', [0, 1, 2, 3, 4, 5, 6], [TODAY]),
    habit('Alpha', [0, 1, 2, 3, 4, 5, 6], []),
    habit('Gym', [0, 2, 4], []), // Mon / Wed / Fri: resting on Tuesday
    habit('Old', [0, 1, 2, 3, 4, 5, 6], [], { archived: true })
  ], TODAY)
  assert.deepEqual(r.items.map((h) => [h.name, h.done]), [['Alpha', false], ['Zeta', true]])
  assert.equal(r.rest, 1)
})
test('a rest-day habit that was checked off today still shows, so it can be unchecked', () => {
  const r = habitsForToday([habit('Gym', [0, 2, 4], [TODAY])], TODAY)
  assert.deepEqual(r.items.map((h) => [h.name, h.done]), [['Gym', true]])
  assert.equal(r.rest, 0)
})
test('no habits gives an empty list', () => {
  assert.deepEqual(habitsForToday([], TODAY), { items: [], rest: 0 })
})

console.log(`\n${n} quick capture checks passed`)
