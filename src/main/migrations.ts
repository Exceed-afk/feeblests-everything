// Each entry is one schema version. To change the database later, ADD a new
// entry at the end - never edit an old one. SQLite's built-in `user_version`
// remembers how many have already run, so old data upgrades safely.
export const MIGRATIONS: string[] = [
  // 1: app settings
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,

  // 2: logbook. Tags are stored as a JSON array, e.g. '["work","idea"]'.
  `CREATE TABLE logbook_entries (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     date       TEXT NOT NULL,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL DEFAULT '',
     mood       TEXT,
     tags       TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX idx_logbook_date ON logbook_entries(date);`,

  // 3: trades. P&L is NOT stored; it is calculated from these fields.
  `CREATE TABLE trades (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     date        TEXT NOT NULL,
     asset       TEXT NOT NULL,
     direction   TEXT NOT NULL CHECK (direction IN ('long', 'short')),
     entry_price REAL NOT NULL,
     exit_price  REAL,
     quantity    REAL NOT NULL,
     fees        REAL NOT NULL DEFAULT 0,
     notes       TEXT NOT NULL DEFAULT '',
     tags        TEXT NOT NULL DEFAULT '[]',
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL
   );
   CREATE INDEX idx_trades_date ON trades(date);`,

  // 4: savings. The balance is NOT stored; it is the sum of the transactions.
  `CREATE TABLE savings_goals (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL,
     target     REAL,
     notes      TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE savings_transactions (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     goal_id    INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
     date       TEXT NOT NULL,
     kind       TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
     amount     REAL NOT NULL,
     note       TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX idx_savings_tx_goal ON savings_transactions(goal_id, date);`,

  // 5: habits. Streaks and rates are NOT stored; they are calculated from the check-ins.
  // `days` is a JSON list of scheduled weekdays (0 = Monday ... 6 = Sunday).
  `CREATE TABLE habits (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL,
     notes      TEXT NOT NULL DEFAULT '',
     days       TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
     archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
     start_date TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE habit_checkins (
     habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
     date       TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (habit_id, date)
   );`,

  // 6: tasks and checklist items. Calendar dates are stored as local YYYY-MM-DD text.
  `CREATE TABLE tasks (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     title          TEXT NOT NULL,
     notes          TEXT NOT NULL DEFAULT '',
     status         TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'done')),
     priority       TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
     due_date       TEXT,
     created_at     TEXT NOT NULL,
     completed_at   TEXT,
     project        TEXT,
     tags           TEXT NOT NULL DEFAULT '[]',
     sort_order     INTEGER NOT NULL DEFAULT 0,
     recurrence     TEXT,
     parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL
   );
   CREATE INDEX idx_tasks_due_status ON tasks(status, due_date);
   CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
   CREATE TABLE task_subtasks (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     title      TEXT NOT NULL,
     done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
     sort_order INTEGER NOT NULL DEFAULT 0
   );`,

  // 7: a task row holds at most ONE recurring child occurrence, ever (see the contract at
  // the top of tasks.ts). The oldest child of each parent is the one the completion rule
  // always produced; any extra links (possible only in hand-edited or very old data) are
  // unlinked rather than deleted, so no row is ever lost, and the unique index then makes
  // a second child impossible at the schema level.
  `UPDATE tasks SET parent_task_id = NULL
     WHERE parent_task_id IS NOT NULL
       AND id NOT IN (SELECT MIN(id) FROM tasks WHERE parent_task_id IS NOT NULL GROUP BY parent_task_id);
   CREATE UNIQUE INDEX idx_tasks_parent_once ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;`,

  // 8: automation activity. One row per thing an automation DID (created a draft,
  // showed a message). It records WHAT and WHEN so nothing happens silently; the
  // user can delete rows freely and it never touches the user's own data.
  // rule + event + key together dedup a repeated trigger (e.g. the same goal's
  // celebration shown once, not once per deposit after it was reached).
  `CREATE TABLE automation_events (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     rule       TEXT NOT NULL,
     event      TEXT NOT NULL,
     event_key  TEXT NOT NULL,
     label      TEXT NOT NULL,
     entry_id   INTEGER,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX idx_automation_once ON automation_events(rule, event_key);`,
  // 9: task-manager rework (see docs/task-manager-improvement-plan.md).
  // Replaces parent_task_id / child-copy recurrence with a single rule per row
  // (recurrence_rule + recurrence_next), adds due_time alongside due_date,
  // soft delete via deleted_at, and manual sort position (replaces sort_order).
  // Old columns are dropped first so the migration is rerun-safe.
  `DELETE FROM task_subtasks WHERE task_id IN (SELECT id FROM tasks WHERE parent_task_id IS NOT NULL);
   DELETE FROM tasks WHERE parent_task_id IS NOT NULL;
   DROP INDEX IF EXISTS idx_tasks_parent_once;
   DROP INDEX IF EXISTS idx_tasks_parent;
   ALTER TABLE tasks DROP COLUMN sort_order;
   ALTER TABLE tasks DROP COLUMN parent_task_id;
   ALTER TABLE tasks ADD COLUMN due_time TEXT;
   ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
   ALTER TABLE tasks ADD COLUMN position REAL;
   ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
   ALTER TABLE tasks ADD COLUMN recurrence_next TEXT;
   -- Copy any stored rule into the new column BEFORE the old column is dropped.
   UPDATE tasks SET recurrence_rule = recurrence WHERE recurrence IS NOT NULL;
   ALTER TABLE tasks DROP COLUMN recurrence;
   UPDATE tasks SET position = id WHERE position IS NULL;
   CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(status, due_date);
   CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);`,

  // 10: habit day status. A check-in row used to mean only "done". Now it also
  // says "skipped" (a day deliberately skipped: sick, travelling, ...).
  // The column defaults to 'done', so every existing row keeps its meaning and
  // no data is lost. "missed" and "rest" are still never stored.
  `ALTER TABLE habit_checkins ADD COLUMN status TEXT NOT NULL DEFAULT 'done'
       CHECK (status IN ('done', 'skipped'));`,

  // 11: habit types. A habit is not always a yes/no thing: sometimes you count
  // (3 sessions), sometimes you measure a time (10 minutes). These columns say
  // which kind of habit it is and what "enough" means.
  //   type  = 'check' | 'count' | 'duration'
  //   target = the number to reach (how many, or how many minutes)
  //   unit  = the label for that number ("sessions", "min", ...)
  // Every existing habit becomes type 'check' with no target, which is exactly
  // what it was before, so no data is lost and no habit changes meaning.
  `ALTER TABLE habits ADD COLUMN type TEXT NOT NULL DEFAULT 'check'
       CHECK (type IN ('check', 'count', 'duration'));
   ALTER TABLE habits ADD COLUMN target REAL;
   ALTER TABLE habits ADD COLUMN unit TEXT NOT NULL DEFAULT '';
   ALTER TABLE habit_checkins ADD COLUMN value REAL;`,

  // 12: habit organisation. A manual sort position for drag-and-drop, and a
  // time of day (morning / afternoon / evening / anytime) the list can be
  // grouped by. Existing habits keep the order they already had: sort_order
  // starts as a copy of the creation order, and time_of_day defaults to
  // 'anytime', which reads exactly like "no time of day". Nothing is lost.
  `ALTER TABLE habits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE habits ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'anytime'
        CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'anytime'));
   UPDATE habits SET sort_order = (
     SELECT COUNT(*) FROM habits AS older
     WHERE older.created_at < habits.created_at
        OR (older.created_at = habits.created_at AND older.id < habits.id)
   );`,

  // 13: cross-module links and reminders, per habit.
  //   reminder_time    = "HH:MM" (24-hour) or NULL for no reminder. The
  //                      desktop notification lives in main/reminders.ts.
  //   auto_complete_on = '' (nothing else completes the habit) or
  //                      'logbook-entry' (writing a Logbook entry that day
  //                      checks the habit off, if it was due). The switch
  //                      itself lives in the Logbook module; habits only
  //                      HEAR about new entries through the event bus, so
  //                      the two features stay separate.
  // Every existing habit starts with no reminder and no auto-complete,
  // which is exactly the behaviour it had before.
  `ALTER TABLE habits ADD COLUMN reminder_time TEXT;
   ALTER TABLE habits ADD COLUMN auto_complete_on TEXT NOT NULL DEFAULT ''
        CHECK (auto_complete_on IN ('', 'logbook-entry'));`,

  // 14: keep a durable date for every task completion, including recurring
  // occurrences that later reopen the same task row.
  `CREATE TABLE task_completions (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     completed_at TEXT NOT NULL
   );
   CREATE INDEX idx_task_completions_completed_at ON task_completions(completed_at);
   INSERT INTO task_completions (task_id, completed_at)
     SELECT id, completed_at FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL;`,

]

// Exposed for focused migration tests and used by the app's startup path.
export function applyMigrations(db: import('better-sqlite3').Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
