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
   CREATE UNIQUE INDEX idx_tasks_parent_once ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;`
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
