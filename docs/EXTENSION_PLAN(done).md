# Feeblest's Everything: Extension Plan

*Prepared 2 November 2026. Builds on the current app: Electron, React, Tailwind, SQLite, local-only.*

## 1. Summary

This plan adds five new modules (Expenses and Budget, Notes, Focus timer, Content planner, Tools) and five cross-cutting features (Links, Tags, Trash and Undo, Templates, a customizable Dashboard). The cross-cutting features are what turn separate tools into one app, so they are built first as a shared foundation. Every module after that plugs into the same contract instead of being retrofitted.

Decisions already made:

- Currency conversion uses manual rates you enter (fully offline).
- The Content planner is included, since you start making video next week.
- One phased roadmap with explicit dependencies (this document).

## 2. Where everything lives

New entries are marked **(new)**. This keeps your existing sidebar groups and only adds items where they belong.

| Group | Items |
| --- | --- |
| Top level | Dashboard (customizable), Review, Daily briefing, Insights, Assistant, Calendar |
| Money | Trades, Savings, **Expenses (new)** |
| Productivity | Habits, Tasks, **Focus (new)**, **Content (new)**, Intelligence |
| Notes | Logbook, **Notes (new)** |
| Utilities | **Tools (new)**, **Tags (new)**, **Trash (new)**, Search |
| Bottom | Dark mode, Settings (gains Templates and Modules sections) |

Placement reasoning:

- **Expenses** is one page with tabs (Overview, Transactions, Budgets, Recurring), so Money grows by one item, not four.
- **Tags** and **Trash** span every tool, so they sit in Utilities rather than inside Notes.
- **Tools** is a single hub page. The seven small tools are tabs inside it, which avoids flooding the sidebar.
- **Templates** are managed in Settings, but picked from the "New" menu inside each tool.
- **Content** is optional. Add a Settings > Modules toggle so any module can be hidden and the sidebar stays clean.

## 3. Architecture principles

These rules apply to every phase. Agreeing on them now prevents rework later.

**The module contract.** Your registry already drives the sidebar and command palette. Extend it so each module declares, in one place, everything it contributes:

- route and sidebar entry
- search provider (what Search can find)
- calendar provider (events it adds)
- insights provider (datasets Insights can use)
- assistant tools (questions the Assistant can answer from its data)
- dashboard widgets
- linkable type (label, icon, how to open and preview an item)
- quick-capture action
- command-palette actions

A module that implements the contract automatically shows up everywhere. This is the single most important design decision in the plan.

**Data rules.**

- Money is stored as integer minor units (cents) plus a currency code. No floats for amounts.
- Every user-facing table gets `deleted_at` (soft delete) and `updated_at`.
- Days are bucketed by local date, consistently, the same way your backup filenames already are.
- Migrations are versioned, and a backup is taken automatically before any migration runs.
- Relationships between different kinds of items use the generic `links` table, not per-pair foreign keys.

**UI rules.**

- No hardcoded colours. Everything must work in both Modern and Classic styles and in every colour theme.
- Everything is keyboard accessible.
- Empty states explain the feature and offer a template or first action.

**Dependencies.** Nothing new is added without asking you first. Candidates are collected in section 13.

## 4. Roadmap at a glance

| Phase | Scope | Depends on | Size |
| --- | --- | --- | --- |
| 0 | Foundation: module contract, Links, Tags service, Trash and Undo, Templates engine, search index | none | L |
| 1 | Expenses and Budget | 0 | L |
| 2 | Notes and the Tags page | 0 | M |
| 3 | Content planner | 0, 2, Tasks board | M |
| 4 | Focus timer and time tracking | 0, Tasks | M |
| 5 | Tools hub | none (can run in parallel from Phase 1) | M |
| 6 | Customizable Dashboard, Templates manager, integration pass | 0 to 5 | M |

Notes on ordering:

- Phase 1 comes first after the foundation because spending is the biggest gap in the app.
- Content sits before Focus because you start making video next week. Until Phase 3 ships, capture ideas in Notes (Phase 2) with a `#video-idea` tag.
- Phase 5 is independent filler work. Two small connections exist (shared exchange rates and loan-to-recurring-bill), covered below.
- Each module registers its own dashboard widget in its own phase. Phase 6 only adds the customization UI.

## 5. Phase 0: Foundation

**Goal.** Build the shared plumbing once, so later phases are mostly UI and queries.

**Scope.**

1. **Module contract** (section 3), applied to your existing modules too, so Trades, Savings, Habits, Tasks and Logbook join Links, Tags and Search from day one.
2. **Links service.** A `links` table: `source_type, source_id, target_type, target_id, relation, created_at, deleted_at`. Queries read both directions, so a link made from either side shows on both. A reusable **Linked items** panel plus an item picker (the command-palette search UI, reused).
3. **Tags service.** `tags` (id, name, colour) and `taggings` (tag\_id, entity\_type, entity\_id). A shared tag input with autocomplete. Names are lowercased and trimmed, and `parent/child` tags are allowed.
4. **Trash and Undo.**
   - Soft delete on all tables through one repository helper that filters `deleted_at IS NULL` by default.
   - Session undo: a "Deleted. Undo" toast and Ctrl/Cmd+Z for the last few actions.
   - Trash page with restore, delete forever, and auto-purge after 30 days (configurable).
5. **Templates engine.** A `templates` table (kind, name, payload JSON, is\_builtin) with variables such as `{{date}}` and `{{weekday}}`, plus "Save as template" from any item. The manager UI comes in Phase 6.
6. **Search index.** One shared SQLite FTS5 table fed by each module's search provider, replacing per-module LIKE queries. Search then covers Notes, Expenses and Content without slowing down.
7. **Settings > Modules.** Toggle modules on and off.

**Edge cases to design for now.**

- Every total in the app (savings balance, trade P&L, habit streaks) must exclude trashed rows. Add tests for this, since a restored or trashed deposit silently changing a balance is exactly the bug to prevent.
- Deleting a parent (a task with subtasks) trashes the whole group under one `delete_batch_id`, and restoring brings the group back together.
- Links to a trashed item are hidden, and reappear when the item is restored.
- Undo is for the last few actions only. Real recovery from purged data is the daily backup's job. Do not promise a global time machine.

**Done when.** Existing modules are on the contract, deleting a trade or deposit is undoable and shows in Trash, totals ignore trashed rows (tested), and you can link a task to a journal entry and see it from both sides.

## 6. Phase 1: Expenses and Budget (Money)

**Goal.** Answer "where is my money going, and how much can I still spend?"

**Scope (MVP).**

- **Transactions.** Amount, date, category, payee, note, tags. Types: expense, income, and transfer. Include simple income entries, because "left to spend" needs to know what came in. Transfers to Savings are not expenses.
- **Categories.** Seeded defaults (Food, Transport, Housing, Bills, Health, Fun, and so on) with colour and icon, editable, archivable (archive instead of delete once used).
- **Budgets.** A budget amount per category per month, with a "copy last month" button. An optional per-category rollover is a v2 candidate.
- **Recurring bills and subscriptions.** Name, amount, cadence (weekly, monthly, yearly, custom), next due date, category, reminder lead time, autopay flag, and an optional trial-end date. Marking one as paid creates the transaction.
- **Left to spend this month.** Defined explicitly:

  `left to spend = total monthly budget − spent so far − bills still due this month`

  Also show a **safe to spend per day** figure (left to spend divided by days remaining).
- **Views.** Overview (the big number, category budget bars, upcoming bills), Transactions (filter, search, bulk edit), Budgets, Recurring (with monthly and yearly subscription totals).
- **Fast entry.** The Quick capture "expense" action (amount, category, note). Natural-language add such as `coffee 3.5` is a strong fit for your intelligence layer.

**Connections you asked for.**

- **Calendar:** bills due appear as events and can be marked paid from the Calendar.
- **Savings:** a month-end prompt, "You have X left. Move it to a goal?" Creating the deposit and the transfer must happen in one database transaction so nothing is double counted.
- **Insights:** spending vs mood (daily spend joined with Logbook mood), category trends, no-spend days vs habits.
- **Assistant:** tools for spending by category and range, budget status, and upcoming bills.
- **Review:** a spending section in the weekly and monthly review.
- **Dashboard:** a "Left to spend" widget.

**Edge cases.**

- The app is local-only and may not be open when a bill falls due. Recurring generation must run on launch, catch up on missed periods, and be idempotent (unique on `recurring_id + due_date`).
- Month boundaries and variable month lengths (a bill due on the 31st).
- Money used for Trades is not spending. Keep trade funding out of expense totals.
- Currency: store a currency code on every transaction and have one base currency setting. Multi-currency reporting is v2 and reuses the exchange rates from the Tools phase.

**Later (v2).** CSV import and export, receipt attachments, rollover budgets, a spending forecast, and a hide-amounts (blur) privacy toggle.

**Done when.** You can log an expense in under five seconds from Quick capture, set a budget, see the left-to-spend number change, mark a bill paid from the Calendar, and move leftover money into a Savings goal. Budget and recurring math have unit tests.

## 7. Phase 2: Notes and the Tags page (Notes)

**Goal.** A home for undated material: ideas, reference, checklists, meeting notes. Logbook stays the dated journal.

**Scope (MVP).**

- **Markdown editing** with live preview, autosave (debounced), and a word count.
- **Tags, pinning, and archive.** Pinned notes sort to the top. There are no folders in v1: tags plus pins plus search is enough, and you can add collections later.
- **Checklist notes.** Markdown task lists (`- [ ]`) with a "Send item to Tasks" action.
- **Wiki links.** Typing `[[Note title]]` creates a link and shows backlinks on the target. This gives you the Obsidian-style feel for free through the Links service.
- **Templates.** A meeting note and a blank checklist ship built in.
- **Search.** Full-text, with a `#tag` filter.
- **Promote.** "Convert to note" from a Logbook entry, and "Convert to journal entry" the other way.

**Tags page (new, Utilities).**

- Every tag with counts per tool, and a click opens a mixed-type list grouped by tool.
- Rename (applies everywhere), merge two tags, change colour, delete (removes the tagging only, never the items).
- Tag autocomplete is the same component in every tool.

**Security note.** Markdown rendering inside Electron needs care. Render with raw HTML disabled, sanitize the output, and keep opening links through your hardened `shell.openExternal` path.

**Later (v2).** Revision history (the last N versions), pasted-image attachments stored in the app data folder, and a graph view.

**Done when.** You can create, tag, pin and find a note from Search and the command palette, link it to a task, and browse it from the Tags page.

## 8. Phase 3: Content planner (Productivity)

**Goal.** A pipeline for videos and streams, from first idea to published.

**Scope (MVP).**

- **Board** with the stages Idea, Script, Record, Edit, Publish, and Published. Reuse your Tasks Kanban component.
- **Content item.** Title, type (video, short, stream, post), platform, hook, target publish date, published date and URL, tags, and a series.
- **Script** as a linked Note (so you get markdown and backlinks), created in one click from the item.
- **Per-stage checklists** from templates, for example Record (audio check, lighting, backups), Edit (cuts, captions, thumbnail), Publish (title, description, tags, schedule).
- **Calendar:** the publish date appears as an event. Optional per-stage due dates ("record day") also show.
- **Streams:** a scheduled start and duration, plus a run-of-show checklist.
- **Idea inbox:** a Quick capture "content idea" action, so ideas land the moment you have them.
- **Assets by path.** Store references to local files instead of copying large video files, and warn if a path goes missing.

**Connections.**

- **Tasks:** generate the stage tasks from a template.
- **Focus (Phase 4):** time spent per video and per stage.
- **Expenses:** tag gear and software costs to a content item or project.
- **Insights and Review:** videos published per month against a target, and output cadence vs focus time.
- **After publishing:** manual entry of views and notes at 24 hours and 7 days. This is manual because the app is local-only.

**Done when.** You can capture an idea, move it through the board, see its publish date on the Calendar, and open its script and checklist from the card.

## 9. Phase 4: Focus timer and time tracking (Productivity)

**Goal.** Know where your hours go, per task and per project.

**Scope (MVP).**

- **Pomodoro timer** with focus, short break and long break. Defaults are 25, 5 and 15 minutes, with a long break after 4 rounds, all configurable. A count-up mode handles open-ended work.
- **Tie to a task** (optional). Project comes from the task or is picked directly. If Tasks has no project concept yet, add a lightweight `projects` table in this phase.
- **Sessions log.** `time_sessions`: task, project, started, ended, planned and actual seconds, type, completed, note.
- **Manual entry** for time you forgot to track.
- **Reports.** Today, week and month, by task and project, estimated vs actual, and a focus heatmap.
- **Native notification and sound** when a session ends, plus a small tray or mini-window display of remaining time.
- **Quick capture / command palette:** "Start focus on task…".

**Electron-specific design (important).**

- Do not count ticks. Store `started_at` and compute remaining time from the clock, because renderer timers throttle when the window is hidden or minimized.
- Persist the running session to the database so a crash or restart restores it.
- Handle system suspend and resume with Electron's power events.
- Only one active session at a time. Sessions that cross midnight are split by local day for reports.
- Run the timer logic in the main process or a shared service, so Tools > Stopwatch and Focus count-up share one engine.

**Connections you asked for.**

- **Insights:** focus time vs mood.
- **Assistant:** "How many hours did I spend on X?" via a time-spent tool.
- **Habits:** an optional auto-check habit such as "Deep work: 2 hours".
- **Tasks:** total tracked time on each task card.
- **Dashboard:** a widget showing today's focus minutes and a Start button.
- **Review:** a focus-hours section.

**Done when.** A session survives closing the window and restarting the app, appears in reports on the right day, and the Assistant can answer a time question.

## 10. Phase 5: Tools hub (Utilities)

One page, one tab per tool, each registered in the command palette ("Loan calculator"). Pin favourites to the top of the hub. No new dependencies are needed for any of these.

| Tool | Details |
| --- | --- |
| Loan | Principal, rate, term, with outputs for monthly payment, total interest, payoff date and a full amortization table. An extra-payment option shows time and interest saved. Action: "Create recurring bill" from the result (ties to Expenses). Needs unit tests and a stated rounding policy. |
| Stopwatch | Laps and splits, space bar to start and stop, continues running when you switch pages. Optional "Log to task", which turns it into a Focus session. |
| Scratchpad | Plain-text autosaving pads, no title or tags required. "Save as note" promotes one to Notes. Quick capture can append to it. |
| Snippets | Title, body, tags. Copy to clipboard with Electron's clipboard API, and a command-palette action "Copy snippet…". Variables like `{{date}}` come later. Auto-pasting into other apps is intentionally left out because it needs OS keystroke simulation and extra dependencies. |

**Suggested extra tools (optional, v2).**

- **Date calculator:** days between dates and adding durations.
- **Savings projection:** "When will I reach this goal at X per month?", pulling the goal from Savings.
- **Bill split and tip.**
- **Time zone converter:** useful for scheduling streams for an audience elsewhere.

**Done when.** Every tool works offline, each has keyboard support and a copy action, and math tools have unit tests.

## 11. Phase 6: Dashboard, Templates manager, integration pass

**Customizable Dashboard.**

- A widget registry: each widget has an id, title, allowed sizes (S, M, L), optional settings, and a data loader.
- Layout is stored as JSON in settings, as an ordered list on a 12-column grid. Free-form drag-resize is deliberately skipped in v1.
- Edit mode: add, remove, reorder (drag, plus keyboard move up and down), resize between the preset sizes.
- Presets such as Minimal, Money focus and Daily, and a Reset to default.
- Handle widgets whose module is disabled or removed gracefully, and load widgets lazily.

**Templates manager** (Settings > Templates).

- Journal entries, tasks (with subtasks, default tags, priority, recurrence), note templates, content stage checklists and **trade checklists**.
- Built-ins are resettable. "Save as template" works from any item.
- **Trade checklist idea:** a pre-trade and post-trade checklist copied onto each trade when it is created. Insights can then compare outcomes for trades where the checklist was completed vs skipped. This is tracking your process, not trading advice.

**Integration pass.** Walk the matrix in section 12, fill any gaps, and make sure Insights, Assistant, Review and Daily briefing all know about the new data.

**Done when.** You can rearrange the dashboard, it survives restarts, and every cell in the matrix below works.

## 12. Integration matrix

| Module | Calendar | Search | Insights | Assistant | Dashboard | Review | Quick capture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Expenses | Bills due | Transactions | Spend vs mood | Spend by category | Left to spend | Spending section | Add expense |
| Notes | none | Full text, tags | Notes per week | Find and summarize | Pinned notes | Notes created | New note |
| Focus | Optional sessions | Sessions | Focus vs mood | Hours on X | Today's focus | Focus hours | Start focus |
| Content | Publish dates | Items | Output vs focus | Pipeline status | Next to publish | Videos published | Content idea |
| Tools | none | Snippets, pads | none | none | Pinned tools | none | Append to scratchpad |

## 13. Dependencies to approve before adding

Nothing below is added until you say yes.

- **Markdown rendering** (needed in Phase 2): a small renderer such as `marked` or `markdown-it`, plus `DOMPurify` for sanitizing. A zero-dependency minimal renderer is possible but limited.
- **Markdown editor** (optional): CodeMirror 6 for a richer editing experience. A plain textarea with live preview works for the MVP.
- **Drag and drop** (Phase 6 and the Content board): reuse whatever your Tasks board already uses, otherwise `dnd-kit`.
- **FTS5 support**: check that your SQLite build includes it. Most common Electron SQLite bindings do.

No dependency is needed for the timers, Tools, Expenses or Links.

## 14. Testing and definition of done

Every phase is complete only when all of these are true:

- Migrations run on a copy of real data, with the pre-migration backup verified.
- Unit tests cover money math (budgets, left to spend, loans, currency, unit tables), recurring generation (catch-up, idempotency, month ends), time bucketing (midnight splits), and "totals ignore trashed rows".
- The module contract is fully implemented (search, command palette, quick capture, and the dashboard widget).
- Looks right in Modern and Classic styles and across colour themes, with no hardcoded colours.
- Keyboard accessible, with useful empty states.

## 15. Risks and how to handle them

- **Scope creep.** Each feature above has an MVP and a v2 list. Ship the MVP, then revisit.
- **Sidebar growth.** Module toggles and pinning keep it manageable.
- **Data integrity across modules.** Soft deletes and generic links can leave stale references. The repository helper and the tests in section 14 are the guard.
- **Performance.** The shared FTS index, lazy dashboard widgets, and indexed date and foreign columns keep Insights and Search fast as data grows.
- **Heavy Insights queries.** Cache computed results and recompute on change or on a schedule, rather than every page open.

## 16. Open decisions

None of these block Phase 0, but each should be settled before the phase that needs it.

1. Does Tasks already have projects? (Decides whether Phase 4 adds a `projects` table.)
2. Base currency and the first day of the week (needed for Phase 1).
3. Markdown editor approach: textarea plus preview, or CodeMirror (Phase 2).
4. Should unused budget roll over to next month, or reset each month? (Phase 1 v2, but worth deciding early.)
5. Which stages and checklists do you want built in for the Content planner? (Phase 3, ideally after you have made your first video.)
