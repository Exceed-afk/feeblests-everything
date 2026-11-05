// Checks for the import validation. Needs no database, so it runs anywhere:
//   npm test
import assert from 'node:assert/strict'
import { parseBackup } from '../src/shared/backup'
import { MIGRATIONS } from '../src/main/migrations'
import { moodStyle } from '../src/renderer/src/lib/moods'

const SCHEMA = MIGRATIONS.length
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
test('a legacy backup defaults missing task completion history to an empty list', () => {
  assert.deepEqual(parse(base()).taskCompletions, [])
})

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
  // The status is optional: backups made before skipped days existed have none.
  habitCheckins: [{ habitId: 1, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', status: 'done' as 'done' | 'skipped' | undefined }]
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
test('a check-in with no status is accepted (an old backup: it was a done day)', () => {
  const b = withHabits(); parse(b)
})
test('a check-in with a done or skipped status is accepted', () => {
  const b = withHabits(); b.habitCheckins[0].status = 'skipped'; parse(b)
  const c = withHabits(); c.habitCheckins[0].status = 'done'; parse(c)
})
test('a check-in with an unknown status is rejected', () => {
  const b = withHabits(); (b.habitCheckins[0] as unknown as { status: unknown }).status = 'maybe'; rejects(b, /Habit check-in #1/)
})
// ---- tasks / recurrence ----
const stampRow = (over: Record<string, unknown>): Record<string, unknown> =>
  ({ notes: '', status: 'todo', priority: 'medium', dueDate: null, completedAt: null, project: null, tags: [], position: 0, recurrenceRule: null, recurrenceNext: null, ...over })
const series = () => ({
  ...base(),
  tasks: [
    stampRow({ id: 1, title: 'Weekly', status: 'done', dueDate: '2026-10-26', completedAt: '2026-10-26T12:00:00Z', recurrenceRule: { frequency: 'weekly', intervalDays: 1 }, recurrenceNext: '2026-11-02', ...stamp }),
    stampRow({ id: 2, title: 'Plain', dueDate: '2026-11-02', ...stamp })
  ],
  taskSubtasks: []
})

test('recurring rules, next dates and soft-delete stamps are accepted and round-tripped', () => {
  const round = parse(series()) as { tasks: { id: number; recurrenceRule: unknown; recurrenceNext: string | null; deletedAt: string | null }[] }
  assert.deepEqual(round.tasks[0].recurrenceRule, { frequency: 'weekly', intervalDays: 1 })
  assert.equal(round.tasks[0].recurrenceNext, '2026-11-02')
  assert.equal(round.tasks[1].recurrenceRule, null)
  assert.equal(round.tasks[1].deletedAt, null)
})
test('an invalid recurrence rule is rejected', () => {
  const b = series(); (b.tasks[0] as { recurrenceRule: unknown }).recurrenceRule = { frequency: 'hourly', intervalDays: 1 }; rejects(b, /Task #1/)
})
test('a recurrenceNext that is not a date is rejected', () => {
  const b = series(); (b.tasks[0] as { recurrenceNext: unknown }).recurrenceNext = 'soon'; rejects(b, /Task #1/)
})
// ---- old-shape (pre-migration-9) backups still import ----
test('an old-format backup maps sortOrder/recurrence onto the new task fields', () => {
  const old = series()
  ;(old.tasks as Record<string, unknown>[]).forEach((t) => { delete t.position; delete t.recurrenceRule; delete t.recurrenceNext
    ;(t as Record<string, unknown>).sortOrder = 7; (t as Record<string, unknown>).recurrence = { frequency: 'weekly', intervalDays: 1 } })
  const round = parse(old) as { tasks: { position: number; recurrenceRule: unknown; dueTime: unknown; deletedAt: unknown }[] }
  assert.equal(round.tasks[0].position, 7)
  assert.deepEqual(round.tasks[0].recurrenceRule, { frequency: 'weekly', intervalDays: 1 })
  assert.equal(round.tasks[0].dueTime, null)
  assert.equal(round.tasks[0].deletedAt, null)
})

console.log(`ALL ${n} PASSED`)


// ---- Calculator backup validation ----
const withCalc = () => ({
  ...base(),
  calculator: {
    history: [{
      id: 1, createdAt: '2026-11-04T00:00:00Z', mode: 'standard', input: '2+2', result: '4',
      resultFormat: 'decimal' as const, rateSnapshot: null, pinned: false
    }],
    variables: [{ name: 'x', value: '42', updatedAt: '2026-11-04T00:00:00Z' }],
    programs: [{ id: 1, name: 'P', source: 'return 1', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' }],
    rateSets: [{ id: 'custom', name: 'Custom Rates', baseCurrency: 'USD', isActive: true, updatedAt: '2026-11-04T00:00:00Z' }],
    rates: [{ id: 1, rateSetId: 'custom', currencyCode: 'EUR', name: 'Euro', rateToBase: '0.92', note: 'test', updatedAt: '2026-11-04T00:00:00Z' }],
    rateOverrides: [{ id: 1, rateSetId: 'custom', fromCode: 'GBP', toCode: 'EUR', rate: '1.18', updatedAt: '2026-11-04T00:00:00Z' }],
    settings: [{ key: 'precision', value: '14' }]
  }
})

test('a backup with valid calculator section is accepted', () => {
  parse(withCalc())
})

test('calculator section that is not an object is rejected', () => {
  const b = base(); (b as Record<string, unknown>).calculator = 'bad'; rejects(b, /calculator backup section is not an object/)
})

test('calculator section missing a list is rejected', () => {
  const b = withCalc(); delete (b.calculator as Record<string, unknown>).history; rejects(b, /missing its "history" list/)
})

test('calculator history with invalid resultFormat is rejected', () => {
  const b = withCalc(); (b.calculator.history[0] as Record<string, unknown>).resultFormat = 'bad_format'; rejects(b, /Calculator history item #1/)
})

test('calculator variable with duplicate name is rejected', () => {
  const b = withCalc(); b.calculator.variables.push({ name: 'X', value: '10', updatedAt: '2026-11-04T00:00:00Z' })
  rejects(b, /contain the name "x" twice/)
})

test('calculator rate referencing non-existent rate set is rejected', () => {
  const b = withCalc(); b.calculator.rates[0].rateSetId = 'ghost'; rejects(b, /references rate set "ghost", which is not in the file/)
})

test('calculator rate override referencing non-existent rate set is rejected', () => {
  const b = withCalc(); b.calculator.rateOverrides[0].rateSetId = 'ghost'; rejects(b, /references rate set "ghost", which is not in the file/)
})

test('calculator rates with duplicate currency in same set is rejected', () => {
  const b = withCalc(); b.calculator.rates.push({ ...b.calculator.rates[0], id: 2 })
  rejects(b, /contain the currency "EUR" twice/)
})

test('calculator settings with duplicate key is rejected', () => {
  const b = withCalc(); b.calculator.settings.push({ key: 'precision', value: '12' })
  rejects(b, /contain the key "precision" twice/)
})
