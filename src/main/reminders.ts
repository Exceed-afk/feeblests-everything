// Habit reminders: a quiet minute-by-minute check that shows a desktop
// notification when a habit's reminder time arrives.
//
// What a reminder does NOT do: it does not tick the habit off, and it does
// not fire for habits that are done, skipped or resting today. It only says
// "this is still open" while the day is not over.
//
// Limitations worth knowing (v1, deliberately simple):
//   - the check only runs while the app is open (closed app = no reminder)
//   - a reminder up to ~10 minutes late still fires, but one missed while
//     the app was closed does not appear later
import { Notification } from 'electron'
import type Database from 'better-sqlite3'
import { getDayStatus, isReminderDue } from '../shared/habits'
import { runDailyChecksIfNeeded } from './dailyCheck'
import type { HabitCompletion } from '../shared/types'
import { habitCompletionsOf, listHabits } from './habits'
import { listTasks } from './tasks'
import { pendingTaskReminders } from '../shared/tasks'
import { localDate } from './util'

const CHECK_EVERY_MS = 60_000 // once a minute is plenty for a HH:MM reminder

// Reminder times already shown, "habitId:date". Filled in memory only, so
// restarting the app never silently swallows a reminder.
const fired = new Set<string>()
const taskFired = new Set<string>()
let firedOnDate = '' // reminders reset at midnight

// Starts the reminder loop. Returns nothing permanent; the interval is
// unref'd so it can never keep the app alive when the user quits.
export function startReminders(getDb: () => Database.Database, onFocusApp: () => void): void {
  const tick = () => {
    try {
      checkReminders(getDb(), onFocusApp)
    } catch (error) {
      // A bad tick must never break the app: tomorrow's reminders matter.
      console.error('Reminder check failed:', error)
    }
  }
  checkReminders(getDb(), onFocusApp) // catch the app being started after a reminder time
  const timer = setInterval(tick, CHECK_EVERY_MS)
  timer.unref?.()
}

// The current time as "HH:MM", local to this computer (like localDate()).
export function localTime(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function checkReminders(db: Database.Database, onFocusApp: () => void): void {
  // A day turning over is what makes the daily checks due; run them here too,
  // so leaving the app open past midnight still runs the day's checks once.
  try {
    runDailyChecksIfNeeded(db)
  } catch (error) {
    console.error('Daily check failed:', error)
  }
  if (!Notification.isSupported()) return // the OS cannot show notifications
  const today = localDate()
  // A new day clears the "already reminded" list, so tomorrow fires again.
  if (firedOnDate !== today) {
    fired.clear()
    taskFired.clear()
    firedOnDate = today
  }
  const now = localTime()

  for (const h of listHabits(db, today).habits) {
    if (h.archived || !h.reminderTime) continue
    const key = `${h.id}:${today}`
    if (fired.has(key)) continue
    if (!isReminderDue(h.reminderTime, now)) continue
    // What is the day's state? Only an open due day ("pending") is worth a
    // reminder; done, skipped, resting and already-missed days stay quiet.
    const completions: HabitCompletion[] = habitCompletionsOf(db, h.id)
    const state = getDayStatus(h, today, completions, today)
    if (state !== 'pending') continue

    fired.add(key)
    showNotification(h.name, onFocusApp)
  }

  for (const task of pendingTaskReminders(listTasks(db, today), today, now)) {
    const due = task.recurrenceNext ?? task.dueDate ?? today
    const key = `${task.id}:${due}`
    if (taskFired.has(key)) continue
    taskFired.add(key)
    showTaskNotification(task.title, onFocusApp)
  }
}

function showNotification(name: string, onFocusApp: () => void): void {
  const notification = new Notification({
    title: 'Habit reminder',
    body: `Time for "${name}".` // short is best: the title already says what this is
  })
  // Clicking the notification opens the app, so the reminder is useful at a glance.
  notification.on('click', onFocusApp)
  notification.show()
}

function showTaskNotification(title: string, onFocusApp: () => void): void {
  const notification = new Notification({ title: 'Task due', body: title })
  notification.on('click', onFocusApp)
  notification.show()
}
