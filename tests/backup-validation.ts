// Checks for the import validation. Needs no database, so it runs anywhere:
//   npm test
import assert from 'node:assert/strict'
import { parseBackup } from '../src/shared/backup'
import { moodStyle } from '../src/renderer/src/lib/moods'

const SCHEMA = 5
const stamp = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }

// A small, valid backup that each test then damages in one specific way.
const base = () => ({
  app: 'feeblests-everything', format: 1, schemaVersion: SCHEMA, exportedAt: '2026-10-25T00:00:00Z', settings: {},
  logbook: [{ id: 1, date: '2026-10-01', title: 'a', body: '', mood: 'good', tags: [], ...stamp }],
  trades: [],
  savingsGoals: [{ id: 1, name: 'Car', target: 100, notes: '', ...stamp }],
  savingsTransactions: [{ id: 1, goalId: 1, date: '2026-10-01', kind: 'deposit', amount: 50, note: '', ...stamp }]
})
const tx = (id: number, kind: string, amount: number, date = '2026-10-02') =>
  ({ id, goalId: 1, date, kind, amount, note: '', ...stamp })
const parse = (b: unknown) => parseBackup(JSON.stringify(b), SCHEMA)
const rejects = (b: unknown, pattern: RegExp) => assert.throws(() => parse(b), pattern)

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('a valid backup is accepted', () => { parse(base()) })

test('every known mood is accepted, and so is no mood', () => {
  for (const mood of ['great', 'good', 'okay', 'low', 'rough', null]) {
    const b = base(); b.logbook[0].mood = mood as never; parse(b)
  }
})
test('an unknown mood is rejected', () => {
  const b = base(); b.logbook[0].mood = 'angry'; rejects(b, /Logbook entry #1/)
})
test('a mood with different capitals is rejected', () => {
  const b = base(); b.logbook[0].mood = 'Good'; rejects(b, /Logbook entry #1/)
})

test('a withdrawal that overdraws a goal is rejected, naming the goal', () => {
  const b = base(); b.savingsTransactions.push(tx(2, 'withdrawal', 500) as never)
  rejects(b, /Savings goal "Car" would end with a negative balance/)
})
test('withdrawing exactly the balance is fine', () => {
  const b = base(); b.savingsTransactions.push(tx(2, 'withdrawal', 50) as never); parse(b)
})
test('decimal noise does not cause a false rejection (0.1 + 0.2 - 0.3)', () => {
  const b = base()
  b.savingsTransactions = [tx(1, 'deposit', 0.1), tx(2, 'deposit', 0.2), tx(3, 'withdrawal', 0.3)] as never
  parse(b)
})
test('only the final balance counts, like in the app (a backdated withdrawal is allowed)', () => {
  const b = base(); b.savingsTransactions.push(tx(2, 'withdrawal', 20, '2026-09-01') as never); parse(b)
})
test('a goal with no transactions is fine', () => {
  const b = base(); b.savingsTransactions = []; parse(b)
})
test('each goal is checked on its own', () => {
  const b = base()
  b.savingsGoals.push({ id: 2, name: 'Trip', target: null, notes: '', ...stamp } as never)
  b.savingsTransactions.push({ ...tx(2, 'withdrawal', 5), goalId: 2 } as never)
  rejects(b, /Savings goal "Trip"/)
})

test('the screens get a safe fallback for an unknown mood', () => {
  assert.equal(moodStyle('angry').label, 'angry')
  assert.equal(moodStyle('good').label, 'Good')
})

// ---- habits ----
const withHabits = () => ({
  ...base(),
  habits: [{ id: 1, name: 'Read', notes: '', days: [0, 1, 2], archived: false, startDate: '2026-10-01', ...stamp }],
  habitCheckins: [{ habitId: 1, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z' }]
})

test('a backup made before habits existed still imports, with no habits', () => {
  const b = parse(base())
  assert.deepEqual([b.habits, b.habitCheckins], [[], []])
})
test('a backup with habits and check-ins is accepted', () => { parse(withHabits()) })
test('a habit with no days is rejected', () => {
  const b = withHabits(); b.habits[0].days = []; rejects(b, /Habit #1/)
})
test('a habit with a weekday outside 0-6 is rejected', () => {
  const b = withHabits(); b.habits[0].days = [0, 7]; rejects(b, /Habit #1/)
})
test('a habit with repeated weekdays is rejected', () => {
  const b = withHabits(); b.habits[0].days = [1, 1]; rejects(b, /Habit #1/)
})
test('a habit with a blank name is rejected', () => {
  const b = withHabits(); b.habits[0].name = '  '; rejects(b, /Habit #1/)
})
test('archived must be true or false', () => {
  const b = withHabits(); (b.habits[0] as { archived: unknown }).archived = 1; rejects(b, /Habit #1/)
})
test('a check-in for a habit that is not in the file is rejected', () => {
  const b = withHabits(); b.habitCheckins[0].habitId = 9; rejects(b, /habit 9, which is not in the file/)
})
test('the same day checked off twice is rejected', () => {
  const b = withHabits(); b.habitCheckins.push({ ...b.habitCheckins[0] }); rejects(b, /checked off twice/)
})
test('a check-in with a bad date is rejected', () => {
  const b = withHabits(); b.habitCheckins[0].date = 'yesterday'; rejects(b, /Habit check-in #1/)
})
test('habit lists that are not lists are rejected', () => {
  const b = withHabits(); (b as { habits: unknown }).habits = 'nope'; rejects(b, /missing its "habits" list/)
})

console.log(`ALL ${n} PASSED`)
