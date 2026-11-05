# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.0] - 2026-11-03

### Phase 5: Tools hub
- **Tools** (Utilities): one page, four tabs — **Loan**, **Stopwatch**, **Scratchpad**, **Snippets**. Pinned tools sort to the front of the tab strip.
- **Loan calculator**: principal, annual rate, term and optional extra payments; monthly payment, total interest, total paid, payoff date and the full amortization table, plus how much an extra payment saves in interest and months.
- **Rounding policy** (stated in `src/shared/tools-math.ts`): payments and each period's interest round to the whole cent; a period's principal is payment minus interest so no cent is split; the final period clears the balance exactly when only rounding is left. An unfinishable loan (payment below interest) stops at the term and is reported, never silently zeroed.
- **Percentage**, **bill split & tip**, **date calculator** and a **savings projection** sit alongside the loan tool; all math is unit tested.
- **Stopwatch**: laps and splits, `Space` starts/stops, `L` laps, `R` resets, and **Log to Focus** turns the elapsed time into a Focus session.
- **Scratchpad**: plain-text pads that autosave as you type, several pads, and **Save as note** copies one into Notes (the pad stays).
- **Snippets**: title, body and tags, one-click copy through Electron's clipboard, and full-text search through the shared index.
- **Fixed**: the break-time stat on the Focus reports tab used the muted colour while its neighbours used the foreground colour.

### Fixed (Phase 4 follow-up)
- Focus reports: stat tiles were inline `<span>`s without `display: block`, so label, number and caption collapsed onto one line.

## [0.18.0] - 2026-11-03

### Phase 5: Tools hub (Utilities)
- **Tools** (Utilities): one page with four tabs — Loan, Stopwatch, Scratchpad, Snippets. Pinned tools sort to the front of the tab strip; every tab is a real `tablist` driven by arrow/Home/End keys.
- **Loan calculator** with a full amortisation schedule, total interest, total paid, payoff date and an optional extra monthly payment that reports the interest and months saved. Grouped under it: percentage (five modes), bill split and tip, a date calculator, and a savings projection.
- **Rounding policy (stated in code and tested)**: the payment and every period's interest are rounded half-up to whole cents, principal is `payment − interest` so no cent is split, and the final period of the term clears the remaining balance — a 30-year loan otherwise leaves about $1.04 owing from accumulated rounding. A loan whose payment is below its interest is genuinely unrepayable and is left owing rather than zeroed.
- **Stopwatch** with laps and splits, Space to start/stop, L to lap, R to reset, and "Log to a Focus session" which writes a count-up `time_session` through the Phase 4 service.
- **Scratchpad**: autosaving plain-text pads (debounced), multiple pads, and "Save as note" which copies the pad into Notes without removing it.
- **Snippets**: title, body and tags, one-click copy through Electron's clipboard, and a command-palette action **Copy snippet…** that copies the most recently edited snippet.
- **Search**: snippets joined the shared FTS index and appear as their own search group.
- **Trash**: snippets and scratchpads are soft-deleted, listed in Trash, and restore with their content.
- No new dependencies.

### Focus
- Fixed a typography issue where the Reports stat tiles ran together on one line (the label, value and caption were inline `<span>`s).
- Fixed the break-time figure using the muted colour while every other headline figure used the foreground colour.

## [0.17.0] - 2026-11-03

### Phase 4: Focus timer and time tracking
- **Bug fix (Notes)**: Fixed blank screen crash when deleting a note caused by unmount effect triggering update on a soft-deleted note and `useUndoStack` listener invoking `setList` with no arguments.
- **Pomodoro timer & Count-up**: Interactive circular timer supporting Focus (25m), Short break (5m), Long break (15m), and Count-up modes with round tracking. Configurable intervals and audio chime using offline HTML5 Web Audio API synthesizer.
- **Clock-based elapsed timing**: Stored timestamps (`started_at`, `paused_at`, `elapsed_seconds`) ensure zero tick drift when window is backgrounded or minimized.
- **Active session persistence**: Active running or paused timer state is persisted in SQLite (`active_focus_session`), surviving window close, crash, or app restart without loss of elapsed time.
- **Power monitor handling**: System suspend/resume events pause running timer to prevent phantom time accumulation during system sleep.
- **Midnight splitting**: Sessions spanning local midnight are split by local calendar day for accurate reporting.
- **Projects**: Lightweight `projects` table (migration 25) with custom colours and archive support, seeded from existing distinct task projects.
- **Sessions log**: Durable session records (`time_sessions`), supporting manual entry, editing, and soft-delete with Trash restoration.
- **Reports & Heatmap**: Period reports for Today, 7 Days, and 30 Days with total focus/break time, by-project progress bars, by-task breakdown, and an activity intensity heatmap.
- **Assistant integration**: Added `time_spent` tool to the AI Assistant answering queries like "How many hours did I spend on project X this week?".
- **Dashboard integration**: Added today's focus minutes to `DashboardData`.
- **Keyboard shortcuts**: Space bar starts/pauses/resumes timer, Esc stops/discards, Ctrl+N opens manual time logging.

## [0.16.0] - 2026-11-03

### Phase 2: Notes and the Tags page
- **Notes** (sidebar › Notes): undated markdown pages with a live preview, debounced autosave, word count, tags (including `#tag` typed in the text), pinning and an archive. Built-in **Meeting note** and **Blank checklist** templates ship with it.
- **Wiki links**: typing `[[Another note]]` links the two notes through the existing Links service; backlinks appear on the target. Links to a trashed note hide and reappear on restore.
- **Checklists**: `- [ ]` lines are ticked in place and each one can be sent to Tasks.
- **Promote**: "Convert to note" on a Logbook entry creates a note with its title, body and tags (the entry stays).
- **Markdown safety**: `marked` runs with raw HTML disabled and the output is sanitised again with DOMPurify against a small allow-list; links only open for `http(s)`/`https` through the existing `shell.openExternal` guard, and `javascript:`/`data:` hrefs are dropped.
- **Tags page** (Utilities): every tag with per-tool counts, a mixed-type list grouped by tool, plus rename (applies everywhere, merging if the name is taken), merge, colour and delete (removes the tag only, never the items).
- Behaviour change: tag saving now revives a previously removed tag instead of silently failing (the unique index covers hidden taggings too). `cleanTags` now uses the one shared normaliser, so `parent/child` and repeated spaces normalise the same way in JSON tag columns and the tags table.

### Phase 3: Content planner
- **Content** (sidebar › Productivity): a six-stage pipeline board (Idea › Script › Record › Edit › Publish › Published) with HTML5 drag-and-drop (the same technique as Tasks — no new dependency) and arrow-button moves for keyboard users. Cards show type, platform, the current stage's checklist progress, the target date (overdue marked) and the linked script.
- **Per-stage checklists** seeded from built-in templates the first time a card reaches a stage, never duplicated on a return visit, and fully editable.
- **Script as a note**: one click creates a markdown note and links it both ways, so the script gets tags, backlinks and search for free.
- **Assets by path**: local files are stored as paths and never copied; missing paths are flagged.
- **Calendar**: published and planned content appears on the month grid and in the day panel.
- **Post-publish**: published date, URL (http(s) only), manual views at 24 h and 7 days, and notes.

### Shared
- Migration 23 (`notes`), 24 (`content_items`); notes and content join the shared FTS index, the tag service, the Links picker and Trash.
- Fixed: `listTemplates()` without a kind produced invalid SQL (no caller had used it before).
- Fixed: `tests/trade-rules.ts` used a hardcoded "today", so it failed once the clock rolled past it.
- Built-in templates are seeded in code (`src/main/builtinTemplates.ts`), idempotently and without re-creating deleted ones.

## [0.15.0] - 2026-11-02

### Phase 1: Expenses and Budget (UI)
- **Overview tab**: month-scoped left to spend, safe to spend per day, spent so far and bills still due, with a per-category usage list and the unpaid bills for the rest of the month (overdue marked). Leftover money can be moved to a savings goal.
- **Transactions tab**: month view with search across payee, note, category and tags, plus type and category filters; running totals for spending, income and transfers; create/edit/delete with confirmation. Transfers and income are never counted as spending.
- **Budgets tab**: one amount per category per month, saved on blur or Enter (0 clears it), usage bars, and **Copy last month**.
- **Recurring tab**: bills and subscriptions with cadence, next due date, category, reminder lead time, autopay, trial end date, note and payee; a **Due this month** list with **Mark paid**; monthly/yearly totals (weekly and custom bills averaged).
- **Accessibility**: the tab strip is a real `tablist` with arrow/Home/End keys and `Ctrl+1…4`; every dialog closes on `Esc` and saves on `Ctrl+Enter`; all lists and actions are keyboard reachable.
- **Theme**: token-only styling; verified rendering in both Modern and Classic styles.
- **Wiring**: new `window.api.expenses` bridge (17 channels) onto the Phase 1 service; the Expenses tool is registered in the sidebar under Money. No changes to `src/modules/expenses/service/`.
- **Tests**: existing suites pass unchanged; the page was also verified in a headless browser (all four tabs, keyboard tab navigation, both interface styles).

## [0.14.0] - 2026-11-02

### Phase 0: Foundation (Roadmap)
- **Module contract**: Applied the extended module contract (`src/shared/tools.ts`, `src/renderer/src/tools.ts`) across all existing modules, declaring route, search provider, linkable type, quick-capture kinds, and future provider flags.
- **Soft delete & Repository helper**: Added `deleted_at` and `delete_batch_id` to all user-facing tables (`logbook_entries`, `trades`, `savings_goals`, `savings_transactions`, `habits`, and backfilled `updated_at` / added `delete_batch_id` to `tasks`) via migration 17. Universal query filter `LIVE()` in `src/main/repo.ts` excludes trashed rows from all reads and totals (savings balance, trade P&L, habit streaks, dashboard, review, insights).
- **Trash & Session Undo**:
  - Global session undo via Ctrl/Cmd+Z and "Deleted. Undo" toast notification with `noteUndoableDelete` across Logbook, Trades, Savings, Habits, and Tasks.
  - Dedicated Trash page (`/trash`) in Utilities with batch grouping, batch restore, permanent deletion, and automatic startup purging after configurable retention period (default 30 days).
- **Links service & Linked items**:
  - Generic `links` table (migration 18) storing bidirectional links between any linkable entity (`logbook`, `trade`, `goal`, `task`) with normalized pair ordering.
  - Reusable `LinkedItems` panel and keyboard-accessible `ItemPicker` modal integrated into EntryEditor, TradeEditor, TaskEditor, and GoalDetail. Links to trashed items are hidden and reappear on restore.
- **Tags service**:
  - Global `tags` and `taggings` tables (migration 19) for generic cross-entity tagging and Phase 2 Notes foundation.
  - Pure tag normalization (`normalizeTagName`, `normalizeTags`, `splitTagInput`) with slash support for `parent/child` hierarchies, leading `#` stripping, and whitespace cleanup.
  - Shared `TagInput` autocomplete component with datalist suggestions.
- **Templates engine**:
  - `templates` table (migration 20) with variable expansion (`{{date}}`, `{{weekday}}`, `{{time}}`) and "Save as template" support in editors.
- **Shared FTS5 Search Index**:
  - SQLite FTS5 virtual table `search_index` (migration 21) replacing per-module LIKE queries with unified, fast full-text search across Logbook, Trades, Goals, Savings transactions, and Tasks.
  - Live index synchronization on create, update, soft-delete, and restore.
- **Settings > Modules toggles**:
  - Added Modules tab in Settings with accessible toggle switches to enable/disable modules. Disabled modules are hidden from sidebar navigation and command palette.
  - Added configurable Trash retention auto-purge setting.
- **Testing**: Added `tests/phase0.ts` covering totals ignoring trashed rows (savings, trades, habits), restore bringing totals back, batch delete and restore, link visibility with trashed items, migration on a copy of existing data, and tag normalization.

## [0.13.0] - 2026-10-26

### Intelligence
- Added the goal projection (Idea section of the plan, no deadline column so it stays a projection): a goal detail shows "At your recent average of X/week you will reach '<goal>' in about N weeks" computed from the last 8 weeks' net by a pure rule; it stays silent under 4 weeks of data, on a zero/negative average, when the goal is reached or has no target, or when the horizon would exceed five years
- Insights can now be snoozed or hidden: each card offers "Snooze 4 weeks" (resurfaces the day after) and "Hide" (until restored); dismissals moved from plain ids to `{ id, until }` with the old format migrated automatically at startup; expired snoozes resurface the card, and a restore list can be driven through the same dismiss call
- Added small plain-SVG charts to the Insights page (Sparkline under each weekday/mood table, currentColor plus theme token classes, role=img with the same numbers in the aria label); no new dependencies
- Insights comparisons now use Cohen's d effect size instead of a fixed difference threshold: wording bands (about the same / small / moderate / large) replace SAME=0.25, the detail line shows both group spreads (+/-), and the minimum days per group rose from 4 to 5
- Added "Quick re-entry note" (off by default): migration 16 adds `trades.closed_at` (ISO timestamp stamped when the exit price appears; old rows stay NULL and never fire), the Trade type, JSON export/import and validation carry it, and a pure rule shows a note when a new trade opens within N minutes (default 30) of the most recent LOSING close
- Added two off-by-default trade automations: "Loss-streak pause note" (a message after the last N closed trades all lost, threshold configurable, default 3) and "Overtrading note" (a message once per day when more than N trades are dated today, default 5); both are pure rules, fire only through the normal message path and dedupe like the others
- Added "Since you last opened" on the Briefing: a capped list of trades closed, savings transactions, tasks completed, habits missed and journal entries dated after the stored `lastSeenDate` (kept in `dailyCheckState`, updated by the once-per-day check), computed by a pure rule and never listing automation drafts
- Real streak-broken detection replaces the write-time approximation: a habit with a 7+ run that missed a due day in the last two days gets one "Broken streak notes" automation per miss, computed from the shared habit rules by the once-per-day check; skipped days, rest days and "today not done yet" never count as breaks
- Added a pure offline weekly summary (savings net, trade P&L, habit rate, tasks completed, mood average and journal entries for last week) computed with the assistant's own function rules, shown as a Briefing card with a "Save to Logbook" button that creates an ordinary entry; an empty week shows "Nothing logged"
- Added the once-per-day daily check infrastructure: day-gated state in the `dailyCheckState` setting, run at startup and from the reminder loop so a day turning over while the app is open is still checked exactly once; each future check runs in its own try/catch, and the first run after an upgrade looks back only two days
- Assistant prompt rewritten to version 2 (structured request shape, full range/filter/compare vocabulary, refusal rule and worked examples generated from the function table)
- Provider requests add JSON mode, a 200-token cap, and one automatic retry each without JSON mode and without `temperature` when a provider rejects the request; HTTP failures now name the status code without ever exposing the response body or the key
- Added the assistant evaluation harness under `tests/eval/assistant-eval.ts`; it runs the provider prompt against a fixed case set and checks function/range/filter selection without exposing raw numbers
- Assistant answers now use clear function names, local date spans, and unit-aware money, percent, count and score values, including comparisons
- Assistant follow-ups reuse only the previous function, date range and filters; disclosures show this context, and Clear history resets it
- Assistant now shows locally computed tables for biggest trade losses/wins, most-used journal tags and P&L by asset; trade lists default to three and cap at ten
- Assistant can compare a period with an equal-length previous period; both results are calculated locally, with percent change omitted when the previous value is zero
- Assistant supports local matching for asset, direction, tag, goal, project and habit filters without sending the app's label lists to the provider
- Assistant date ranges now use symbolic calendar periods resolved locally (including all-time from 1970); disclosures show both the model's requested range and resolved dates, while legacy explicit dates remain supported
- Assistant now refuses unsupported questions instead of guessing; clickable example prompts are generated from its supported function list
- Cloud confirmation is address-specific and must be repeated after changing the normalized address; assistant requests reject redirects and questions over 500 characters
- Assistant date ranges reject impossible dates, clamp future endpoints to today, and reject ranges longer than five years to avoid unbounded habit calculations
- Assistant, Insights and Habits now share due-day, skip, target and effective-start rules; future, archived and still-pending-today days no longer affect rates
- Assistant and Insights now count each task completion occurrence from task history, including completed recurring occurrences no longer present on the current task row
- Insights now exclude task-count median ties, compare all perfect-rate habit days against all lower-rate days, and avoid directional claims for weak correlations
- Restoring a JSON backup resets the assistant provider and cloud confirmation while retaining the model and local URL; imported key blobs are ignored. JSON exports omit the encrypted key blob, but daily local database copies may contain it

### Automations
- Automation drafts use the local date; event claims and draft creation are transactional, and separate actions receive separate dedupe keys
- Deleting an automation activity row or pressing "Clear list" hides activity without removing its draft or deduplication claim, so old triggers cannot repeat (append-only migration 15)
- Automation drafts remain visible but no longer count as user writing in streaks, authored-entry totals, or journal mood statistics
- Entering a closed losing trade now creates its loss-reflection draft when its trade date is today or up to three days earlier; older and future-dated trades are ignored
- Capture and Calendar check-ins now replace a skipped status with done; unchecking clears the day as before

### Appearance
- Unified the six original colour schemes and seven named palettes into one theme list, with light and dark variants for all 13 themes
- Replaced the six supplied palette ramps with their requested token values and added measured contrast checks for every palette, mode and interface style
- Added legacy colour-scheme/palette setting normalization; preserved per-mode custom colours and kept accent selection independent
- Modern cards now use the surface token with a blended border; Classic minimal cards use the page background and full border token, with token-based selected tints
- Reduced Warm Sand's overly bright dark divider and aligned first-paint card borders and accent tints with the shared appearance tokens

### Task manager (0.13.0)
- Added date-selectable Completed history that preserves completed recurring occurrences after their task reopens; included the history in backups and added migration 14 to backfill tasks already marked complete
- Added Trash restore/permanent-delete flows, delete undo, inline task fields, bulk rescheduling, saved views, configurable sorting, task reminders, and recurring-occurrence skip
- Added shared quick-add parsing for due dates/times, tags, projects and priorities across Tasks, Quick capture and the command palette
- Added task results to universal search and task actions/keyboard navigation
- Added checklist progress, reordering and promotion; board columns and empty states now remain consistent
- Fixed bulk rescheduling of recurring tasks to move the active occurrence while preserving the original recurrence anchor
- Added recurrence, task filtering, sort, reminder, Trash, reschedule and subtask tests
- Behaviour change: Today includes undated tasks but no longer includes overdue dated tasks; Upcoming includes undated tasks and is limited to the next seven days; due times can make a same-day task overdue
- Behaviour change: recurring tasks stay completed until the next due date, then reopen with checklist progress reset; late completion advances beyond expired periods

### Habits: detail view, links and reminders (0.12.0 work)
- Habit detail view: drawer now shows 7/30/90-day completion rates and a 12-month GitHub-style heatmap with month labels
- Logbook link: `auto_complete_on` per habit (migration 13) — a Logbook entry on a due day ticks the habit off, never overwriting an existing record; wired through a small event bus (`src/main/events.ts`) so Logbook and habits stay decoupled
- Dashboard widget: progress ring ("X of Y due") and a Top-3 current streaks line in the "Habits today" tile
- Reminders (v1): `reminder_time` per habit ("HH:MM"), desktop notification while the app runs when the habit is still open at its reminder time; new `src/main/reminders.ts`
- Behaviour change: the dashboard tile counts a count/duration habit as "done" only when its target is reached (previously any check-in counted)

### Habits: organisation (0.11.0 work)
- Drag to reorder habits via a grip handle; order persisted in a new `habits.sort_order` column (migration 12, backfilled from creation order)
- Optional `time_of_day` per habit (morning / afternoon / evening / anytime) with a "Group by time" toggle on the Habits page
- New `habits:reorder` IPC call; backups round-trip the new fields
- Restoring an archived habit moves it to the end of the list; partial updates (restore) no longer reset type/target/unit/time of day

### Fixed
- Database startup now keeps the three newest pre-migration copies and closes with an error dialog if an upgrade fails
- Intelligence feature toggles now update the sidebar and palette immediately instead of waiting for an app restart
- Intelligence checkboxes use defaults when saved feature settings are missing, update immediately while saving, and revert with an explicit error if persistence fails
- Automation failures are logged and skipped so they cannot make an already-saved Logbook entry, trade, savings, task, or habit change appear to fail
- Intelligence feature changes now merge in the main process; automation settings and insight dismissals move to independent settings keys without losing their saved values
- The Intelligence provider picker and Assistant now use the same provider setting; legacy provider choices are moved during the existing settings-key migration
- Removing an assistant key now deletes its stored blob; both Assistant surfaces distinguish a key that is saved but unreadable on this computer
- Fixed floating-point rounding in fmtPnl using round8
- Fixed fmtAmount to strip sign for consistent locale formatting
- Fixed rate30 null display showing '0% scheduled' when due===0
- Fixed toggleId to always return a new array (not mutate reference)
- Fixed computeHabitStats to use round8 for rate30 percentage

### Changed
- Reorganized review prompts order with documentation
- Improved PnlChart to handle zero trades case
- Enhanced HabitEditor UI for rate30 display

## [0.1.0] - 2026-10-30

### Added
- Initial project setup