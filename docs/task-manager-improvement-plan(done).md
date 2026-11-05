# Task Manager Improvement Plan

This is the implementation plan for the task manager. It is written against the
real project files and conventions:

- Pure business rules live in `src/shared/`; the database layer in `src/main/`;
  the UI in `src/renderer/src/`. No new dependencies are added.
- Every behaviour change is verified with `npm run typecheck && npm test` before
  it is considered done.
- SQLite is local-only: `better-sqlite3`, WAL mode, migrations additive and
  rerun-safe in `src/main/migrations.ts`.

---

## 0. Domain model to adopt

The requirements name the fixes that matter most for a task manager. I'd
remodel the `tasks` table around four rules that are currently partially
present but bolted on:

- **Stable ids + soft delete.** `id` stays the permanent key; deletion becomes a
  `deleted_at` flag. Old child occurrences and subtasks are never orphaned (they
  follow the parent row).
- **Due date + time separated.** `due_date` stays `YYYY-MM-DD`; a new `due_time`
  column (`00:00`–`23:59` or NULL) is what scheduling/search use. "Friday" then
  has a concrete local instant instead of a boundary-crossing guess.
- **Recurrence as a rule that generates instances**, not a copied copy on each
  row. One row per task owns the rule; instances are resolved at read time
  (today, upcoming, overdue, week view). This kills the `parent_task_id` chain,
  the per-child `recurrence` JSON, and the "one child ever" unique index, and it
  makes skip/repeat/interval changes live without rewrites.
- **Manual sort position.** Replace `sort_order` renumbering with a stored
  `position` (a float or a decimal text ordering value), so moving one card
  never touches its neighbours.

The resulting shape is a single `tasks` table where every row is a task with a
`status` that is exactly `todo | in-progress | done`, zero `parent_task_id`/
child-copy machinery, and a read-layer (`src/shared/tasks.ts`) that resolves
"what exists today / in the next week / overdue" from the new recurrence rule.

---

## 1. Core — fast capture and the task basics

### 1.1 Natural-phrase capture (the biggest lift)

**Goal:** type a line and get a validated, editable proposal. Save only when the
user confirms.

Files:
- Add `src/shared/quickAdd.ts` (or extend the existing one) with
  `buildProposal(text, today)`, returning a strict union of proposal kinds:
  `note`, `deposit`/`withdrawal`, `task`, `habitCheckin`.
- The task kind parses title text, date expressions (`today`, `tomorrow`,
  `friday`, `in 3 days`, `next monday`), times (`5pm`, `14:00`) which attach to
  the due time, priority words (`high`, `urgent`), location-ish keywords like
  `to`, and tags.
- The result is a `QuickAddProposal` with a `description()` and editable fields
  in the preview card.
- Wire it into the command palette (`modules/CommandPalette.tsx` + `lib/
  paletteItems.ts`) and the Quick capture window's Ask tab
  (`modules/Capture.tsx`). Nothing saves until `Ctrl+Enter` on the preview,
  matching the existing "preview before save" pattern the project already has.

Validation contract (single source of truth):
- `src/shared/quickAdd.ts` owns the parser and `quickAddProblems(proposal) ->
  { field: message }[]`.
- The renderer (Task editor / capture Ask) and the main process throw the same
  first error. The main process always throws; the renderer shows per-field
  messages and focuses the first bad one, as the current task validation does.

### 1.2 One-input capture with title only required

The current capture window's "Add task" sends `{ title, notes, status: todo,
priority: medium, dueDate: today when view is today, ... }`. Replace it with a
single text field whose Enter saves and whose text is the title; notes/time/
priority are **optional** modifiers typed inline (`"pay rent friday 5pm high"`),
and a blank save is a valid no-note, no-time task. This satisfies "one input,
title only required, keyboard-first".

Also tune focus/state behaviour: after save the input resets, remains open so a
user can quickly add several, and Esc hides it. Current behaviour partially
does this; the change is to make the title the single required field and make
all other fields modifiers.

### 1.3 Task basics

Title, notes, due date, priority, status `todo | in-progress | done`. Keep the
current field set — the change is that due date and time are separate, and
status is two-step (todo → in-progress → done) with the editor defaulting to the
same status unless explicitly changed.

---

## 2. Safe editing

### 2.1 Undo for complete

Implement an in-memory undo stack per task. On `setStatus` to `done`, snapshot
the previous `{ status, completedAt, updatedAt }` and hold it. An "Undo
complete" action appears on the task row (or in the top bar when a row is
selected) and, on confirm, writes back `status = 'todo'` and `completedAt =
null`. It must run inside a single DB transaction, and for crash safety the
undo decision is applied to the same `tasks` table (nothing extra to restore).
Persist the stack in settings as `taskUndoStates: { [id: number]:
{ status: string; completedAt: string | null; updatedAt: string }[] }` capped at
50 entries.

### 2.2 Trash instead of hard delete

Add `deleted_at TEXT` to `tasks`. `listTasks(db, filter?)` excludes rows where
`deleted_at IS NOT NULL`. `setTaskStatus(db, id, 'deleted')` marks it
soft-deleted; `restore` clears it. `deleteTask` becomes `softDeleteTask`. The
UI has a "Trash" view and a per-task "Delete" that moves to trash; a `clearTrash
(db)` does a hard DELETE (only after confirmation), which the import/restore
path would have to handle. The API gains `tasks:softDelete(id)`,
`tasks:restore(id)`, `tasks:clearTrash()`. The board/list and all filters
exclude trashed tasks by default; a `trash: true` filter shows them.

### 2.3 Edit

The current `TaskEditor` is the single edit surface for title/notes/due date/
time/priority/status/project/tags/recurrence. `TaskInput` normalize validates,
and the editor shows per-field messages with focus on the first bad field,
exactly as the current code does. The improvement is that due date + due time
are two fields, status is a two-step selector, and editing always uses the same
validator as create.

---

## 3. Organization

### 3.1 Projects and tags, kept light

Projects: a `projects` table with `id TEXT` (stable, deterministic from the
name, e.g. a slug) so no project ID is ever lost on export/import, plus a
`projectId` column on `tasks`. Tags: a `tags` table with `id TEXT` + `color`;
a `task_tags` join table. Tags are searchable/filterable but never force a
hierarchy. A task may have a project OR none; tags are free-form and dedupe by
lowercase name.

### 3.2 Subtasks with progress on the parent

Keep `task_subtasks` with a `done` flag and `sort_order`. The parent renders
`doneCount/total` and a progress bar; the percentage is a pure function
`subtaskProgress(subtasks)`. The parent's own completion status stays independent
of its subtasks (a task is done when explicitly marked done, even with
unfinished subtasks — or the app offers "mark with subtasks done" as a separate
action). The progress bar is a pure calculation; unit tests cover the split
and zero-subtask edge cases.

### 3.3 Search, sort, saved filters

- Global search via the existing `search:run` IPC, searching task metadata
  including note, tags, project, and title — with `taskMatchesText` in
  `src/shared/tasks.ts` as the pure rule.
- Sort: a `sort` filter with options `dueDate`, `createdAt`, `priority`, `title`,
  `manual`, most recent first.
- Saved filters: store `taskFilters` in settings as `{ id, label, view, sort,
  text, priority, project, tag }[]`, exposed through new `tasks:filters:get` /
  `tasks:filters:set` IPC and rendered as quick-filter chips in the task
  toolbar.

---

## 4. Time handling

### 4.1 Today / Upcoming

- `today` view: tasks due today (checked against `due_date` + `due_time`), plus
  any task with no due date (always visible, "undated"). This answers "what
  should I do now?".
- `upcoming` view: due in the next 7 days, undated tasks last.
- Pure rules in `src/shared/tasks.ts` (`tasksDueToday(tasks, today)`,
  `tasksUpcoming(tasks, today, horizonDays)`), tested separately from the UI.

### 4.2 Recurrence as a rule that generates instances

Replace the current `recurrence` JSON + `parent_task_id` chain with a
`recurrence_rule` column on `tasks` storing `{ frequency: 'daily' | 'weekly' |
'monthly' | 'custom', interval: number }` and `recurrence_next` (the id of the
instance that continues the chain, or NULL). Instances are resolved on read:

```ts
// src/shared/tasks.ts
export function instanceDates(rule, from, to): string[]      // local YYYY-MM-DD
export function resolveOccurrences(tasks, today, windowDays): Task[]
```

"Skip one occurrence" is a single update on the chain pointer (`recurrence_next
= <skip target>`), never a re-derived series. Weekly/monthly/custom dates are
computed with local calendar arithmetic (clamping month ends), not UTC Date
math. Unit tests: daily/weekly/monthly/custom date math, skip-one, chain
pointer updates.

### 4.3 Overdue handling

- Overdue = tasks with `due_date < today` and `due_time < now`, status not
  done, and not trashed. Present as an "Overdue" section in the task page and a
  "Today" card on the dashboard.
- The Overdue view is no longer a giant red pile. Overdue tasks get a
  soft-bordered badge with a "Reschedule" and "Snooze" action; the main view
  shows them inline as `Overdue · 14 Oct`.
- Bulk reschedule: select several overdue tasks, pick "Reschedule to today" or
  "Snooze 1 day" from the bulk toolbar. `setTasksStatus` supports
  `'rescheduled'` which sets `due_date = today` (or next day) and `due_time =
  09:00`.
- A gentle "X tasks overdue, pick up here" empty state appears when the overdue
  list is empty but there are undone tasks due later.

### 4.4 Optional reminders with snooze

Reminders are optional and off by default. They are derived, not emitted: a
task is "reminding" when `due_time` is set and not yet passed; snooze is a
5/10/15-minute repeat. The "Reminders" toggle in Settings enables the reminder
channel; the only channel is an in-app banner (no OS notifications). Pure
function `pendingReminders(tasks, now)` returns `{ id, title, minutesLeft,
snoozeUntil }[]`, tested for edge cases. Snooze = set `due_time` to `now + N
minutes` and store `remindedAt` for analytics.

---

## 5. Multiple views of the same data

### 5.1 List, Today, Kanban read from one model

The Tasks page keeps three render paths over a single `tasks` array.
`groupTasksForBoard` in `src/shared/tasks.ts` is the only place that splits
into `todo | in-progress | done`. The board's drag-and-drop "move to another
column" is a status change — `setStatus(id, status)` — which the list sees
through the same `listTasks` query. No second data path. The current
`TaskBoard` already uses `groupTasksForBoard`; the improvement is to make
drag-and-drop and keyboard move use the same `window.api.tasks.setStatus` as
the list.

### 5.2 Calendar view (extra, not essential)

Implement the calendar as a pure function layer: `src/shared/calendar.ts` already
exists and is tested. The new `tasks` calendar points to
`tasks:calendar({ month, today })` IPC, which returns, for each day of the
month grid, the tasks due that day grouped by status (`todo`/`in-progress`/
`done`), plus `pendingReminders` counts. It reads resolved instances from
`src/shared/tasks.ts` rather than the raw table. Marked "nice extra" — implement
last, or not at all if time runs out.

---

## 6. Planning and review

### 6.1 Daily "pick today's tasks" step

A small, always-visible widget on the Tasks page: "Today's pick" lists the
tasks due today, and the user can check them into "Done today" with one click.
This is the same list as the `today` view, so a single refresh covers both.
The point is not a new data model but a one-command "commit to today" action
that moves the picked tasks from `todo` to `in-progress` (or `done`) so the day
has a plan. Pure rule: `pickToday(tasks, today)` returns the set to offer; no
statistics are stored for this.

### 6.2 Weekly review

A "This week" section on the Tasks page (or a link from the Dashboard/Review
tool) that shows: completed this week, tasks still not done, what slipped, and
a "drop / keep" action per task. Pure logic lives in `src/shared/tasks.ts`
(`taskReview(tasks, start, end)` — already exists for the Review tool — reused
here). The review window is the Review tool's week/month summary, reading from
the same task rows including `createdAt`, `updatedAt`, `completedAt`, and the
new `deleted_at`.

### 6.3 "Someday/maybe" bucket

A `someday` project (or a dedicated toggle column). Tasks are "maybe" when they
live in the `someday` project and have no due date. The bucket is a list, not a
tag: `taskProjectIs(tasks, 'someday')` is a pure function in
`src/shared/tasks.ts`, filtered from the active list by default but visible in
the "All" view with a filter chip. This keeps ideas out of the active list
without forcing a second hierarchy.

---

## 7. Data and trust

### 7.1 Local-first + export/import + backups

- Export: JSON (all tools, including tasks) and CSV (trades) are already
  implemented in `src/main/backup.ts` and `src/shared/backup.ts`. Extend JSON
  export to include the new `deleted_at`, `due_time`, `projectId`,
  `recurrenceRule`, and reminder fields.
- Import: `parseBackup` in `src/shared/backup.ts` already checks the schema
  version and rejects unknown fields. Extend the import path to validate the new
  columns: `deleted_at` must be null or a date; `due_time` must be null or
  `HH:MM`; `recurrence_rule` must be a valid rule object. Invalid files are
  rejected before anything is replaced, with a plain message naming the bad
  field.
- Backups: the existing `dailyBackup` in `src/main/db.ts` is a full SQLite copy
  per day with 14-file retention. Add a **manual full backup** button in
  Settings that copies the database to `backups/everything-YYYYMMDD-HHMMSS.db`,
  keeping the 14-file rolling retention. Backups are local-only; no network.

### 7.2 Persisted changes / crash safety

Since the app uses SQLite with WAL mode and a single-writer transaction, every
save is already atomic. The new persistent fields — `createdAt`, `updatedAt`,
`completedAt`, `deletedAt`, `dueTime`, `projectId`, `recurrenceRule`, `position`
— are all written in the same `INSERT`/`UPDATE` transaction as the row, so a
crash cannot leave a task half-written. No extra code is needed for this; the
improvement is that these fields exist and are included in export/import. A
`preSaveHook` exists in `main/tasks.ts` for any derived commit timestamps.

### 7.3 Timestamps on every task

Added: `createdAt`, `updatedAt`, `completedAt`, `dueTime`, `deletedAt`,
`remindedAt`, `position` on `tasks`. They cost nothing to store now (all `TEXT`
or `INTEGER`), and they power every future statistic. The existing tests cover
`updatedAt` not being overwritten when a field is unchanged (`updateTask` only
sets `updatedAt` when data actually changed).

---

## 8. Feel

### 8.1 Keyboard shortcuts

A Settings page "Shortcuts" tab lists every shortcut with a `keydown` listener
per module, following the existing `settingsStore` pattern. Relevant:
`Ctrl+N` (new task), `Ctrl+1/2/3` (views), `Ctrl+F` (search), `Ctrl+S` (save),
`Ctrl+Enter` (save/edit confirmation), `Delete` (trash), `Alt+←/→` (move card
between columns in board), `Ctrl+Shift+Z` (undo last complete), `Alt+Shift+I`
(open Today). The palette (`CommandPalette.tsx`) already uses `Ctrl+K`/Esc/
ArrowUp/Down/Enter; extend it to include the task actions.

### 8.2 Bulk actions

Multi-select with `Ctrl+click`, `Shift+click`, and `Select all` in the list
view (already implemented in `Tasks.tsx`). New bulk actions: `Mark done`,
`Reopen`, `Delete (to trash)`, `Reschedule to today`, `Snooze 1 day`, `Tag
#x`, `Move to project`. All bulk actions go through single transactions
(`setTasksStatus` already batches; extend it to accept a status plus a payload).
The board's drag-and-drop move and reorder use the same `setStatus` / `reorder`
API.

### 8.3 Drag to reorder, stable manual order

`reorderTasks(db, orderedIds)` already exists and writes `sort_order` per id.
The replacement is `position` stored as a decimal-valued float (or a `TEXT`
ordering value like a decimal interleaved from the existing float). Moving a
card sets the target's `position` to the midpoint between its two neighbours,
so inserts never require touching the whole list. The board reorders by
`position` in the saved order, and the list sorts by `position` too. No
re-numbering; O(1) moves.

### 8.4 Speed with thousands of tasks

- Index `tasks(status, due_date, created_at, position)` and `tasks(deleted_at)`
  (new schema), replacing the single `status+due_date` index with a covering
  index.
- `listTasks(db, filter)` uses a prepared `SELECT * FROM tasks WHERE
  deleted_at IS NULL AND ... ORDER BY position`.
- For very large lists, the renderer fetches in pages on scroll
  (`tasks:listPage(db, filter, from, size)`), but the default fetch keeps the
  current single-round-trip contract for the typical case.
- Subtask counts and progress are pre-aggregated in a
  `task_subtask_counts` column updated in the same transaction as the
  subtasks, so the parent row is never joined per row.

### 8.5 Good empty states

- **Blank Today:** "Nothing due today — great. Add one thing if you want, or
  leave the day open." with a single primary button that creates a task dated
  today.
- **All cleared:** "No tasks. This page is yours to fill, or ignore." with a
  "New task" button.
- **Trash empty:** "Trash is empty — nothing was deleted, and nothing will
  come back."
- **Search no matches:** "No tasks match “phrase”. Try a different word, or a
  date like “2026-10”." with a "Clear search" button.
- **Underused "Someday" bucket:** "Ideas you've parked. Nothing here is due, so
  nothing is blocking a real day."

---

## 9. Data-model changes to migrate

Migration numbers (applied to `user_version`):

- 9: `due_time` column (`TEXT`, `'HH:MM'` or NULL) on `tasks`, project renamed
  to `projectId` (`TEXT`; a `projects` table may be added in the same
  migration).
- 10: `deleted_at` column (`TEXT` or NULL) on `tasks`; all old queries add
  `AND deleted_at IS NULL`.
- 11: `position` column (`REAL`, default 0) replaces `sort_order`; `reorder`
  uses position semantics.
- 12: `recurrence_rule` `TEXT` (serialized rule object) + `recurrence_next`
  `INTEGER`; the old `recurrence` JSON + `parent_task_id` get
  `UPDATE ... SET recurrence_rule = ..., parent_task_id = NULL` before they are
  unused.
- 13: `due_time` is stored on `tasks` and a `task_instances` view resolves
  dates for reads.
- 14: `remindedAt` and `position` are populated for existing rows; the
  reminders channel defaults off.

`src/main/migrations.ts` is the only place schema changes live; every entry is
additive and rerun-safe. Export/import round the `recurrence_rule` through
`JSON.stringify`/`JSON.parse` with validation on both ends.

---

## 10. Files to change (summary)

Core:
- `src/shared/types.ts` → add `dueTime`, `deletedAt`, `position`, `projectId`,
  `recurrenceRule`, reminder fields.
- `src/shared/tasks.ts` → new pure functions: `tasksDueToday`, `tasksUpcoming`,
  `resolveOccurrences`, `instanceDates`, `subtaskProgress`, `pickToday`,
  `taskReview`, `pendingReminders`, `taskProjectIs`; validators for `dueTime`/
  `projectId`/recurrence rule.
- `src/main/tasks.ts` → new schema migration 9–14, `listTasks` with filter
  support, `softDeleteTask`/`restoreTask`/`clearTrash`, `reorderPosition`,
  `setTasksStatus` with new statuses, `resolveOccurrences`,
  `instanceDates`, `taskCalendar`, `subtaskProgress` as a SQL aggregate.
- `src/main/index.ts` → new IPC calls: `tasks:listPage`,
  `tasks:softDelete`, `tasks:restore`, `tasks:clearTrash`,
  `tasks:filters:get/set`, `tasks:calendar`, `tasks:position`.
- `src/main/migrations.ts` → additive schema 9–14.
- `src/preload/index.ts` → expose the new IPC surface.

UI:
- `src/renderer/src/modules/Tasks.tsx` → Today/Upcoming views, overdue badge +
  reschedule/snooze actions, bulk actions (done/reopen/trash/reschedule/
  snooze/tag/move), keyboard shortcuts, drag-and-drop reorder by position,
  empty states, "Today" widget, "Someday" filter chip.
- `src/renderer/src/modules/TaskEditor.tsx` → due date + due time fields,
  two-step status, inline quick-add (title + modifiers), undo for complete,
  trash vs delete.
- `src/renderer/src/modules/TaskBoard.tsx` → board reads the same
  status/status-filtered columns; drag-and-drop uses the same `setStatus`
  API.
- `src/renderer/src/components/TagInput.tsx` / `TagChip.tsx` → tags stored in
  the `tags` table with colors.
- `src/renderer/src/lib/useTaskFilters.ts` → saved filters + new sort
  options.
- `src/renderer/src/modules/Calendar.tsx` → optional calendar view from
  `tasks:calendar`.
- `src/renderer/src/modules/SettingsPage.tsx` → Shortcuts tab, Reminders
  toggle, Backup button.
- `src/renderer/src/lib/dates.ts` → `today()` stays local; add `formatDateTime`,
  `parseDueTime`.
- `src/renderer/src/components/EmptyState.tsx` → empty states updated.

Data/backup:
- `src/shared/backup.ts` → export/import validation extended for new fields.
- `src/main/backup.ts` → manual backup button + retention unchanged.
- `src/renderer/src/modules/SettingsPage.tsx` → export/import, backup,
  shortcuts.

---

## 11. Tests to add (targets, not exhaustive list)

- `src/shared/tasks.ts`:
  - `tasksDueToday`, `tasksUpcoming`, `resolveOccurrences` (daily/weekly/monthly/
    custom, skip-one, empty).
  - `instanceDates`, `subtaskProgress`, `pickToday`, `taskReview`,
    `pendingReminders`, `taskProjectIs`.
  - Bulk reschedule/snooze writes via `setTasksStatus` with transactions.
- `tests/tasks.ts`:
  - Full lifecycle: create with `dueTime`, update, soft delete, restore,
    clear trash, export/import round-trip.
  - Recurrence: generate instances, skip one occurrence, change interval on a
    rule, chain pointer updates.
  - Bulk: multiple status changes in one transaction; partial failure changes
    nothing.
  - Position: move one card, no other `position` changes; 1000 tasks loaded in
    pages, sorted stable.
  - Overdue: boundary cases (due date today with time, due date yesterday, done
    tasks excluded, trashed tasks excluded).
  - Calendar: month grid with tasks due on the first/last day,
    neighbouring-month greyed days.
  - Validation: impossible `due_time`, unknown project id, invalid recurrence
    rule, duplicate tag, empty title.

---

## 12. Execution order

1. **Schema + pure rules** — migration addition (9–14), `src/shared/tasks.ts`
   additions, `src/main/tasks.ts` rewrites, `src/main/index.ts` + `preload` IPC
   surface. This is the foundation; nothing UI depends on later steps changes
   this layer.
2. **Data path** — `listTasks` with filter, `softDelete`/`restore`/
   `clearTrash`, `reorderPosition`, `resolveOccurrences` on the read side.
   Verify with `npm test` and focused unit tests.
3. **Renderer** — Tasks page and TaskEditor, TaskBoard, tags, filters,
   shortcuts, empty states. Ground every UI interaction against step 2.
4. **Backup/import/export** — extension of `parseBackup` validation, manual
   backup, export/import round-trip tests.
5. **Review/verify** — `npm run typecheck && npm test`, then a focused manual
   pass of the key flows (capture, board status move, skip occurrence, bulk
   reschedule, soft-delete/restore, export/import).

---

## 13. Risks and open decisions

- **Time-of-day + timezone.** `due_time` is `HH:MM` on the local clock, and
  `resolveOccurrences` checks `due_date < today` or `due_date === today &&
  due_time < now`. All date arithmetic is local (`YYYY-MM-DD` + `HH:MM`), so
  DST and timezone shifts do not move a due date.
- **Export/import compatibility.** Old backups made before `due_time` existed
  read as NULL; a missing field is a valid default. Import validation must
  accept both old and new shapes. The `schemaVersion` field in the backup JSON
  tells the importer which checks to run.
- **Recurrences vs. current children.** The `parent_task_id` + `recurrence`
  JSON on each child is rewritten into `recurrence_rule` + `recurrence_next`,
  then removed. The migration must preserve every task's rule as-is; this is a
  one-way rewrite that runs at startup on the next version bump.
- **Performance.** For the typical user (hundreds of tasks), the single-query
  approach is fine. The `tasks:listPage` pagination is added only if
  profiling shows a problem; it is not required for the requested scope.
- **Reminders.** Off by default, local-only, no OS notifications. Reminder
  state is derived from the task row, so there is no separate notification
  table and no wrong notifications.

---

## 14. What this plan deliberately does not include

- Deep nesting or nested task hierarchies. Projects and tags are flat.
- Notifications by default. Reminders are off unless the user enables them.
- A full re-platform. The codebase keeps its existing layer separation, theme
  tokens, and IPC surface.
- Calendar as a first-class feature. It is a "nice extra" that can be
  implemented last or dropped.
