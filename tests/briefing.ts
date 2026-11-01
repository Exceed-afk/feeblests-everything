// Checks for the daily briefing rules (src/shared/briefing.ts). No database needed:
//   npm test        (tsx tests/briefing.ts runs as part of that)
import assert from 'node:assert/strict'
import {
  buildBriefing, tasksToday, habitsToday, savingsToday, tradesToday, journalToday,
  briefingSummary, moodNear, testBuilders, type DailyBriefing
} from '../src/shared/briefing'
import type { Habit, LogEntry, SavingsGoal, SavingsTx, Task, Trade } from '../src/shared/types'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

// Builders give each test a fresh set of ids so test order never matters.
let builders = testBuilders()
const reset = () => { builders = testBuilders() }
const trade = builders.trade
const goal = builders.goal
const tx = builders.tx
const habit = builders.habit
const entry = builders.entry

const TODAY = '2026-10-23' // a Friday, so weekday schedules are live and weekend ones are not
const YESTERDAY = '2026-10-22'
const EVERY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]
const WEEKEND = [5, 6]

const task = (id: number, dueDate: string | null, opts: { status?: Task['status']; priority?: Task['priority']; completedAt?: string | null } = {}): Task => ({
  id, title: `Task ${id}`, notes: '', status: opts.status ?? 'todo',
  priority: opts.priority ?? 'medium', dueDate, createdAt: '2026-01-01', completedAt: opts.completedAt ?? null,
  deletedAt: null, dueTime: null, project: null, tags: [], position: id, recurrenceRule: null, recurrenceNext: null, subtasks: []
})

const empty = { trades: [] as Trade[], goals: [] as SavingsGoal[], txs: [] as SavingsTx[], habits: [] as Habit[], tasks: [] as Task[], entries: [] as LogEntry[] }
const briefing = (over: Partial<Parameters<typeof buildBriefing>[0]> = {}): DailyBriefing =>
  buildBriefing({ today: TODAY, ...empty, ...over })

// ---------- nothing at all (a brand-new user) ----------
test('a briefing with no data has no sections and a plain summary', () => {
  const b = briefing()
  assert.equal(b.summary, 'No tasks due today · No journal entries yet')
  assert.equal(b.tasks, null)
  assert.equal(b.habits, null)
  assert.equal(b.savings, null)
  assert.equal(b.trades, null)
  assert.equal(b.journal, null)
})

test('a new user with no data gets a usable empty briefing', () => {
  reset()
  const b = briefing()
  assert.equal(b.today, TODAY)
  assert.equal(b.summary, 'No tasks due today · No journal entries yet')
  for (const section of [b.tasks, b.habits, b.savings, b.trades, b.journal]) assert.equal(section, null)
})

// ---------- tasks ----------
test('tasks due today are listed, sorted by priority', () => {
  reset()
  const b = briefing({
    tasks: [
      task(1, TODAY, { priority: 'medium' }),
      task(2, TODAY, { priority: 'medium' }),
      task(3, TODAY, { priority: 'high' }),
      task(4, TODAY, { priority: 'low' })
    ]
  })
  assert.ok(b.tasks !== null)
  assert.equal(b.tasks!.due.length, 4)
  assert.equal(b.tasks!.due[0].id, 3)
  assert.equal(b.tasks!.due[3].id, 4)
  assert.equal(b.tasks!.overdue.length, 0)
})

test('overdue tasks are listed, sorted by due date', () => {
  reset()
  const b = briefing({
    tasks: [
      task(1, '2026-10-21'),
      task(2, '2026-10-20'),
      task(3, TODAY) // due today, not overdue
    ]
  })
  assert.ok(b.tasks !== null)
  assert.equal(b.tasks!.overdue.length, 2)
  assert.equal(b.tasks!.overdue[0].id, 2)
  assert.equal(b.tasks!.overdue[1].id, 1)
  assert.equal(b.tasks!.due.length, 1)
})

test('done tasks are ignored for due/overdue but count for completed-this-week', () => {
  reset()
  // TODAY is Friday 2026-10-23. Week is Mon 2026-10-19 to Sun 2026-10-25.
  const b = briefing({
    tasks: [
      task(1, TODAY, { status: 'done' }),
      task(2, TODAY),
      task(3, '2026-10-19', { completedAt: '2026-10-20T10:00:00.000Z', status: 'done' })
    ]
  })
  assert.ok(b.tasks !== null)
  assert.equal(b.tasks!.due.length, 1)
  assert.equal(b.tasks!.due[0].id, 2)
  assert.equal(b.tasks!.overdue.length, 0)
  assert.equal(b.tasks!.doneThisWeek.length, 1)
  assert.equal(b.tasks!.doneThisWeek[0].id, 3)
})

test('tasks completed next week are not in doneThisWeek', () => {
  reset()
  const b = briefing({ tasks: [task(1, null, { completedAt: '2026-10-26T10:00:00.000Z', status: 'done' })] })
  assert.equal(b.tasks, null)
})

test('a completedAt timestamp is matched on its local day, not UTC', () => {
  reset()
  // 2026-10-22T23:00:00-07:00 is 2026-10-23 06:00 UTC — the LOCAL day of completion is 2026-10-22.
  // (new Date('2026-10-22T23:00:00-07:00') gives a UTC instant; the briefing compares the wall-clock date.)
  const lateNight = task(1, null, { completedAt: '2026-10-23T05:30:00.000+05:30', status: 'done' })
  const b = briefing({ tasks: [lateNight] })
  assert.ok(b.tasks !== null)
  assert.equal(b.tasks!.doneThisWeek.length, 1) // the local day 2026-10-22 or 2026-10-23 both sit in this week
})

test('tasks is null when there are no tasks at all', () => {
  reset()
  assert.equal(briefing().tasks, null)
})

// ---------- habits ----------
test('habits scheduled today are listed with their streak', () => {
  reset()
  const h = habit('Read', EVERY, ['2026-10-21', '2026-10-22', TODAY])
  const b = briefing({ habits: [h] })
  assert.ok(b.habits !== null)
  assert.equal(b.habits!.due, 1)
  assert.equal(b.habits!.done, 1)
  assert.equal(b.habits!.items.length, 1)
  assert.equal(b.habits!.items[0].name, 'Read')
  assert.equal(b.habits!.items[0].done, true)
  assert.equal(b.habits!.items[0].schedule, 'Every day')
  assert.equal(b.habits!.items[0].current, 3)
  assert.equal(b.habits!.label, '1 of 1 done')
})

test('unfinished habits come first', () => {
  reset()
  const done = habit('Done one', EVERY, [TODAY])
  const todo = habit('Todo one', EVERY, [])
  const b = briefing({ habits: [done, todo] })
  assert.ok(b.habits !== null)
  assert.deepEqual(b.habits!.items.map((i) => [i.name, i.done]), [['Todo one', false], ['Done one', true]])
})

test('habits not scheduled today are not listed and not due, but still count', () => {
  reset()
  const weekend = habit('Fun', WEEKEND, [])
  const b = briefing({ habits: [weekend] })
  assert.ok(b.habits !== null)
  assert.equal(b.habits!.due, 0)
  assert.equal(b.habits!.items.length, 0)
  assert.equal(b.habits!.total, 1)
  assert.equal(b.habits!.label, '1 habit, none due today')
})

test('archived habits are ignored completely', () => {
  reset()
  const archived = { ...habit('Old', EVERY, []), archived: true }
  const active = habit('Now', EVERY, [])
  const b = briefing({ habits: [archived, active] })
  assert.ok(b.habits !== null)
  assert.equal(b.habits!.total, 1)
})

test('a habit checked on a rest day does not count as done today', () => {
  reset()
  // TODAY is Friday. Checked Saturday 2026-10-24 — a rest day, and in the future relative to TODAY.
  const h = habit('Read', WEEKDAYS, ['2026-10-24'])
  const b = briefing({ habits: [h] })
  assert.ok(b.habits !== null)
  assert.equal(b.habits!.due, 1)
  assert.equal(b.habits!.done, 0)
  assert.equal(b.habits!.items[0].done, false)
})

test('current streak is correct for a habit due today but not done', () => {
  reset()
  const h = habit('Gym', WEEKDAYS, ['2026-10-21', '2026-10-22'])
  const b = briefing({ habits: [h] })
  assert.ok(b.habits !== null)
  assert.equal(b.habits!.items[0].current, 2) // today unchecked does not break it (the day is not over)
})

test('habits is null when there are no habits', () => {
  reset()
  assert.equal(briefing().habits, null)
})

// ---------- savings ----------
test('savings shows goal balances and progress percents', () => {
  reset()
  const g1 = goal('Trip', 1000)
  const g2 = goal('Car', null)
  const b = briefing({ goals: [g1, g2], txs: [tx(g1, '2026-10-20', 'deposit', 300)] })
  assert.ok(b.savings !== null)
  // goal.balance comes from the caller (computed by the query layer); here we emulate it directly.
  const withBalances = briefing({ goals: [{ ...g1, balance: 300 }, g2] })
  assert.equal(withBalances.savings!.totalBalance, 300)
  assert.deepEqual(withBalances.savings!.goals.map((g) => [g.name, g.percent]), [['Trip', 30], ['Car', null]])
  assert.equal(b.savings!.goals.length, 2)
})

test('last deposit is the most recent deposit up to today', () => {
  reset()
  const g = goal('Trip')
  const b = briefing({
    goals: [g], txs: [
      tx(g, '2026-10-20', 'deposit', 50),
      tx(g, '2026-10-22', 'deposit', 100)
    ]
  })
  assert.ok(b.savings !== null)
  assert.deepEqual(b.savings!.lastDeposit, { goalName: 'Trip', amount: 100, date: YESTERDAY })
})

test('a deposit dated in the future does not become the last deposit', () => {
  reset()
  const g = goal('Trip')
  const b = briefing({
    goals: [g], txs: [
      tx(g, '2026-10-20', 'deposit', 50),
      tx(g, '2026-10-30', 'deposit', 999)
    ]
  })
  assert.ok(b.savings !== null)
  assert.equal(b.savings!.lastDeposit!.amount, 50)
})

test('withdrawals never become the last deposit', () => {
  reset()
  const g = goal('Trip')
  const b = briefing({ goals: [g], txs: [tx(g, YESTERDAY, 'withdrawal', 25)] })
  assert.ok(b.savings !== null)
  assert.equal(b.savings!.lastDeposit, null)
})

test('savings is null when there are no goals', () => {
  reset()
  assert.equal(briefing().savings, null)
})

// ---------- trades ----------
test('open trades are listed, newest first', () => {
  reset()
  const older = { ...trade('2026-10-20', 100, null), id: 7 }
  const newer = { ...trade(TODAY, 105, null), id: 9 }
  const b = briefing({ trades: [newer, older] })
  assert.ok(b.trades !== null)
  assert.equal(b.trades!.open.length, 2)
  assert.deepEqual(b.trades!.open.map((t) => t.id), [9, 7])
})

test('yesterday result is the sum of closed trades dated yesterday', () => {
  reset()
  const b = briefing({
    trades: [
      trade(YESTERDAY, 100, 110),   // +10
      trade(YESTERDAY, 100, 90),    // -10
      trade(TODAY, 100, 120)        // today: ignored
    ]
  })
  assert.ok(b.trades !== null)
  assert.deepEqual(b.trades!.yesterdayResult, { pnl: 0, count: 2 })
})

test('yesterday result is negative for a losing day', () => {
  reset()
  const b = briefing({ trades: [trade(YESTERDAY, 100, 90)] })
  assert.ok(b.trades !== null)
  assert.deepEqual(b.trades!.yesterdayResult, { pnl: -10, count: 1 })
})

test('a briefing with no open trades but a closed trade from yesterday still shows trades', () => {
  reset()
  const b = briefing({ trades: [
    trade('2026-10-20', 100, 110),
    trade(TODAY, 100, 120)
  ] })
  assert.equal(b.trades, null)
})

test('trades is null when nothing is open and nothing closed yesterday', () => {
  reset()
  assert.equal(briefing().trades, null)
})

// ---------- journal ----------
test('yesterday mood is shown when yesterday had an entry with a mood', () => {
  reset()
  const b = briefing({ entries: [entry(YESTERDAY, 'good')] })
  assert.ok(b.journal !== null)
  assert.deepEqual(b.journal!.yesterdayMood, { mood: 'good', average: 4, date: YESTERDAY })
})

test('yesterday mood averages multiple entries and rounds to the nearest mood word', () => {
  reset()
  const b = briefing({ entries: [entry(YESTERDAY, 'great'), entry(YESTERDAY, 'okay')] })
  assert.ok(b.journal !== null)
  assert.equal(b.journal!.yesterdayMood!.average, 4) // (5+3)/2
  assert.equal(b.journal!.yesterdayMood!.mood, 'good')
})

test('yesterday mood ignores entries without a mood', () => {
  reset()
  const b = briefing({ entries: [entry(YESTERDAY, null)] })
  assert.ok(b.journal !== null)
  assert.equal(b.journal!.yesterdayMood, null)
  assert.ok(b.journal!.lastEntry !== null) // the entry itself is still the last one
})

test('last entry is the newest entry up to today', () => {
  reset()
  const b = briefing({
    entries: [
      entry('2026-10-20', 'good', 'Monday-ish'),
      entry(YESTERDAY, 'rough', 'Wednesday')
    ]
  })
  assert.ok(b.journal !== null)
  assert.deepEqual(
    { title: b.journal!.lastEntry!.title, mood: b.journal!.lastEntry!.mood, date: b.journal!.lastEntry!.date },
    { title: 'Wednesday', mood: 'rough', date: YESTERDAY })
})

test('automation drafts do not replace the last written journal entry or mood', () => {
  reset()
  const draft = { ...entry(TODAY, 'rough', 'Automation draft'), tags: ['automation'] }
  const b = briefing({ entries: [entry(YESTERDAY, 'good', 'Written entry'), draft] })
  assert.ok(b.journal !== null)
  assert.equal(b.journal!.lastEntry!.title, 'Written entry')
  assert.equal(b.journal!.yesterdayMood!.mood, 'good')
})

test('journal is null when there are no entries at all', () => {
  reset()
  assert.equal(briefing().journal, null)
})

test('journal appears with just a last entry, even without yesterday mood', () => {
  reset()
  const b = briefing({ entries: [entry('2026-10-20', null, 'Old note')] })
  assert.ok(b.journal !== null)
  assert.equal(b.journal!.yesterdayMood, null)
  assert.equal(b.journal!.lastEntry!.title, 'Old note')
})

// ---------- summary line ----------
test('summary line mentions tasks, habits left, trades, mood and savings', () => {
  reset()
  const g = goal('Trip', 500)
  const b = briefing({
    tasks: [task(1, TODAY, { priority: 'high' })],
    habits: [habit('Read', EVERY, [])],
    trades: [trade(TODAY, 100, null)],
    entries: [entry(YESTERDAY, 'good')],
    goals: [g],
    txs: [tx(g, '2026-10-20', 'deposit', 50)]
  })
  assert.match(b.summary, /1 task due today/)
  assert.match(b.summary, /1 habit left today/)
  assert.match(b.summary, /1 open trade/)
  assert.match(b.summary, /Yesterday was "good"/)
  assert.match(b.summary, /last deposit 50\.00/)
})

test('summary line names overdue tasks when there are also tasks due', () => {
  reset()
  const b = briefing({ tasks: [task(1, TODAY), task(2, '2026-10-20')] })
  assert.match(b.summary, /^1 task due and 1 overdue/)
})

test('summary line mentions only overdue when nothing is due today', () => {
  reset()
  const b = briefing({ tasks: [task(1, '2026-10-20')] })
  assert.match(b.summary, /1 overdue task/)
})

test('summary line uses plural forms', () => {
  reset()
  const b = briefing({
    tasks: [task(1, TODAY), task(2, '2026-10-19')],
    habits: [habit('Read', EVERY, []), habit('Walk', EVERY, [])],
    trades: [trade(TODAY, 100, null), trade('2026-10-22', 100, null)]
  })
  assert.match(b.summary, /^1 task due and 1 overdue/)
  assert.match(b.summary, /2 habits left today/)
  assert.match(b.summary, /2 open trades/)
})

test('summary line reports a profitable and a losing yesterday in words', () => {
  reset()
  const up = briefing({ trades: [trade(YESTERDAY, 100, 125)] })
  assert.ok(up.trades !== null)
  assert.match(up.summary, /Yesterday's trade closed 25\.00 up/)
  const down = briefing({ trades: [trade(YESTERDAY, 100, 75)] })
  assert.match(down.summary, /Yesterday's trade closed 25\.00 down/)
})

test('summary line falls back to savings alone when nothing else has data', () => {
  reset()
  const g = goal('Trip')
  const b = briefing({ goals: [g] })
  assert.match(b.summary, /0\.00 across 1 goal/)
})

// ---------- presence rules ----------
test('each section is independent: data in one does not create another', () => {
  reset()
  const g = goal('Trip')
  const b = briefing({ goals: [g], txs: [] })
  assert.equal(b.tasks, null)
  assert.equal(b.habits, null)
  assert.ok(b.savings !== null)
  assert.equal(b.trades, null)
  assert.equal(b.journal, null)
})

test('sections all appear together when every tool has something', () => {
  reset()
  const g = goal('Trip', 100)
  const b = briefing({
    tasks: [task(1, TODAY)],
    habits: [habit('Read', EVERY, [])],
    trades: [trade(YESTERDAY, 100, null)],
    entries: [entry(YESTERDAY, 'okay')],
    goals: [g],
    txs: [tx(g, YESTERDAY, 'deposit', 10)]
  })
  for (const s of [b.tasks, b.habits, b.savings, b.trades, b.journal]) assert.ok(s !== null)
})

// ---------- pure helpers ----------
test('moodNear maps averages to mood words', () => {
  assert.equal(moodNear(5), 'great')
  assert.equal(moodNear(4), 'good')
  assert.equal(moodNear(3), 'okay')
  assert.equal(moodNear(2), 'low')
  assert.equal(moodNear(1), 'rough')
  assert.equal(moodNear(2.4), 'low')
  assert.equal(moodNear(2.6), 'okay')
})

test('briefingSummary with all-null sections is the empty message', () => {
  assert.equal(briefingSummary({ tasks: null, habits: null, savings: null, trades: null, journal: null }),
    'No tasks due today · No journal entries yet')
})

test('section functions can be called directly', () => {
  reset()
  assert.deepEqual(tasksToday([], TODAY), null)
  assert.equal(habitsToday([], TODAY), null)
  assert.equal(savingsToday([], [], TODAY), null)
  assert.equal(tradesToday([], TODAY), null)
  assert.equal(journalToday([], TODAY), null)
})

// ---------- timezone edge case: yesterday is computed locally, not from Date parsing ----------
test('prevDay-style yesterday rolls back over a month boundary', () => {
  reset()
  const monthStart = '2026-11-01'
  const b = buildBriefing({ today: monthStart, trades: [trade('2026-10-31', 100, 130)], tasks: [], habits: [], goals: [], txs: [], entries: [] })
  assert.ok(b.trades !== null)
  assert.deepEqual(b.trades!.yesterdayResult, { pnl: 30, count: 1 })
})

console.log(`\n${n} briefing checks passed`)
