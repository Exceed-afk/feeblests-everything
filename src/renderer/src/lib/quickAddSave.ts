// Turns a parsed quick-add proposal into the actual saves, with nothing the
// parser could do on its own. Shared by the command palette and the Quick
// capture window, so both places behave identically. Goal and habit names are
// matched in the caller (it knows the real lists); here the name is matched
// against what is passed in.
import type { QuickAddProposal } from '../../../shared/quickAdd'
import type { Habit, SavingsGoal } from '../../../shared/types'
import { today } from './dates'

export interface QuickAddSaveContext {
  goals: SavingsGoal[]
  habits: Habit[]
}

export interface QuickAddSaveResult { message: string }

// Executes a confirmed proposal. Throws plain errors the preview card can show.
// Tasks land due on their parsed date, or today when there was none; deposits go
// to the matched goal; habit check-ins check TODAY (a check-in is always now).
export async function saveProposal(
  proposal: QuickAddProposal,
  ctx: QuickAddSaveContext
): Promise<QuickAddSaveResult> {
  const day = today()
  if (proposal.kind === 'deposit') {
    const goal = proposal.goalName
      ? ctx.goals.find((g) => g.name.toLowerCase() === proposal.goalName!.toLowerCase())
      : undefined
    if (!goal) throw new Error(`No savings goal named "${proposal.goalName}". Create it first, then try again.`)
    await window.api.savings.addTransaction({ goalId: goal.id, date: day, kind: proposal.txKind, amount: proposal.amount, note: proposal.note })
    return { message: `${proposal.txKind === 'withdrawal' ? 'Withdrawal' : 'Deposit'} of ${proposal.amount} saved to ${goal.name}` }
  }
  if (proposal.kind === 'task') {
    await window.api.tasks.create({
      title: proposal.title, notes: '', status: 'todo', priority: proposal.priority, dueTime: null,
      dueDate: proposal.dueDate ?? day, project: '', tags: [], subtasks: [],
      recurrenceRule: proposal.recurrence ? { frequency: proposal.recurrence.frequency, intervalDays: proposal.recurrence.intervalDays } : null, recurrenceNext: null
    })
    const bits = proposal.recurrence
      ? ` repeats ${proposal.recurrence.frequency === 'custom' ? `every ${proposal.recurrence.intervalDays} days` : proposal.recurrence.frequency}`
      : ` (due ${proposal.dueDate ?? 'today'})`
    return { message: `Task "${proposal.title}" saved${bits}` }
  }
  if (proposal.kind === 'habit-checkin') {
    const name = proposal.habitName.toLowerCase()
    const habit = ctx.habits.find((h) => !h.archived && h.name.toLowerCase() === name)
      ?? ctx.habits.filter((h) => !h.archived && h.name.toLowerCase().startsWith(name))[0]
    if (!habit) throw new Error(`No habit named "${proposal.habitName}". Check it off on the Habits page, or add the habit first.`)
    await window.api.habits.setCheckin(habit.id, day, true)
    return { message: `"${habit.name}" checked off for today` }
  }
  // note
  await window.api.logbook.create({ date: day, title: proposal.title, body: proposal.body, mood: null, tags: [] })
  return { message: 'Saved to your Logbook' }
}
