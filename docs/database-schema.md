# Database Schema (7 Migrations)

The application uses SQLite with BetterSQLite3. The schema evolves through
7 additive migrations — never edit an old migration, only add new ones at
the end. `user_version` pragma tracks how many have run.

---

## Migration 1: Settings

```sql
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

- Holds key-value pairs for app configuration
- Primary key: `key`

---

## Migration 2: Logbook

```sql
CREATE TABLE logbook_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  mood       TEXT,
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_logbook_date ON logbook_entries(date);
```

- Stores daily mood/notes entries
- Tags stored as JSON array string
- Index on date for period queries

---

## Migration 3: Trades

```sql
CREATE TABLE trades (
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
CREATE INDEX idx_trades_date ON trades(date);
```

- Records closed trades with P&L calculation fields
- `direction`: 'long' or 'short'
- P&L is calculated from entry/exit price and quantity

---

## Migration 4: Savings

```sql
CREATE TABLE savings_goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  target     REAL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE savings_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id     INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  amount      REAL NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_savings_tx_goal ON savings_transactions(goal_id, date);
```

- Goals have a target amount; balance is computed from transactions
- Transactions have kind ('deposit'/'withdrawal') and amount
- `ON DELETE CASCADE` removes transactions when goal is deleted

---

## Migration 5: Habits

```sql
CREATE TABLE habits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  days        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  start_date  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE habit_checkins (
  habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (habit_id, date)
);
```

- `days`: JSON list of scheduled weekdays (0=Monday...6=Sunday)
- Streaks and rates are **calculated** from check-ins, not stored
- Check-ins link a habit to a checked-off date
- `ON DELETE CASCADE` removes check-ins when habit is deleted

---

## Migration 6: Tasks

```sql
CREATE TABLE tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in-progress', 'done')),
  priority       TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
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
);
```

- Tasks support checklists via `task_subtasks`
- `parent_task_id` links a child recurrence to a parent
- **Schema contract**: each parent has at most one recurring child
  (enforced by unique index + cleanup logic in `migrations.ts:7`)

---

## Migration 7: Schema Cleanup

```sql
-- Ensures no parent has more than one child recurrence
UPDATE tasks SET parent_task_id = NULL
WHERE parent_task_id IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM tasks WHERE parent_task_id IS NOT NULL
    GROUP BY parent_task_id);

CREATE UNIQUE INDEX idx_tasks_parent_once ON tasks(parent_task_id)
WHERE parent_task_id IS NOT NULL;
```

- Runs after migration 6 to fix any hand-edited or old data
- The unique index prevents a second child ever being linked

---

## Entity-Relationship Overview

```
settings (1)───────(*) logbook_entries
settings (1)───────(*) trades
settings (1)───────(*) savings_goals ─────(*) savings_transactions
habits   (1)───────(*) habit_checkins
tasks    (1)───────(*) task_subtasks
tasks    (1)───────(*) tasks (via parent_task_id)
```

- `*` = many side of 1-to-many
- All tables use `INTEGER PRIMARY KEY AUTOINCREMENT` for `id`
- Temporal data stored as `TEXT` in `YYYY-MM-DD` format
- Foreign keys use `ON DELETE CASCADE` or `ON DELETE SET NULL`
- No stored derived values (P&L, streaks, rates) — calculated from base data

---

## Key Design Notes

- **No stored P&L**: calculated from trade fields at read time
- **No stored habit streaks/rates**: calculated from check-ins at read time
- **No stored savings balance**: sum of transactions at read time
- **All dates are local YYYY-MM-DD** (UTC arithmetic in habits code)
- **Migrations are additive only** — old data is never corrupted
- **`user_version` pragma** tracks migration progress for safe upgrades