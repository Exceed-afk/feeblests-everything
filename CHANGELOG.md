# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added CHANGELOG file for version tracking

### Intelligence
- Cloud confirmation is tied to the normalized address; assistant requests reject redirects and questions over 500 characters
- Assistant date ranges reject impossible dates, clamp future endpoints to today, and reject ranges longer than five years to avoid unbounded habit calculations
- Assistant, Insights and Habits now share due-day, skip, target and effective-start rules; future, archived and still-pending-today days no longer affect rates
- Assistant and Insights now count each task completion occurrence from task history, including completed recurring occurrences no longer present on the current task row
- Insights now exclude task-count median ties, compare all perfect-rate habit days against all lower-rate days, and avoid directional claims for weak correlations
- Restoring a JSON backup resets the assistant provider and cloud confirmation while retaining the model and local URL; imported key blobs are ignored. JSON exports omit the encrypted key blob, but daily local database copies may contain it

### Automations
- Automation drafts use the local date; event claims and draft creation are transactional, and separate actions receive separate dedupe keys
- Clearing or deleting automation activity now hides rows without allowing old triggers to repeat (append-only migration 15)
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