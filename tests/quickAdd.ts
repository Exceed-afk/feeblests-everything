// Checks for the natural-language quick-add parser (src/shared/quickAdd.ts). No database needed:
//   npm test        (tsx tests/quickAdd.ts runs as part of that)
import assert from 'node:assert/strict'
import {
  parseQuickAdd, parseRelativeDate, parseRecurrence, matchName, describeProposal,
  type QuickAddProposal
} from '../src/shared/quickAdd'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const TODAY = '2026-10-23' // a Friday

const parse = (text: string, over: Partial<Parameters<typeof parseQuickAdd>[1]> = {}) =>
  parseQuickAdd(text, { today: TODAY, ...over })

const prop = (text: string, over?: Partial<Parameters<typeof parseQuickAdd>[1]>): QuickAddProposal => {
  const r = parse(text, over)
  assert.ok(r.ok, `expected "${text}" to parse: ${!r.ok ? r.error : ''}`)
  return (r as { parse: { proposal: QuickAddProposal } }).parse.proposal
}

const fails = (text: string) => {
  const r = parse(text)
  assert.ok(!r.ok, `expected "${text}" to be rejected`)
  return (r as { error: string }).error
}

// ---------- deposits ----------
test('deposit 200 to vacation fund', () => {
  const p = prop('deposit 200 to vacation fund', { goalNames: ['Vacation fund'] })
  assert.deepEqual(p, { kind: 'deposit', txKind: 'deposit', amount: 200, goalName: 'Vacation fund', note: '' })
})

test('add 25.50 into trip fund — decimals and synonyms work', () => {
  const p = prop('add 25.50 into trip fund', { goalNames: ['Trip fund'] })
  assert.equal(p.kind, 'deposit')
  assert.ok(p.kind === 'deposit' && p.amount === 25.5)
})

test('withdraw 10 from car goal makes a withdrawal', () => {
  const p = prop('withdraw 10 from car', { goalNames: ['Car'] })
  assert.ok(p.kind === 'deposit' && p.txKind === 'withdrawal')
})

test('a deposit with a note keeps the note', () => {
  const p = prop('deposit 50 to emergency for the dentist', { goalNames: ['Emergency'] })
  assert.ok(p.kind === 'deposit' && p.note === 'the dentist')
})

test('a currency symbol is ignored', () => {
  const p = prop('deposit $120 to holiday', { goalNames: ['Holiday'] })
  assert.ok(p.kind === 'deposit' && p.amount === 120)
})

test('an unknown goal still proposes, but asks first (medium confidence)', () => {
  const r = parse('deposit 80 to mystery fund', { goalNames: ['Vacation fund'] })
  assert.ok(r.ok)
  assert.equal((r as { parse: { confidence: string } }).parse.confidence, 'medium')
})

test('an amount of 0 or negative-shaped input is rejected', () => {
  fails('deposit 0 to fund')
  fails('deposit to fund')
})

test('save/put also make deposits', () => {
  for (const verb of ['save 10 to emergency', 'put 10 to emergency']) {
    const p = prop(verb, { goalNames: ['Emergency'] })
    assert.ok(p.kind === 'deposit')
  }
})

// ---------- tasks ----------
test('task call dentist friday high priority', () => {
  const p = prop('task call dentist friday high priority')
  assert.ok(p.kind === 'task')
  assert.ok(p.kind === 'task' && p.title === 'call dentist')
  assert.ok(p.kind === 'task' && p.dueDate === '2026-10-30') // next Friday after Friday 2026-10-23
  assert.ok(p.kind === 'task' && p.priority === 'high')
  assert.ok(p.kind === 'task' && p.recurrence === null)
})

test('task pay rent every month on the 1st is a recurring task', () => {
  const p = prop('task pay rent every month on the 1st')
  assert.ok(p.kind === 'task' && p.recurrence !== null)
  assert.ok(p.kind === 'task' && p.recurrence.frequency === 'monthly')
  assert.ok(p.kind === 'task' && p.title === 'pay rent')
})

test('task water plants weekly is weekly', () => {
  const p = prop('task water plants weekly')
  assert.ok(p.kind === 'task' && p.recurrence !== null && p.recurrence.frequency === 'weekly')
})

test('task stretch every 3 days is a custom interval', () => {
  const p = prop('task stretch every 3 days')
  assert.ok(p.kind === 'task' && p.recurrence !== null)
  assert.ok(p.kind === 'task' && p.recurrence.frequency === 'custom' && p.recurrence.intervalDays === 3)
})

test('bare weekdays in a recurring phrase do not become a date', () => {
  const p = prop('task report every monday')
  assert.ok(p.kind === 'task' && p.recurrence !== null && p.recurrence.frequency === 'weekly')
  assert.ok(p.kind === 'task' && p.title === 'report')
})

test('a task without a date gets none and medium confidence', () => {
  const r = parse('task buy stamps')
  assert.ok(r.ok)
  const { proposal, confidence } = (r as { parse: { proposal: QuickAddProposal; confidence: string } }).parse
  assert.ok(proposal.kind === 'task' && proposal.dueDate === null)
  assert.equal(confidence, 'medium')
})

test('relative dates on tasks', () => {
  assert.ok(prop('task file taxes today').kind === 'task')
  const t = prop('task file taxes today')
  assert.ok(t.kind === 'task' && t.dueDate === TODAY)
  const tm = prop('task book flight tomorrow')
  assert.ok(tm.kind === 'task' && tm.dueDate === '2026-10-24')
  const in3 = prop('task submit report in 3 days')
  assert.ok(in3.kind === 'task' && in3.dueDate === '2026-10-26')
  const nextMon = prop('task review budget next monday')
  assert.ok(nextMon.kind === 'task' && nextMon.dueDate === '2026-11-02') // Monday of next week (forceNextWeek)
})

test('priority word orders', () => {
  assert.ok(prop('task email boss high').kind === 'task')
  assert.ok(prop('task email boss priority low').kind === 'task')
  const a = prop('task email boss high')
  const b = prop('task email boss priority low')
  assert.ok(a.kind === 'task' && a.priority === 'high')
  assert.ok(b.kind === 'task' && b.priority === 'low')
})

test('task modifiers parse date, 12/24-hour time, tags, project and priority', () => {
  const parsed = prop('task pay rent tomorrow 5pm #home #bills project:House high')
  assert.ok(parsed.kind === 'task')
  if (parsed.kind === 'task') {
    assert.equal(parsed.title, 'pay rent')
    assert.equal(parsed.dueDate, '2026-10-24')
    assert.equal(parsed.dueTime, '17:00')
    assert.deepEqual(parsed.tags, ['home', 'bills'])
    assert.equal(parsed.project, 'House')
    assert.equal(parsed.priority, 'high')
  }
  const twentyFourHour = prop('task call at 14:30 project:"Home Repairs"')
  assert.ok(twentyFourHour.kind === 'task')
  if (twentyFourHour.kind === 'task') {
    assert.equal(twentyFourHour.dueTime, '14:30')
    assert.equal(twentyFourHour.project, 'Home Repairs')
    assert.equal(twentyFourHour.title, 'call at')
  }
})

test('task with nothing after the keyword is rejected with guidance', () => {
  fails('task')
  fails('task   ')
})

// ---------- habit check-ins ----------
test('habit check in meditation', () => {
  const p = prop('habit check in meditation', { habitNames: ['Meditation'] })
  assert.deepEqual(p, { kind: 'habit-checkin', habitName: 'Meditation' })
})

test('habit check in off variants', () => {
  for (const phrase of ['habit checkin meditation', 'habit check off meditation', 'checked meditation', 'did meditation']) {
    const p = prop(phrase, { habitNames: ['Meditation'] })
    assert.ok(p.kind === 'habit-checkin')
  }
})

test('habit partial match works when unique', () => {
  const p = prop('habit check in medi', { habitNames: ['Meditation', 'Reading'] })
  assert.ok(p.kind === 'habit-checkin' && p.habitName === 'Meditation')
})

test('ambiguous habit prefix asks instead of guessing (medium confidence)', () => {
  const r = parse('habit check in m', { habitNames: ['Meditation', 'Mobility'] })
  assert.ok(r.ok)
  assert.equal((r as { parse: { confidence: string } }).parse.confidence, 'medium')
})

test('habit check in with no habits configured still proposes the typed name', () => {
  const p = prop('habit check in meditation')
  assert.ok(p.kind === 'habit-checkin' && p.habitName === 'meditation')
})

// ---------- notes ----------
test('note feeling tired today', () => {
  const p = prop('note feeling tired today')
  assert.deepEqual(p, { kind: 'note', title: 'feeling tired today', body: '' })
})

test('note with a sentence break splits title and body', () => {
  const p = prop('note idea: voice memo app. Try recording on the walk home')
  assert.ok(p.kind === 'note' && p.title === 'idea' && p.body === 'voice memo app. Try recording on the walk home')
})

// ---------- ambiguity and rejections ----------
test('a bare sentence with no keyword is rejected with guidance', () => {
  const err = fails('feeling tired today')
  assert.match(err, /note|task|deposit|habit/)
})

test('something that starts like a deposit but has no amount falls through politely', () => {
  // "add" alone is not a deposit: with no amount and no target it is rejected with the guidance.
  const err = fails('add something to the pile')
  assert.match(err, /note|task|deposit|habit/)
})

test('typos in keywords do not half-match', () => {
  fails('tsak call dentist')
  fails('deposot 50 to fund')
  fails('habt check in meditation')
})

test('empty input is rejected', () => {
  fails('')
  fails('   ')
})

test('just a keyword with nothing else is rejected or asks for a name', () => {
  fails('deposit')
  fails('habit')
})

test('whitespace and capitalisation do not matter', () => {
  const a = prop('Deposit 200 to Vacation Fund', { goalNames: ['Vacation Fund'] })
  const b = prop('   DEPOSIT     200     to vacation fund  ', { goalNames: ['Vacation Fund'] })
  assert.ok(a.kind === 'deposit' && b.kind === 'deposit' && a.kind === b.kind)
  assert.ok(a.kind === 'deposit' && b.kind === 'deposit' && a.amount === b.amount)
})

// ---------- date helpers (local dates, month and year boundaries) ----------
test('relative dates cross month and year boundaries safely', () => {
  assert.equal(parseRelativeDate('due tomorrow', '2026-10-31')!.iso, '2026-11-01')
  assert.equal(parseRelativeDate('due tomorrow', '2026-12-31')!.iso, '2027-01-01')
  assert.equal(parseRelativeDate('in 3 days', '2026-02-27')!.iso, '2026-03-02') // 2026 is not a leap year
  assert.equal(parseRelativeDate('in 3 days', '2028-02-27')!.iso, '2028-03-01') // 2028 is
})

test('next monday always lands on a Monday, next week when today is Monday', () => {
  assert.equal(parseRelativeDate('x next monday', '2026-10-23')!.iso, '2026-11-02')
  assert.equal(parseRelativeDate('x next monday', '2026-10-26')!.iso, '2026-11-02')
})

test('a bare weekday means the next such day, including later this week', () => {
  assert.equal(parseRelativeDate('dentist friday', '2026-10-23')!.iso, '2026-10-30') // today is Friday
  assert.equal(parseRelativeDate('dentist monday', '2026-10-23')!.iso, '2026-10-26')
})

test('recurrence parsing picks the right frequency', () => {
  assert.equal(parseRecurrence('pay rent every month on the 1st')!.recurrence.frequency, 'monthly')
  assert.equal(parseRecurrence('jog daily')!.recurrence.frequency, 'daily')
  assert.equal(parseRecurrence('clean every 2 weeks')!.recurrence.frequency, 'weekly')
  assert.equal(parseRecurrence('stretch every 3 days')!.recurrence.frequency, 'custom')
  assert.equal(parseRecurrence('just a task')!, null)
})

// ---------- name matching ----------
test('matchName: exact, unique prefix, ambiguous, none', () => {
  const names = ['Emergency', 'Vacation fund', 'Vacation 2027']
  assert.equal(matchName('vacation fund', names), 'Vacation fund')
  assert.equal(matchName('emer', names), 'Emergency')
  assert.equal(matchName('vacation', names), null) // two matches: ambiguous
  assert.equal(matchName('nope', names), null)
  assert.equal(matchName('', names), null)
  assert.equal(matchName('x'), null)
})

// ---------- preview wording ----------
test('describeProposal writes a full sentence the preview card can show', () => {
  assert.equal(describeProposal({ kind: 'deposit', txKind: 'deposit', amount: 200, goalName: 'Vacation fund', note: '' }),
    'Deposit of 200 to Vacation fund')
  assert.equal(describeProposal({ kind: 'task', title: 'pay rent', dueDate: null, dueTime: null, priority: 'medium', project: null, tags: [], recurrence: { frequency: 'monthly', intervalDays: 1 } }),
    'Task: pay rent (repeats monthly)')
  assert.equal(describeProposal({ kind: 'task', title: 'call dentist', dueDate: '2026-10-30', dueTime: null, priority: 'high', project: null, tags: [], recurrence: null }),
    'Task: call dentist (due 2026-10-30, high priority)')
  assert.equal(describeProposal({ kind: 'habit-checkin', habitName: 'Meditation' }), 'Check in habit: Meditation')
  assert.equal(describeProposal({ kind: 'note', title: 'feeling tired', body: '' }), 'Note: feeling tired')
})

console.log(`\n${n} quick-add checks passed`)
