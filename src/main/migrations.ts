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

  // 15: hide automation activity without removing the durable dedupe claims.
  `ALTER TABLE automation_events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,

  // 16: when a trade actually closed (an ISO timestamp), so the "quick
  // re-entry after a loss" rule can measure real minutes. Old rows keep NULL:
  // they were closed before this existed and the rule never fires for them.
  // Set on the exit-price write from now on (src/main/trades.ts).
  `ALTER TABLE trades ADD COLUMN closed_at TEXT;`,

  // 17: soft delete everywhere (Phase 0). Every user-facing row can now sit in
  // Trash instead of disappearing. Everything gets:
  //   deleted_at        ISO timestamp of when it was trashed (NULL = live)
  //   delete_batch_id   groups rows trashed together as one undoable action
  //                     (a savings goal and all of its transactions share one
  //                     batch; a lone row gets its own id). Restoring restores
  //                     the whole batch, so a group never comes back half of it.
  // Tasks already had deleted_at (migration 9); they gain updated_at (backfilled
  // from created_at, so every row before this has an update stamp too) and
  // delete_batch_id.
  `ALTER TABLE logbook_entries ADD COLUMN deleted_at TEXT;
   ALTER TABLE logbook_entries ADD COLUMN delete_batch_id TEXT;
   CREATE INDEX idx_logbook_deleted ON logbook_entries(deleted_at);
   ALTER TABLE trades ADD COLUMN deleted_at TEXT;
   ALTER TABLE trades ADD COLUMN delete_batch_id TEXT;
   CREATE INDEX idx_trades_deleted ON trades(deleted_at);
   ALTER TABLE savings_goals ADD COLUMN deleted_at TEXT;
   ALTER TABLE savings_goals ADD COLUMN delete_batch_id TEXT;
   ALTER TABLE savings_transactions ADD COLUMN deleted_at TEXT;
   ALTER TABLE savings_transactions ADD COLUMN delete_batch_id TEXT;
   CREATE INDEX idx_savings_goals_deleted ON savings_goals(deleted_at);
   CREATE INDEX idx_savings_tx_deleted ON savings_transactions(deleted_at);
   ALTER TABLE habits ADD COLUMN deleted_at TEXT;
   ALTER TABLE habits ADD COLUMN delete_batch_id TEXT;
   ALTER TABLE tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
   ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT;
   UPDATE tasks SET updated_at = created_at WHERE updated_at = '';`,

  // 18: links between items of any kind (Phase 0). One row says "A is linked
  // to B": source and target are (type, id) pairs, types come from
  // src/shared/links.ts. A link is stored ONCE (the writer normalises the
  // direction so the smaller type name is the source), and every query reads
  // both sides of that one row. relation is a short word ('related' today);
  // the unique index makes the same link twice impossible.
  `CREATE TABLE links (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     source_type TEXT NOT NULL,
     source_id   INTEGER NOT NULL,
     target_type TEXT NOT NULL,
     target_id   INTEGER NOT NULL,
     relation    TEXT NOT NULL DEFAULT 'related',
     created_at  TEXT NOT NULL,
     deleted_at  TEXT
   );
   CREATE INDEX idx_links_source ON links(source_type, source_id);
   CREATE INDEX idx_links_target ON links(target_type, target_id);
   CREATE UNIQUE INDEX idx_links_once ON links(source_type, source_id, target_type, target_id, relation);`,

  // 19: the tags service (Phase 0). `tags` holds one row per tag (the name is
  // the normalised tag text the app already produces, so '  #Work ' becomes
  // 'work'); `taggings` points one tag at one item of any kind. Existing
  // modules keep their JSON tag columns - this powers NEW kinds of items from
  // Phase 2 on and the Tags page later. colour may be NULL: existing tags keep
  // their colour in the tagColors setting.
  `CREATE TABLE tags (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL UNIQUE,
     colour     TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE taggings (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     entity_type TEXT NOT NULL,
     entity_id   INTEGER NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     deleted_at  TEXT
   );
   CREATE INDEX idx_taggings_entity ON taggings(entity_type, entity_id);
   CREATE UNIQUE INDEX idx_taggings_once ON taggings(tag_id, entity_type, entity_id);`,

  // 20: templates (Phase 0). kind names what a template builds ('logbook',
  // 'task', ...), payload is the JSON of the fields it prefills, and
  // is_builtin marks starter templates the app ships with. The manager UI
  // arrives in Phase 6; the engine and variables ({{date}}, {{weekday}}) live
  // in src/shared/templates.ts.
  `CREATE TABLE templates (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     kind       TEXT NOT NULL,
     name       TEXT NOT NULL,
     payload    TEXT NOT NULL,
     is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT
   );`,

  // 21: the shared search index (Phase 0). One FTS5 table feeds universal
  // search so the per-module LIKE queries are not the only path anymore. The
  // entity_type/entity_id columns are UNINDEXED (looked up, not matched); the
  // `text` column holds the searchable words of one item, built the same way
  // src/main/searchIndex.ts builds them for new rows, so old and new data
  // match alike. The migration seeds it once; writes keep it in step after
  // that. It is derived data (never in backups).
  `CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, text);
   INSERT INTO search_index (entity_type, entity_id, text)
     SELECT 'logbook', id, title || ' ' || body || ' ' || tags || ' ' || date FROM logbook_entries WHERE deleted_at IS NULL;
   INSERT INTO search_index (entity_type, entity_id, text)
     SELECT 'trade', id, asset || ' ' || notes || ' ' || tags || ' ' || date || ' ' || direction FROM trades WHERE deleted_at IS NULL;
   INSERT INTO search_index (entity_type, entity_id, text)
     SELECT 'goal', id, name || ' ' || notes FROM savings_goals WHERE deleted_at IS NULL;
   INSERT INTO search_index (entity_type, entity_id, text)
     SELECT 'savings_tx', t.id, t.note || ' ' || t.date || ' ' || t.kind FROM savings_transactions t WHERE t.deleted_at IS NULL;
   INSERT INTO search_index (entity_type, entity_id, text)
     SELECT 'task', id, title || ' ' || notes || ' ' || COALESCE(project, '') || ' ' || tags FROM tasks WHERE deleted_at IS NULL;`,

  // 22: expenses and budgets (Phase 1).
  //   expense_categories: default seeded categories with icons and colours.
  //   expense_transactions: amount is integer minor units (cents) plus currency.
  //   expense_budgets: budget per category per month (amount in integer cents).
  //   recurring_bills: recurring bills and subscriptions with cadence and next due date.
  //   recurring_bill_occurrences: tracked instances ensuring idempotent catch-up generation.
  // Every user-facing table includes deleted_at, delete_batch_id, created_at, updated_at.
  `CREATE TABLE expense_categories (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL UNIQUE,
     colour          TEXT NOT NULL,
     icon            TEXT NOT NULL,
     archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   INSERT INTO expense_categories (name, colour, icon, created_at, updated_at) VALUES
     ('Food & Dining', '#f97316', 'Utensils', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Transport', '#3b82f6', 'Car', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Housing', '#8b5cf6', 'Home', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Bills & Utilities', '#eab308', 'Zap', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Health & Medical', '#ef4444', 'HeartPulse', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Fun & Entertainment', '#ec4899', 'Film', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Shopping', '#10b981', 'ShoppingBag', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
     ('Other', '#6b7280', 'MoreHorizontal', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z');

   CREATE TABLE recurring_bills (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     name               TEXT NOT NULL,
     amount             INTEGER NOT NULL CHECK (amount > 0),
     currency           TEXT NOT NULL DEFAULT 'USD',
     cadence            TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly', 'custom')),
     interval_days      INTEGER CHECK (interval_days IS NULL OR interval_days > 0),
     next_due_date      TEXT NOT NULL,
     category_id        INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
     reminder_lead_days INTEGER NOT NULL DEFAULT 0 CHECK (reminder_lead_days >= 0),
     autopay            INTEGER NOT NULL DEFAULT 0 CHECK (autopay IN (0, 1)),
     trial_end_date     TEXT,
     payee              TEXT NOT NULL DEFAULT '',
     note               TEXT NOT NULL DEFAULT '',
     archived           INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
     created_at         TEXT NOT NULL,
     updated_at         TEXT NOT NULL,
     deleted_at         TEXT,
     delete_batch_id    TEXT
   );
   CREATE INDEX idx_recurring_bills_due ON recurring_bills(next_due_date);
   CREATE INDEX idx_recurring_bills_deleted ON recurring_bills(deleted_at);

   CREATE TABLE expense_transactions (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     amount          INTEGER NOT NULL CHECK (amount > 0),
     currency        TEXT NOT NULL DEFAULT 'USD',
     date            TEXT NOT NULL,
     category_id     INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
     payee           TEXT NOT NULL DEFAULT '',
     note            TEXT NOT NULL DEFAULT '',
     type            TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
     tags            TEXT NOT NULL DEFAULT '[]',
     transfer_target TEXT,
     recurring_id    INTEGER REFERENCES recurring_bills(id) ON DELETE SET NULL,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_expense_tx_date ON expense_transactions(date);
   CREATE INDEX idx_expense_tx_category ON expense_transactions(category_id);
   CREATE INDEX idx_expense_tx_type ON expense_transactions(type);
   CREATE INDEX idx_expense_tx_deleted ON expense_transactions(deleted_at);

   CREATE TABLE expense_budgets (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     category_id     INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
     month           TEXT NOT NULL,
     amount          INTEGER NOT NULL CHECK (amount >= 0),
     currency        TEXT NOT NULL DEFAULT 'USD',
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_expense_budgets_month ON expense_budgets(month);
   CREATE INDEX idx_expense_budgets_deleted ON expense_budgets(deleted_at);

   CREATE TABLE recurring_bill_occurrences (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     recurring_id    INTEGER NOT NULL REFERENCES recurring_bills(id) ON DELETE CASCADE,
     due_date        TEXT NOT NULL,
     status          TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'skipped')),
     transaction_id  INTEGER REFERENCES expense_transactions(id) ON DELETE SET NULL,
     paid_at         TEXT,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT,
     UNIQUE(recurring_id, due_date)
   );
   CREATE INDEX idx_recurring_occ_due ON recurring_bill_occurrences(due_date);
   CREATE INDEX idx_recurring_occ_deleted ON recurring_bill_occurrences(deleted_at);`,

  // 23: Notes (Phase 2) - undated markdown pages, separate from the dated Logbook.
  //   pinned    sorts above everything else (and stays pinned through an archive).
  //   archived  hides the note from the normal list without trashing it.
  //   title_key is the lowercase/collapsed title used by [[wiki links]] so a
  //             link can find its note without scanning every row.
  //   Tags stay in the JSON `tags` column like every other module; the shared
  //   taggings table records the same names so the Tags page can count them.
  `CREATE TABLE notes (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     title           TEXT NOT NULL DEFAULT '',
     title_key       TEXT NOT NULL DEFAULT '',
     body            TEXT NOT NULL DEFAULT '',
     tags            TEXT NOT NULL DEFAULT '[]',
     pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
     archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_notes_title_key ON notes(title_key);
   CREATE INDEX idx_notes_deleted ON notes(deleted_at);
   CREATE INDEX idx_notes_archived ON notes(archived, pinned);`,

  // 24: Content planner (Phase 3) - videos, shorts, streams and posts moving
  // through a fixed pipeline. Stage is one of CONTENT_STAGES (src/shared/content.ts).
  //   script_note_id  the linked Note that holds the script (one click to create).
  //   position        the card's order inside its stage column (like tasks).
  //   publish_date    appears on the Calendar; stage_dates is JSON of the optional
  //                   per-stage due dates ({ "record": "2026-11-05", ... }).
  //   checklist       JSON array of { id, stage, text, done } - per-stage checklists.
  //   assets          JSON array of { path, label, kind } - local files by PATH only,
  //                   never copied, so large videos stay where they are.
  //   views_24h / views_7d / post_notes are typed in manually after publishing
  //                   (the app is local-only and cannot fetch them).
  `CREATE TABLE content_items (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     title           TEXT NOT NULL,
     type            TEXT NOT NULL CHECK (type IN ('video', 'short', 'stream', 'post')),
     platform        TEXT NOT NULL DEFAULT '',
     hook            TEXT NOT NULL DEFAULT '',
     stage           TEXT NOT NULL CHECK (stage IN ('idea', 'script', 'record', 'edit', 'publish', 'published')),
     position        REAL NOT NULL DEFAULT 0,
     series          TEXT NOT NULL DEFAULT '',
     tags            TEXT NOT NULL DEFAULT '[]',
     target_publish_date TEXT,
     published_date  TEXT,
     published_url   TEXT,
     script_note_id  INTEGER REFERENCES notes(id) ON DELETE SET NULL,
     checklist       TEXT NOT NULL DEFAULT '[]',
     stage_dates     TEXT NOT NULL DEFAULT '{}',
     assets          TEXT NOT NULL DEFAULT '[]',
     stream_start    TEXT,
     stream_minutes  INTEGER,
     views_24h       INTEGER,
     views_7d        INTEGER,
     post_notes      TEXT NOT NULL DEFAULT '',
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_content_stage ON content_items(stage, position);
   CREATE INDEX idx_content_publish ON content_items(target_publish_date);
   CREATE INDEX idx_content_deleted ON content_items(deleted_at);`,

  // 25: Focus timer and time tracking (Phase 4).
  //   projects: lightweight projects table, seeded with existing unique project
  //             names from tasks.
  //   time_sessions: durable session logs with task/project links, timestamps,
  //                  planned/actual seconds, type, completed flag, and soft delete.
  //   active_focus_session: single-row state table persisting the currently running
  //                         or paused timer so it survives window close or restart.
  `CREATE TABLE projects (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL UNIQUE,
     colour          TEXT NOT NULL DEFAULT '#8b5cf6',
     archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_projects_deleted ON projects(deleted_at);

   -- Seed projects from existing distinct project names in tasks
   INSERT OR IGNORE INTO projects (name, colour, created_at, updated_at)
     SELECT DISTINCT TRIM(project), '#8b5cf6', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'
     FROM tasks WHERE project IS NOT NULL AND TRIM(project) != '' AND deleted_at IS NULL;

   CREATE TABLE time_sessions (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
     project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     project_name    TEXT NOT NULL DEFAULT '',
     started_at      TEXT NOT NULL,
     ended_at        TEXT NOT NULL,
     planned_seconds INTEGER NOT NULL DEFAULT 0 CHECK (planned_seconds >= 0),
     actual_seconds  INTEGER NOT NULL CHECK (actual_seconds >= 0),
     type            TEXT NOT NULL CHECK (type IN ('focus', 'short-break', 'long-break', 'count-up')),
     completed       INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1)),
     note            TEXT NOT NULL DEFAULT '',
     source          TEXT NOT NULL DEFAULT 'timer' CHECK (source IN ('timer', 'manual')),
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_time_sessions_started ON time_sessions(started_at);
   CREATE INDEX idx_time_sessions_task ON time_sessions(task_id);
   CREATE INDEX idx_time_sessions_project ON time_sessions(project_id);
   CREATE INDEX idx_time_sessions_deleted ON time_sessions(deleted_at);

   CREATE TABLE active_focus_session (
     id               INTEGER PRIMARY KEY CHECK (id = 1),
     task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
     project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     project_name     TEXT NOT NULL DEFAULT '',
     type             TEXT NOT NULL CHECK (type IN ('focus', 'short-break', 'long-break', 'count-up')),
     mode             TEXT NOT NULL CHECK (mode IN ('pomodoro', 'count-up')),
     status           TEXT NOT NULL CHECK (status IN ('running', 'paused')),
     started_at       TEXT NOT NULL,
     target_seconds   INTEGER NOT NULL DEFAULT 0,
     elapsed_seconds  INTEGER NOT NULL DEFAULT 0,
     paused_at        TEXT,
     round            INTEGER NOT NULL DEFAULT 1,
     note             TEXT NOT NULL DEFAULT '',
     updated_at       TEXT NOT NULL
   );`,

  // 26: Tools hub (Phase 5) - reusable snippets and plain-text scratchpads.
  //   Snippets have a title, body and tags and are copied with one click.
  //   Scratchpads are untitled autosaving plain-text pads that can be promoted
  //   to a Note. Both soft-delete like everything else.
  `CREATE TABLE snippets (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     title           TEXT NOT NULL,
     body            TEXT NOT NULL DEFAULT '',
     tags            TEXT NOT NULL DEFAULT '[]',
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_snippets_deleted ON snippets(deleted_at);

   CREATE TABLE scratchpads (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL DEFAULT '',
     content         TEXT NOT NULL DEFAULT '',
     position        REAL NOT NULL DEFAULT 0,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     deleted_at      TEXT,
     delete_batch_id TEXT
   );
   CREATE INDEX idx_scratchpads_deleted ON scratchpads(deleted_at);`,

  // 27: All-in-one calculator tables (calc_*).
  //   calc_history: calculation input, result, format, rate snapshot, pinned
  //   calc_variables: user and engine variables
  //   calc_programs: custom saved scripts/programs
  //   calc_rate_sets, calc_rates, calc_rate_overrides: offline user-entered currency rates
  //   calc_settings: precision, angleMode, baseCurrency, etc.
  `CREATE TABLE calc_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL,
    mode          TEXT NOT NULL DEFAULT 'standard',
    input         TEXT NOT NULL,
    result        TEXT NOT NULL,
    result_format TEXT NOT NULL DEFAULT 'decimal',
    rate_snapshot TEXT,
    pinned        INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
   );
   CREATE INDEX idx_calc_history_created ON calc_history(created_at);

   CREATE TABLE calc_variables (
    name       TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
   );

   CREATE TABLE calc_programs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    source     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
   );

   CREATE TABLE calc_rate_sets (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'USD',
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at    TEXT NOT NULL
   );
   INSERT INTO calc_rate_sets (id, name, base_currency, is_active, updated_at)
    VALUES ('default', 'Default Rates', 'USD', 1, '2026-11-04T00:00:00.000Z');

   CREATE TABLE calc_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_set_id   TEXT NOT NULL REFERENCES calc_rate_sets(id) ON DELETE CASCADE,
    currency_code TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    rate_to_base  TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL,
    UNIQUE(rate_set_id, currency_code)
   );

   CREATE TABLE calc_rate_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_set_id TEXT NOT NULL REFERENCES calc_rate_sets(id) ON DELETE CASCADE,
    from_code   TEXT NOT NULL,
    to_code     TEXT NOT NULL,
    rate        TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(rate_set_id, from_code, to_code)
   );

   CREATE TABLE calc_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
   );`
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
