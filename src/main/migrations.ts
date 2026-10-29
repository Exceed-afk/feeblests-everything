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
   );`
]
