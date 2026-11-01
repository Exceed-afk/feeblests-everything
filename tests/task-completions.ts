import assert from 'node:assert/strict'
import { applyMigrations } from '../src/main/migrations'
import { createTask, listCompletions } from '../src/main/tasks'
import { localDate } from '../src/main/util'
import { addTaskDays } from '../src/shared/tasks'
import { functionByName, type AssistantRows } from '../src/shared/assistant'
import { buildInsightDays } from '../src/shared/insights'
import { openDatabase } from './sqlite'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('Assistant and Insights count each recurring completion from task history', () => {
  const db = openDatabase()
  applyMigrations(db)
  try {
    const today = localDate()
    const dates = [addTaskDays(today, -2), addTaskDays(today, -1), today]
    const task = createTask(db, {
      title: 'Daily task', notes: '', status: 'todo', priority: 'medium',
      dueDate: today, dueTime: null, project: null, tags: [],
      recurrenceRule: { frequency: 'daily', intervalDays: 1 }, recurrenceNext: today,
      subtasks: []
    })
    const insert = db.prepare('INSERT INTO task_completions (task_id, completed_at) VALUES (?, ?)')
    for (const date of dates) {
      const [year, month, day] = date.split('-').map(Number)
      insert.run(task.id, new Date(year, month - 1, day, 12).toISOString())
    }
    const oldDate = addTaskDays(today, -30)
    const [oldYear, oldMonth, oldDay] = oldDate.split('-').map(Number)
    insert.run(task.id, new Date(oldYear, oldMonth - 1, oldDay, 12).toISOString())

    const completions = listCompletions(db, { from: dates[0], to: today })
    assert.equal(completions.length, 3)
    const rows: AssistantRows = {
      txs: [], trades: [], habits: [], tasks: [], completions, entries: []
    }
    assert.equal(
      functionByName('tasks_completed')!.run(rows, { from: dates[0], to: today }),
      3
    )

    const insightDays = buildInsightDays({
      today, start: dates[0], end: today, habits: [], tasks: [], completions,
      trades: [], txs: [], entries: []
    })
    assert.deepEqual(insightDays.map((day) => day.tasksDone), [1, 1, 1])
  } finally {
    db.close()
  }
})

console.log(`\n${n} task completion history checks passed`)
