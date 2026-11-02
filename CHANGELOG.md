# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added CHANGELOG file for version tracking

### Intelligence
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