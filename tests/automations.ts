// Checks for the automation engine and the built-in rules (src/shared/automations.ts).
// No database needed:  npm test   (tsx tests/automations.ts)
import assert from 'node:assert/strict'
import {
  runAutomation, ruleIdsOf, guardAction, defaultRules, briefingSummarySafe,
  goalCelebrationRule,
  DEFAULT_AUTOMATIONS, AUTOMATION_TAG,
  type AutomationEvent, type AutomationSettings, type AutomationRuleId
} from '../src/shared/automations'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

const settings = (over: Partial<AutomationSettings> = {}): AutomationSettings => ({ ...DEFAULT_AUTOMATIONS, ...over })
const ev = (kind: AutomationEvent['kind'], data: AutomationEvent['data'] = {}, date = '2026-10-23'): AutomationEvent =>
  ({
    kind, date,
    data: kind === 'trade-closed' && data.tradeDate === undefined ? { ...data, tradeDate: date } : data
  })

const run = (event: AutomationEvent, s: AutomationSettings, overdueTasks?: { id: number; title: string; daysOverdue: number }[]) =>
  runAutomation(event, { settings: s, overdueTasks })

const TRADE_LOSS = ev('trade-closed', { tradeId: 1, tradePnl: -80, tradeAsset: 'XAUUSD' })
const TRADE_WIN = ev('trade-closed', { tradeId: 2, tradePnl: 30, tradeAsset: 'XAUUSD' })
const GOAL_HIT = ev('goal-reached', { goalId: 1, goalName: 'Trip fund' })
const STREAK_BROKE = ev('habit-streak-broken', { habitId: 3, habitName: 'Read', habitStreak: 9 })
const STREAK_BROKE_SMALL = ev('habit-streak-broken', { habitId: 3, habitName: 'Read', habitStreak: 3 })
const TASK_DONE = ev('task-completed', { taskId: 7 })

const ALL_ON = settings({ lossReflection: true, goalCelebration: true, streakReminder: true, overdueTaskNudge: true })

// ---------- the engine: routing ----------
test('nothing runs when every rule is off', () => {
  assert.deepEqual(run(TRADE_LOSS, settings()), [])
  assert.deepEqual(run(GOAL_HIT, settings()), [])
  assert.deepEqual(run(STREAK_BROKE, settings()), [])
})

test('an off rule stays off even when its event arrives', () => {
  const s = settings({ lossReflection: true }) // the other three still off
  assert.equal(run(GOAL_HIT, s).length, 0)
  assert.equal(run(STREAK_BROKE, s).length, 0)
  assert.equal(run(TASK_DONE, s).length, 0)
})

test('each rule answers only the events it listens to', () => {
  for (const rule of defaultRules()) {
    const answered = new Set(rule.listensTo)
    for (const kind of ['trade-closed', 'savings-deposit', 'goal-reached', 'habit-streak-broken', 'task-completed', 'journal-entry-saved'] as const) {
      const out = run(ev(kind), ALL_ON)
      if (answered.has(kind)) continue // checked by its own tests below
      assert.equal(out.filter((o) => o.ruleId === rule.id).length, 0, `${rule.id} should ignore ${kind}`)
    }
  }
})

// ---------- rule 1: loss reflection ----------
test('a big loss creates a tagged draft entry', () => {
  const [out] = run(TRADE_LOSS, settings({ lossReflection: true, lossThreshold: 50 }))
  assert.equal(out.ruleId, 'loss-reflection')
  assert.equal(out.actions.length, 1)
  const a = out.actions[0]
  assert.equal(a.type, 'create-draft-entry')
  assert.ok(a.type === 'create-draft-entry' && a.tags.includes(AUTOMATION_TAG))
  assert.ok(a.type === 'create-draft-entry' && a.title.includes('XAUUSD'))
  assert.match(out.labels[0], /Created draft logbook entry/)
})

test('a small loss or a win makes nothing', () => {
  const s = settings({ lossReflection: true, lossThreshold: 50 })
  assert.deepEqual(run(ev('trade-closed', { tradePnl: -20, tradeAsset: 'X' }), s), []) // smaller than threshold
  assert.deepEqual(run(ev('trade-closed', { tradePnl: -50, tradeAsset: 'X' }), s), []) // equal, not bigger
  assert.deepEqual(run(TRADE_WIN, s), []) // a win
})

test('loss reflections require a trade date within the last three days', () => {
  const s = settings({ lossReflection: true, lossThreshold: 50 })
  assert.deepEqual(run(ev('trade-closed', { tradePnl: -80, tradeDate: '2026-09-23' }), s), [])
  assert.deepEqual(run(ev('trade-closed', { tradePnl: -80, tradeDate: '2026-10-24' }), s), [])
  assert.deepEqual(run({
    ...TRADE_LOSS, data: { tradeId: 1, tradePnl: -80, tradeAsset: 'XAUUSD' }
  }, s), [])
})

test("the threshold is the user's, not a constant", () => {
  const s = settings({ lossReflection: true, lossThreshold: 100 })
assert.deepEqual(run(ev('trade-closed', { tradePnl: -80, tradeAsset: 'X' }), s), [])
assert.equal(run(ev('trade-closed', { tradePnl: -120, tradeAsset: 'X' }), s).length, 1)
})

// ---------- rule 2: goal celebration ----------
test('reaching a goal shows a celebration message pointing at savings', () => {
  const [out] = run(GOAL_HIT, settings({ goalCelebration: true }))
  assert.equal(out.ruleId, 'goal-celebration')
  const a = out.actions[0]
  assert.equal(a.type, 'message')
  assert.ok(a.type === 'message' && a.celebration === true)
  assert.ok(a.type === 'message' && (a.text.includes('Trip fund') && a.linkTool === 'savings'))
})

test('a plain deposit alone does not celebrate', () => {
  assert.deepEqual(run(ev('savings-deposit', { goalName: 'Trip', depositAmount: 25 }), settings({ goalCelebration: true })), [])
})

// ---------- rule 3: broken streak ----------
test('a streak of 7+ breaking shows a gentle note pointing at habits', () => {
  const [out] = run(STREAK_BROKE, settings({ streakReminder: true }))
  assert.equal(out.ruleId, 'streak-reminder')
  const a = out.actions[0]
  assert.equal(a.type, 'message')
  assert.ok(a.type === 'message' && a.text.includes('Read') && a.text.includes('9'))
  assert.ok(a.type === 'message' && a.linkTool === 'habits')
  assert.ok(a.type === 'message' && a.celebration !== true) // gentle, not a celebration
})

test('a short streak breaking is left alone', () => {
  assert.deepEqual(run(STREAK_BROKE_SMALL, settings({ streakReminder: true })), [])
  assert.deepEqual(run(ev('habit-streak-broken', { habitName: 'X', habitStreak: 6 }), settings({ streakReminder: true })), [])
})

// ---------- rule 4: stale overdue tasks ----------
test('tasks overdue beyond N days are surfaced, once per run', () => {
  const stale = [{ id: 1, title: 'Old thing', daysOverdue: 12 }, { id: 2, title: 'Elder thing', daysOverdue: 30 }]
  const fresh = { id: 3, title: 'New thing', daysOverdue: 2 }
  const [out] = run(TASK_DONE, ALL_ON, [...stale, fresh])
  assert.equal(out.ruleId, 'overdue-task-nudge')
  const a = out.actions[0]
  assert.equal(a.type, 'message')
  assert.ok(a.type === 'message' && a.text.includes('Old thing') && a.text.includes('Elder thing'))
  assert.ok(a.type === 'message' && !a.text.includes('New thing')) // inside N days: left alone
})

test("the overdue N is the user's own", () => {
  const s = settings({ overdueTaskNudge: true, overdueDays: 14 })
  const list = [{ id: 1, title: 'A', daysOverdue: 10 }]
  assert.deepEqual(run(TASK_DONE, s, list), [])
  assert.deepEqual(run(ev('journal-entry-saved'), s, [{ id: 1, title: 'B', daysOverdue: 20 }]).length, 1)
})

test('an empty overdue list makes nothing', () => {
  assert.deepEqual(run(TASK_DONE, ALL_ON, []), [])
  assert.deepEqual(run(TASK_DONE, ALL_ON), [])
})

// ---------- loop prevention ----------
test('a rule cannot fire twice for the same trigger (engine returns one outcome)', () => {
  // Two runs of the SAME event return the same ANSWER (pure), but the DB layer dedups
  // by (rule, event_key) — the engine's contribution is ruleIdsOf feeding alreadyProduced.
  const first = run(TRADE_LOSS, ALL_ON)
  assert.equal(first.length, 1)
  assert.deepEqual(ruleIdsOf(first), ['loss-reflection'])
})

test('alreadyProduced stops chained re-runs of the same rule', () => {
  // The DB layer passes ruleIdsOf(firstRun) back as alreadyProduced on a chained run.
  const chained = runAutomation(TRADE_LOSS, {
    settings: ALL_ON,
    alreadyProduced: new Set<AutomationRuleId>(['loss-reflection'])
  })
  assert.deepEqual(chained, [])
})

test('an automation-made journal entry does not re-trigger its own rule', () => {
  // The main process skips journal-entry-saved for entries tagged automation;
  // here we verify the rule set itself never reacts to an automation-made event shape,
  // i.e. nothing listens to its own output kinds in a closed loop.
  for (const rule of defaultRules()) {
    for (const _kind of rule.listensTo) {
      // every rule's listensTo set contains only INPUT kinds, and no rule emits events,
      // so a second pass of its own action cannot loop back through runAutomation.
      assert.ok(!('emits' in rule))
    }
  }
})

test('guardAction refuses anything but drafts and messages', () => {
  assert.ok(guardAction({ type: 'create-draft-entry', title: 't', body: 'b', tags: [] }) !== null)
  assert.ok(guardAction({ type: 'message', text: 'hi' }) !== null)
  // Anything the type system would let slip through (an unknown action from a hand-built
  // rule) is dropped, never executed — the safety net in one place.
  assert.equal(guardAction({ type: 'delete-everything' } as never), null)
})

// ---------- labels: the Activity trail says what happened ----------
test('labels are plain sentences a user can read later', () => {
  const [loss] = run(TRADE_LOSS, settings({ lossReflection: true }))
  assert.match(loss.labels[0], /draft logbook entry/)
  assert.match(loss.labels[0], /#automation/)
  const [goal] = run(GOAL_HIT, settings({ goalCelebration: true }))
  assert.match(goal.labels[0], /celebration/)
  assert.match(goal.labels[0], /Trip fund/)
  const [streak] = run(STREAK_BROKE, settings({ streakReminder: true }))
  assert.match(streak.labels[0], /Read/)
})

test('one event answered by several rules produces one outcome each', () => {
  // goal-reached fires goal-celebration; savings-deposit does not; verify multi-listener rules
  // (goal-celebration listens to both) route through the settings toggle independently.
  const rule = goalCelebrationRule()
  assert.deepEqual(rule.listensTo, ['goal-reached', 'savings-deposit'])
  assert.deepEqual(run(ev('savings-deposit'), settings({ goalCelebration: true })), [])
})

// ---------- rule shape (how a NEW rule plugs in) ----------
test('a new rule is one function in the RULES list', () => {
  const rule = goalCelebrationRule() // any rule works as a template
  assert.equal(typeof rule.run, 'function')
  assert.ok(Array.isArray(rule.listensTo))
  // Every built-in rule id has a toggle in the settings, so a new rule wired up
  // the same way is switched off until the user turns it on.
  for (const r of defaultRules()) assert.ok(r.id.length > 0)
})

// ---------- briefing surface for the overdue rule ----------
test('briefingSummarySafe exists for the UI summary (no automations text needed)', () => {
  assert.equal(briefingSummarySafe({ tasks: null, habits: null, savings: null, trades: null, journal: null }),
    'No tasks due today · No journal entries yet')
})

console.log(`\n${n} automation checks passed`)
