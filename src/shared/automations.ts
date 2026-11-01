// The automation ENGINE: pure functions, no database, no Electron, no React.
// A tool emits an event (something the user just did, or a state that appeared);
// each rule says which events it listens to and, given the event plus its
// settings, what to do. Rules may CREATE drafts or SHOW messages — never edit
// or delete anything the user made (see guardAction below).
//
// Events arrive in one at a time through runAutomation(), which returns the
// actions the caller (src/main/automations.ts) should carry out against the
// database. Nothing here touches the network, and nothing is stored except
// what the caller records.
//
// Dates are "YYYY-MM-DD" text, like everywhere else.
import { addDays } from './habits'

// ---------- events ----------
// To add a trigger: add one entry here. To add a rule: write it in RULES below,
// listing the event kinds it answers. One small change each; nothing else moves.

export type AutomationEventKind =
  | 'trade-closed'
  | 'savings-deposit'
  | 'goal-reached'
  | 'habit-streak-broken'
  | 'task-completed'
  | 'journal-entry-saved'

export interface AutomationEventData {
  tradeId?: number
  tradePnl?: number
  tradeAsset?: string
  tradeDate?: string
  goalId?: number
  goalName?: string
  depositAmount?: number
  habitId?: number
  habitName?: string
  habitStreak?: number // the streak it had just BEFORE it broke
  taskId?: number
  entryId?: number
}

export interface AutomationEvent {
  kind: AutomationEventKind
  date: string // the local day the event happened
  data: AutomationEventData
}

// ---------- actions a rule may ask for ----------

export type AutomationAction =
  | { type: 'create-draft-entry'; title: string; body: string; tags: string[] } // an ordinary logbook draft, tagged #automation
  | { type: 'message'; text: string; linkTool?: string; celebration?: boolean }

// ---------- settings ----------
// The four built-in rules, each toggleable. Off by default (steps 3's contract);
// the intelligence page flips these.

export interface AutomationSettings {
  lossReflection: boolean
  lossThreshold: number // a loss (positive number) bigger than this makes the draft entry
  goalCelebration: boolean
  streakReminder: boolean
  overdueTaskNudge: boolean
  overdueDays: number // overdue for MORE than this many days surfaces in the briefing
}

export const DEFAULT_AUTOMATIONS: AutomationSettings = {
  lossReflection: false, lossThreshold: 50,
  goalCelebration: false,
  streakReminder: false,
  overdueTaskNudge: false, overdueDays: 7
}

// ---------- the activity log row shape ----------
// What one fired rule did, as the caller records it (the automation_events table
// holds exactly this). Nothing here is a user's data: these rows describe what
// the AUTOMATION did; hiding one never touches its draft or releases its dedupe claim.

export interface AutomationActivity {
  id: number
  at: string // ISO timestamp, for "what and when"
  rule: string
  label: string // human words, shown in the Activity list
  event: string // the event kind that fired it
  eventKey: string
  entryId: number | null // the draft entry this rule created, if any (easy to delete)
}

// ---------- rules ----------

export type AutomationRuleId = 'loss-reflection' | 'goal-celebration' | 'streak-reminder' | 'overdue-task-nudge'

export interface AutomationRule {
  id: AutomationRuleId
  label: string // settings-page name
  description: string // settings-page explanation
  listensTo: AutomationEventKind[]
  // Decides what, if anything, to do. Pure: same event + settings, same answer.
  // `produced` is the set of action types this run already emitted, used for
  // loop prevention: a rule never answers to an event of its own making.
  run: (event: AutomationEvent, settings: AutomationSettings, ctx: { produced: Set<string>; overdueTasks?: { id: number; title: string; daysOverdue: number }[] }) => AutomationAction[]
}

// The LABEL every automation-made entry carries, so the user can see and search it.
export const AUTOMATION_TAG = 'automation'
export const AUTOMATION_TAG_CLEAN = AUTOMATION_TAG.trim().toLowerCase().replace(/^#+/, '')

export const isAutomationEntry = (entry: { tags: string[] }): boolean =>
  entry.tags.includes(AUTOMATION_TAG_CLEAN)

export function lossReflectionRule(): AutomationRule {
  return {
    id: 'loss-reflection',
    label: 'Loss reflection drafts',
    description: 'When a trade closes at a loss bigger than your threshold, create a draft logbook entry with a reflection prompt.',
    listensTo: ['trade-closed'],
    run: (event, settings) => {
      if (!settings.lossReflection) return []
      if (event.kind !== 'trade-closed') return []
      const tradeDate = event.data.tradeDate
      if (!tradeDate || tradeDate > event.date || tradeDate < addDays(event.date, -3)) return []
      const loss = event.data.tradePnl
      if (loss === undefined || loss >= 0 || -loss <= settings.lossThreshold) return []
      const asset = event.data.tradeAsset ?? 'the trade'
      const fmtNum = (n: number): string => String(Math.round(n * 100) / 100)
      return [{
        type: 'create-draft-entry',
        title: `Loss reflection: ${asset} (${fmtNum(Math.abs(loss))})`,
        body: 'A trade closed bigger than your loss threshold.\n\nWhat was the plan, and where did it leave the plan?\nWhat will you do differently next time?\n\n',
        tags: [AUTOMATION_TAG, 'loss']
      }]
    }
  }
}

export function goalCelebrationRule(): AutomationRule {
  return {
    id: 'goal-celebration',
    label: 'Goal celebrations',
    description: 'When a savings goal reaches its target, show a celebration message and suggest setting a new goal.',
    listensTo: ['goal-reached', 'savings-deposit'],
    run: (event, settings) => {
      if (!settings.goalCelebration) return []
      if (event.kind === 'goal-reached') {
        return [{ type: 'message', text: `You reached "${event.data.goalName}"! Set a new goal and keep the streak going.`, linkTool: 'savings', celebration: true }]
      }
      return []
    }
  }
}

export function streakReminderRule(): AutomationRule {
  return {
    id: 'streak-reminder',
    label: 'Broken streak notes',
    description: 'When a habit streak of 7 or more days breaks, show a gentle note on the dashboard.',
    listensTo: ['habit-streak-broken'],
    run: (event, settings) => {
      if (!settings.streakReminder) return []
      if (event.kind !== 'habit-streak-broken') return []
      const streak = event.data.habitStreak ?? 0
      if (streak < 7) return []
      return [{
        type: 'message',
        text: `"${event.data.habitName}" had a ${streak}-day streak. One missed day is not a lost habit — pick it back up today.`,
        linkTool: 'habits'
      }]
    }
  }
}

// Not event-driven in the usual sense: it answers a scan for overdue tasks that
// runAutomation runs when it sees ANY event (cheap) plus a dedicated 'tick'.
export function overdueTaskNudgeRule(): AutomationRule {
  return {
    id: 'overdue-task-nudge',
    label: 'Stale overdue tasks',
    description: 'When a task has been overdue for more than N days, surface it in the daily briefing.',
    listensTo: ['task-completed', 'journal-entry-saved'],
    run: (_event, settings, ctx) => {
      if (!settings.overdueTaskNudge) return []
      if (ctx.produced.has('stale-tasks')) return [] // once per run is plenty
      ctx.produced.add('stale-tasks')
      const list = ctx.overdueTasks ?? []
      const stale = list.filter((t) => t.daysOverdue > settings.overdueDays).slice(0, 5)
      if (stale.length === 0) return []
      return [{
        type: 'message',
        text: `${stale.length} task${stale.length === 1 ? ' has' : 's have'} been overdue for more than ${settings.overdueDays} ${settings.overdueDays === 1 ? 'day' : 'days'}: ${stale.map((t) => `"${t.title}"`).join(', ')}. Reschedule or let them go.`,
        linkTool: 'tasks'
      }]
    }
  }
}

// The registry. Adding a rule = adding one entry here (+ its type above).
export function defaultRules(): AutomationRule[] {
  return [lossReflectionRule(), goalCelebrationRule(), streakReminderRule(), overdueTaskNudgeRule()]
}

// Nearest-friendly number for a title.

// Which settings key turns each rule on (shared/automations settings object).
export const RULE_TOGGLE: Record<AutomationRuleId, keyof AutomationSettings> = {
  'loss-reflection': 'lossReflection',
  'goal-celebration': 'goalCelebration',
  'streak-reminder': 'streakReminder',
  'overdue-task-nudge': 'overdueTaskNudge'
}

// ---------- the engine run ----------

export interface AutomationRunContext {
  settings: AutomationSettings
  rules?: AutomationRule[]
  // Extra per-run data a caller can hand in; the overdue rule reads overdueTasks.
  overdueTasks?: { id: number; title: string; daysOverdue: number }[]
  // Which rules already produced something in an enclosing run (loop prevention).
  alreadyProduced?: ReadonlySet<AutomationRuleId>
}

export interface AutomationOutcome {
  ruleId: AutomationRuleId
  actions: AutomationAction[]
  labels: string[] // one plain sentence per action, for the Activity list
}

// Runs ONE event through every rule that listens to it. Loop prevention:
//  1. a rule cannot fire twice for the same event id pair (caller dedups by key),
//  2. a rule never sees events of its own making (rules only emit actions, never events,
//     so nothing they do can come back through emitAutomation with an event they listen to —
//     but if a future rule DID emit, the caller passes alreadyProduced and the engine refuses),
//  3. `ctx.produced` stops one rule spamming the same message many times per run.
export function runAutomation(event: AutomationEvent, ctx: AutomationRunContext): AutomationOutcome[] {
  const produced = new Set<string>()
  const out: AutomationOutcome[] = []
  for (const rule of ctx.rules ?? defaultRules()) {
    if (!rule.listensTo.includes(event.kind)) continue
    if (ctx.alreadyProduced?.has(rule.id)) continue // loop guard: already ran in this chain
    const toggle = RULE_TOGGLE[rule.id]
    if (!ctx.settings[toggle]) continue // the rule is switched off: nothing happens, nothing is logged
    const actions = rule.run(event, ctx.settings, { produced, overdueTasks: ctx.overdueTasks })
    if (actions.length === 0) continue
    out.push({ ruleId: rule.id, actions, labels: actions.map((a) => actionLabel(rule.id, a, event)) })
  }
  return out
}

// Loop prevention made explicit for the caller: after this run produced actions for
// `ruleId`, those rule ids must be passed back as alreadyProduced on any chained run.
export function ruleIdsOf(outcomes: AutomationOutcome[]): AutomationRuleId[] {
  return [...new Set(outcomes.map((o) => o.ruleId))]
}

// One human sentence per action, so the Activity list says WHAT happened, not just "ran".
export function briefingSummarySafe(b: Pick<import('./briefing').DailyBriefing, 'tasks' | 'habits' | 'savings' | 'trades' | 'journal'>): string {
  // Lazy import avoided: reuse the briefing's own summary rules through a tiny mirror that
  // touches no automations state.
  const parts: string[] = []
  if (b.tasks) {
    const { due, overdue } = b.tasks
    if (due.length > 0 && overdue.length > 0) parts.push(`${due.length} tasks due and ${overdue.length} overdue`)
    else if (due.length > 0) parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due today`)
    else if (overdue.length > 0) parts.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`)
  }
  if (b.habits && b.habits.due > 0 && b.habits.done < b.habits.due) {
    parts.push(`${b.habits.due - b.habits.done} habit${b.habits.due - b.habits.done === 1 ? '' : 's'} left today`)
  }
  if (parts.length === 0) return 'No tasks due today · No journal entries yet'
  return parts.join(' · ')
}
export function actionLabel(ruleId: AutomationRuleId, action: AutomationAction, event: AutomationEvent): string {
  if (action.type === 'create-draft-entry') {
    return `Created draft logbook entry "${action.title}" (tagged #${AUTOMATION_TAG}).`
  }
  const tool = action.linkTool ? ` (open ${action.linkTool})` : ''
  if (ruleId === 'goal-celebration') return `Showed a celebration for reaching "${event.data.goalName ?? 'a goal'}"${tool}.`
  if (ruleId === 'streak-reminder') return `Showed a note about "${event.data.habitName ?? 'a habit'}"'s broken streak${tool}.`
  if (ruleId === 'overdue-task-nudge') return `Surfaced stale overdue tasks in the daily briefing${tool}.`
  return `Showed a message${tool}.`
}

// ---------- safety guard (used by the DB layer before acting) ----------
// Automations may CREATE a draft entry or SHOW a message. Anything else is refused:
// they must never edit or delete existing rows.

export type GuardedAction = AutomationAction
export function guardAction(action: AutomationAction): GuardedAction | null {
  if (action.type === 'create-draft-entry' || action.type === 'message') return action
  return null // unknown or forbidden action type: dropped, never executed
}
