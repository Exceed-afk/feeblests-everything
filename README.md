# Feeblest's Everything

Local-only logbook, trade tracker and savings tracker for Windows (Electron + React + Tailwind + SQLite).

## Conventions for this project
- No new dependencies without asking me first.
- Business rules live in pure functions in src/shared/ with tests in tests/ (run with tsx). Main process code only fetches/saves.
- Run `npm run typecheck && npm test` before saying anything is done.
- Use theme tokens/classes only, no hardcoded colors. Keep everything local-only.
- If a change alters existing behaviour, list it explicitly in your report. Never change behaviour silently.
- Update README.md for anything a user or future maintainer needs to know.

## Run it
1. Install Node.js 20+ and, if the install step complains about compiling, the "Desktop development with C++" tools from Visual Studio Build Tools.
2. In this folder: `npm install` then `npm run dev`
3. Build an installer: `npm run dist`

### If `npm test` says "was compiled against a different Node.js version"
`better-sqlite3` is a native addon, and it has to be compiled for the Node version that loads it. The app runs inside Electron, but `npm test` runs under your system Node, and the two need different builds.

`npm run build:native` builds **both** and puts them where each one expects it:
- `node_modules/better-sqlite3/build/Release/` - for Electron (the app)
- `node_modules/better-sqlite3/build-node/Release/` - for your system Node (the tests)

The tests find the second one through `tests/sqlite.ts`. You only need to run this after `npm install`, or if you change your Node version.

## Where things live
- `src/main/` - the "backend": window + SQLite database (db.ts)
- `src/preload/` - the safe bridge exposing `window.api` to the UI
- `src/renderer/` - the UI (React). Each feature is a file in `src/renderer/src/modules/`
- `src/shared/types.ts` - types used by all three

## What's new in 0.13.0 (task manager)
- **Task lifecycle**: deleted tasks go to Trash, where they can be restored or permanently deleted; task and bulk-delete actions offer Undo. The board keeps its three status columns visible when empty, and list/board distinguish an empty task collection from filters with no matches.
- **Task views and dates**: Today includes undated tasks, Upcoming includes undated tasks and dated tasks due within seven days, and Overdue includes earlier dates plus tasks whose due time has passed today. Due-time reminders appear once per task occurrence while the app is running; as with habit reminders, there is no closed-app catch-up.
- **Completed history**: choose a local calendar date in Completed to see every task completion recorded that day, including recurring occurrences after the task has reopened. Completion history is included in backups; older backups remain importable, and migration 14 seeds history for tasks that were already complete.
- **Quick add**: page, Quick capture and command-palette task creation share parsing for relative dates, 12/24-hour due times, `#tags`, `project:Name` / `@project`, priorities and recurrence.
- **Daily workflow**: task fields can be changed inline; bulk select supports completion, reopen, delete and rescheduling (today, tomorrow, next week, or a chosen date). Manual/due-date/priority sorting and up to 20 saved views are remembered in local settings.
- **Recurring tasks**: completing a task schedules the next occurrence; it stays completed until that date, then reopens with its checklist reset. Late completions skip expired dates while preserving monthly anchors. A recurring occurrence can also be skipped explicitly.
- Bulk rescheduling a recurring task moves its active occurrence and keeps the original recurrence anchor, so its next date and reminder update together.
- **Subtasks, search and keyboard**: checklist progress is shown on parent tasks; checklist items can be reordered or promoted. Tasks appear in universal search. In list view, `j` / `k` move between rows, `x` toggles completion, `e` opens the editor, and `d` focuses the due date. The command palette can open task views and act on selected tasks.
- **Behaviour changes**: Today no longer includes overdue dated tasks (use Overdue); Upcoming is capped at seven days; undated tasks appear in Today and Upcoming. Recurring tasks no longer advance their due date before the next occurrence is due, and their checklist resets when that occurrence opens.
- No task schema migration was needed; existing task backups already include task records. New pure task and quick-add tests run through `npm test`.

## What's new in 0.12.0 (habits: detail view, links, reminders)
- **Habit detail view**: the drawer that opens when you click a habit's name (or an archived habit) is now the full detail view: the streak and check-in stats, then completion rates for the **last 7 / 30 / 90 days** (only due days counted, same rules as everywhere), then the history heatmap grown from 12 weeks to the **last 12 months** with month labels, scrolling horizontally. Every square is still clickable to fix a past day.
- **Logbook link**: a habit can have **"Auto-complete when I write a Logbook entry"** (new `auto_complete_on` column, migration 13, per habit in the editor). Writing any Logbook entry on a day then ticks that habit off for that day — but only if the habit was **due** that day, only if the day has **no record yet** (what you logged or skipped yourself is never overwritten), and never for a future-dated entry. Kept decoupled: the Logbook only *announces* new entries on a small event bus (`src/main/events.ts`); the habits module *listens*. Neither module imports the other. Only user-written entries count; automation drafts are ignored, like the other automation triggers.
- **Dashboard widget**: the "Habits today" tile now has a **progress ring** around "X of Y due", and a quiet **Top streaks** line with your three best current streaks, reading the same shared helpers the Habits page uses.
- **Reminders (v1)**: a habit can have a **"Remind me at"** time ("HH:MM", new `reminder_time` column). While the app is running, a check runs every minute; when the time arrives and the habit is still open for today (not done, not skipped, not resting), a desktop notification appears. Clicking it focuses the app. A reminder up to ~10 minutes late still fires. **Limits to know:** reminders exist only while the app is open (closed app = none, no catch-up later), and switching off Windows-focus-assist/notifications is up to the OS. Saved behaviour for the row: habits with a reminder show a small bell + time.
- **Behaviour change to note**: the dashboard tile now decides "done" by the shared day rules, so a *count/duration* habit at 6/10 minutes no longer counts as done there (it used to count as done whenever any check-in existed).
- New tests in `tests/habits-links.ts` (auto-complete rules, reminder helpers, top streaks, duration-aware "done") — part of `npm test`. Migration 13 added (`reminder_time`, `auto_complete_on`; migration 12 was the organisation columns).

## What's new in 0.11.0 (habits: organisation)
- **Drag to reorder habits**: every habit card has a grip handle (right of the week dots). Drag it, or focus it and use Space + arrow keys. The new order is saved in a `habits.sort_order` column (migration 12, backfilled from the creation order, so nothing changes until you drag). A new habit joins at the end of the list.
- **Group by time of day**: a "Group by time" toggle above the list splits it into Morning / Afternoon / Evening / Anytime sections (empty ones are hidden). Each habit picks its time of day in the editor ("When do you do it?"). While grouping is on, dragging is limited to inside a group, so Morning habits stay with Morning.
- **Restore lands at the end**: restoring an archived habit now moves it to the end of the list instead of its old position, so it does not jump into the middle. Fix on the way: restoring used to silently reset a count/duration habit to a plain check habit; updates now keep any field the caller did not send (type, target, unit, time of day).
- **Backups round-trip the new fields** (`sortOrder`, `timeOfDay`); older backup files import as "anytime" in creation order.
- New tests in `tests/habits-organisation.ts` (migration backfill, reorder, restore, grouping helpers), run as part of `npm test`.

## What's new in 0.10.0
- **Habits on the Dashboard**: a "Habits today" tile shows done / scheduled today, the longest current streak among active habits, and today's list (unfinished first). The tile and each line open the Habits page. The data rides on the same `dashboard:summary` call (`habitsToday()` in `src/shared/dashboard.ts`), so the home page is still one round trip.
- **Daily backup uses your local date**: `everything-YYYY-MM-DD.db` is named with `localDate()` instead of the UTC date, so a late-evening start no longer gets tomorrow's (or yesterday's) name. The keep-14 cleanup is unchanged.
- **More tests**: trade P&L and stats, savings balances and the no-negative rule, the dashboard habits tile, palette contrast and the link-opening rule. `npm test` runs them all through `tsx`, which is now a proper devDependency (no more `npx --yes`). `tests/` is typechecked by `npm run typecheck`.
- **Safer links**: only `http:` and `https:` links open outside the app (`src/shared/url.ts`), for both new windows and navigation. Anything else is blocked.
- **UI/UX pass**: one visual language across every page.
  - Shared building blocks in `styles.css` and `components/`: `PageHeader` (title, subtitle, primary action), `EmptyState` (what it is, one next step), `Pnl`, and the classes `.page`, `.card`, `.stat`, `.tbl`, `.badge`, `.row-link`, `.empty`.
  - Dashboard is a command centre: clickable stat tiles, a Today row (habits + P&L chart), recent items, savings progress.
  - Trades: sticky-header table with a Status column. Open trades are a dashed "Open" badge, and P&L has a sign and an arrow, so colour is never the only cue.
  - Habits: today's list is the hero. The header counts only the habits that are **due** today ("X of Y due today"), and a habit that is resting is dimmed, badged **Rest day** and has a disabled circle. Days are done (tick), missed (cross), rest (dashed dash), skipped (skip arrow), future (dotted) or today-to-do (empty ring), with a legend under the 12-week grid. The check button pops on done and shows a busy state while saving.
  - Habits history: the week strip above each habit can be moved with the **&lt;** and **&gt;** buttons, and **This week** brings you back. Clicking a day that has already happened opens a small menu with **Done**, **Missed**, **Skipped** and **Clear**; future days and rest days cannot be changed. The big circle on the left stays the only control for today. Changing a day updates the streak and the header straight away.
  - A skipped day (sick, travelling, ...) is stored as such and never breaks a streak. "Missed" and "rest" are worked out from the schedule instead of being stored, so a missed day is just the absence of a check-in.
  - Habit stats: every row now shows the current streak, the best streak ("Best: N") and the 30-day completion rate, which counts only the days the habit was actually due. A quiet badge appears at a 7, 30 or 100-day streak, and a "Perfect week" mark shows when every scheduled day of the week on screen was done. The perfect-week mark looks at the week you are looking at, so it moves with the **&lt;** / **&gt;** buttons.
  - Three kinds of habit: **Check off** (a yes/no habit), **Count** (do it 3 times) and **Duration** (do it for 10 minutes). A new habit works out its kind from its name, so "Read for 10mn" starts as a 10-minute duration habit; you can always change it by hand. For a count or duration habit the big circle opens a small number menu with - and + buttons, the row shows the progress ("6 / 10 min"), and the day only counts as done once the target is reached. Existing habits stay plain "check" habits and keep all their history.
  - Savings goal cards show balance, a progress bar and percent at a glance; the history table uses the same table style.
  - Settings is split into Appearance, Tags, Data and Shortcuts. The Shortcuts tab lists every key.
  - Gain / loss / caution colours are now theme-aware tokens (`pos`, `neg`, `warn`). The old fixed green and red text failed WCAG contrast on light surfaces (2.5:1 and 3.7:1); the new ones reach 4.5:1 or better on every palette (`tests/appearance.ts`).
  - Graphite (light) got a slightly deeper page colour so cards stand out. The appearance system (palettes, accent, Modern / Classic, roundness, spacing, text size, font, sidebar) is unchanged and everything still follows it.

## Dashboard
The home page shows stat tiles, today's habits, the P&L curve, savings progress and the newest entries and trades. Everything comes from one call (`dashboard:summary`, built in `src/main/dashboard.ts`), and clicking any item opens it in its own module.

## Review (weekly and monthly)
The **Review** page (sidebar, under Dashboard; also `Ctrl+K` > "review", and a "Review your week" card on the Dashboard) pulls the separate tools into one summary for a week (Monday to Sunday) or a calendar month. The header shows the period and whether it is **In progress** or **Complete**, beside the Week / Month control and the previous / next arrows; "This week" jumps back to now.
- **Four summary cards**: trading P&L, savings movement, habit consistency and average mood. Each opens its tool, puts one number in charge, and adds one small visual (a running P&L line, a goal bar, a habit strip, a mood strip). While a period is still running the previous one is shown as plain context ("Previous period: +12.00"); once it is over the card says how much it is up or down. The page has its own loading placeholders and a "Try again" error card; an empty period still offers the reflection.
  - **The small strips follow the period, but a summary card only has room for a week.** In a week view they show that week's seven days. In a month view the narrow summary cards show the **last seven days** of the month and say so ("Last 7 days"), while the wider Habits panel shows **every day of the month**. The strip is never silently cut off or squeezed: a card that cannot fit its tiles would overflow them.
- **Trading**: closed trades, open trades, win rate and fees; a bar per day (green for a profitable day, red for a losing one, around a zero line) with **Daily P&L / Cumulative / Trades** views; and the best and worst trade (each opens the trade). A trade counts on its **entry date**, exactly like the P&L curve, so a trade entered on Sunday and closed on Tuesday belongs to the Sunday week. Open trades are counted as open and left out of P&L. Days with no closed trade keep their slot but are not drawn as a result; a day that broke even is not a loss.
- **Savings**: in three parts: an overview (deposited, withdrawn, net, and the total balance before and after), goal progress for each goal that moved (Goal reached badge, bar and percentage), and the newest transactions of the period exactly as entered. Goals that did not move are left out of the list, but their balance is still in the total. No balance is recalculated anywhere: it is the same `savings.ts` arithmetic the Savings page uses.
- **Habits**: the share of scheduled days that were done, a day strip, and each habit's rate, a day row for a week, and missed days (weakest first). The strip's four states are deliberately different in shape as well as colour: **Completed** is a full green tile with a tick, **Incomplete** is a partial fill or a red ring with a cross, **Not scheduled** is a dashed empty tile, and **Not tracked** is a faint dotted tile with a dash (no habit existed yet). Today has a solid outline and future days stay dotted. A legend sits under the strip in the Habits panel. The rules are the Habits page's own: only scheduled days count, days before a habit existed are not missed, today is not missed until the day is over, a check-in on a rest day is a bonus, archived habits are ignored. `trackedFrom` (the first day any active habit existed) is the one new derived field, so "not tracked" and "not scheduled" are never confused.
  - **Each habit's day dots** follow that habit's own schedule (`ReviewHabit.days` and `startDate`), not the whole set: only a day the habit was actually scheduled can show as done (filled) or missed (red ring), so a four-day-a-week habit no longer looks like seven green days. An unscheduled day is a rest day (dashed), a day before the habit's start date is not tracked (dotted), and today is a hollow ring until it is checked off. Bonus check-ins on rest days still count as done. `HabitWeekRow` in `components/ReviewViews.tsx`.
- **Mood**: average on a 1 (rough) to 5 (great) scale, a trend line on that fixed scale (a day with no entry is simply not on the line, never treated as a low one), how many of each mood, the lowest day when it was low or rough, and a Rising / Steady / Falling label (second half of the logged days against the first; it needs four logged days to say anything). The previous period's average appears only when both periods have logged moods.
- **This week / This month**: short, plain sentences worked out from the numbers above, one fact each (the best and worst trading day when both exist, savings movement and any goal reached, habit consistency, mood and its comparison with the earlier period only when that period is over). Every sentence is supported by the data; duplicates are removed and a calm "Not enough data yet" line replaces the list when there is nothing to say. Nothing is shown that the page does not also show as a number, and there is no AI involved: `weeklyInsights()` in `src/shared/review.ts`, covered by `tests/design.ts` (empty, normal, one-day, ties and a whole losing week).
- **Across your tools**: only appears when there is enough data (at least two days on each side). Compares mood on days you finished every habit with other days, and on days your trades made money with days they lost. It describes; it does not claim one thing causes the other.
- **Reflection**: questions made from this period's numbers (a losing week, a weak habit, a low day, savings going down...) plus two that always apply. Click one to add it to the text box, write underneath, optionally pick a mood, and **Save** (`Ctrl+Enter`). "Add the numbers" puts a few lines of this period's figures at the top, so the entry keeps them for later.
  - A reflection is an **ordinary logbook entry** tagged `review` and `weekly` / `monthly`, titled like `Weekly review 2026-10-19 to 2026-10-25` (a month: `Monthly review 2026-10`). It shows in the Logbook, in Search, and in your JSON export; nothing new is stored. It is dated the period's last day, or today for a period still running.
  - The page finds a period's reflection again **by that title and the `review` tag**, so saving twice updates the same entry. If you rename it in the Logbook, the page will no longer recognise it and a new one would be created.
  - Text you have typed but not saved is kept while you step to another week and back, but is lost if you leave the Review page.
  - Its mood counts in the mood average like any other entry.
- **Where things live**: `src/shared/review.ts` holds every rule and number (periods, trades, savings, habits, mood, links, questions, weekly insights) as plain functions covered by `tests/review.ts` and `tests/design.ts`; `src/main/review.ts` only fetches rows from each tool's own queries (`review:build` call, one round trip); `modules/Review.tsx` is the page, `components/Charts.tsx` the trading bars, the running P&L line and the mood trend, `components/ReviewViews.tsx` the small day strips, and `lib/chartData.ts` the arithmetic behind them (plain functions, covered by `tests/design.ts`). All of it is plain SVG/CSS with theme colours only; no chart library was added. To add another section later, extend `buildReview` and render it in `ReviewBody`.

## Design system
The look is defined once, in `src/shared/design.ts`: the colour tokens for light and dark (`COLOR_TOKENS`, read as the "Default" palette), the accent, the 4px spacing grid, the card / control / chip radii, the type scale and the motion durations. The same numbers appear as CSS variables in `src/renderer/src/styles.css` (and, for the very first paint before the app starts, in `src/renderer/index.html`); `tests/design.ts` checks them for contrast and drift.
- **Type**: page 28px, card heading 15px, card label 13px, main metric 30px, body 14px, small 12px; financial figures use tabular numerals.
- **Surfaces**: a one-pixel border on a soft shadow; cards are not floating panels. Controls are 10px rounded, cards 16px.
- **Colour language**: green is money made or a habit kept, red is money lost or a habit missed, the blue `--mood` tone is the one neutral chart colour (mood trend, savings goal bar), and nothing else is coloured. Mood keeps its own five words and dots, so a rising mood line never says a mood is "good".
- **Themes**: light and dark are designed separately (the dark page is deep green-black, not an inversion). The design-system green accent has light and dark values; a colour picked in Settings stays independent of the selected theme. The Mode setting in Settings controls light / dark / system.
- **Colour themes**: Settings > Appearance has one unified list of 13 themes: Default, Midnight, Paper, Forest, Frost, Graphite, Mocha Cream, Espresso Night, Soft Linen, Fresh Meadow, Warm Sand, Royal Plum and Sage Garden. Every theme has light and dark token sets. The accent and optional custom colours remain independent; existing saved colour-scheme and palette ids are normalized to the unified theme id.
- **Motion**: hover and state changes are 150ms, panel changes 200ms, all switched off under the system's "reduce motion" preference. Every control has a visible keyboard focus ring.
- **Responsive**: the four summary cards are one column below 640px, 2x2 from 640px to 1023px, and one row from 1024px; the Trading panel takes the wider column and Savings, Habits and Mood share the other. Below 640px the page is a single column, the header stacks, and the Week / Month control takes the full width. The previous / next arrows keep their size and the "This week" button keeps its slot, so changing period never shifts the controls. Nothing scrolls sideways (checked at 360, 768, 1024 and 1440).
- **Charts**: plain SVG, with every colour read from the theme at render time (`--pos`, `--neg`, `--mood`, `--chart-axis`, `--chart-grid`), so dark mode and every palette are correct. Tooltips are real themed elements, and each chart's figures are also text.

### How to add a themed component
1. Build with the existing primitives: `.page` / `.page-sm` / `.page-lg`, `.card` + `.card-pad*`, `.btn` / `.btn-primary` / `.btn-danger` / `.btn-icon`, `.field`, `.seg`, `.badge`, `.tbl`, `.row-link`, `.empty`, and `PageHeader` / `EmptyState` / `PnL` from `components/`.
2. Use token classes only (`bg-card`, `text-muted`, `border-line`, `bg-pos`, `text-neg`, `bg-accent`, ...), or `rgb(var(--token))` in an inline style when an SVG attribute needs it. Never write a fixed hex value in a page.
3. Add a new colour token in `src/shared/design.ts` first, then the CSS variable in `src/renderer/src/styles.css` and the first-paint copy in `src/renderer/index.html`; add a contrast check in `tests/design.ts`. Shape, spacing and type tokens are already multiplied by `--rs`, `--d` and `--ts`.
4. Check both themes and the narrow layout with `npm run preview`, and make sure the control has a visible focus ring and its movement is under 250ms (all animation is switched off for reduced motion).

### Looking at the design without the app
`npm run preview` builds a browser-only copy of the Review page with made-up figures (`src/renderer/preview.html` + `src/renderer/src/preview.tsx`, built by `vite.preview.config.ts`, served by `scripts/preview-server.mjs`) and prints `http://localhost:5199/`. Use the button at the top to switch theme and drag the window narrower to check the tablet and mobile layouts. It is not part of the app: nothing in the real window imports it, and `.preview/` is not committed.

## Calendar
The **Calendar** page (sidebar, under Dashboard; also `Ctrl+K` > "calendar") shows a month as a Monday-to-Sunday grid, with what happened on each day across the tools. The days of the neighbouring months that fill the first and last row are shown greyed, with their own activity. It is a view of the other tools' data, not a separate list: nothing new is stored, no new table.
- **In each day**: a mood dot, the number of journal entries, the day's closed-trade P&L (an open trade shows as "1 open"), the savings movement (deposits minus withdrawals) and habits done out of scheduled. Amounts always carry a + or - sign, so colour is never the only clue, and every day has a spoken description ("Tue 20 Oct: 2 entries, 1 closed trade (+39.00), habits 0 of 1 done, mood good") as its tooltip and screen-reader label.
- **Show**: Journal / Trades / Savings / Habits buttons hide a layer from the grid when it gets busy (remembered between visits). The day panel always shows everything.
- **Summary line** above the grid: entries and days written, net P&L, savings movement, habit completion and average mood for the days of the month itself.
- **The day panel** (click a day): entries, trades and savings movements open in their own tool; **habits can be ticked or unticked for that exact day** (the way to catch up a missed one); and "Add a note to this day" writes a Logbook entry dated that day (first line = title, same as Quick capture). A note you have typed but not added is kept while you click through other days.
- **Keyboard**: the grid is one tab stop. Arrow keys move a day or a week, `Page Up` / `Page Down` a month, and focus follows the selected day. The month and day buttons work with the mouse as usual; "Today" appears when you have moved away.
- **Rules** (the same as the Habits page and the Review): a trade counts on its **entry date**; a habit counts only on days it was scheduled, days before it existed are not missed, today shows as "not yet" rather than missed until it is over, a check-in on a rest day is a bonus, archived habits are ignored, and days that have not happened yet show no habits.
- **Not included (yet)**: events or reminders. This calendar looks back at what you logged; planning ahead would need a new table. Weeks start on Monday, like the rest of the app.
- **Where things live**: `src/shared/calendar.ts` holds every rule (month and grid arithmetic, what lands on each day, the summary, the spoken description), covered by `tests/calendar.ts`. `src/main/calendar.ts` only fetches the rows for the whole visible grid (`calendar:month`, one round trip), and `modules/Calendar.tsx` is the page. The page reloads when something is saved from the Quick capture window.

## Quick capture
A small always-on-top window for logging something without opening the app: a **note**, a **trade**, a **deposit / withdrawal** or a **habit check-in**. Open it from any program with the global shortcut (default `Ctrl+Shift+Space`, `Cmd+Shift+Space` on a Mac), from the tray / menu-bar icon, or with "Quick capture" in the command palette (`Ctrl+K`). It uses only Electron's own features (`globalShortcut`, `Tray`, a second `BrowserWindow`); no package was added.
- **Using it**: `Ctrl+1` to `Ctrl+4` switch tab (`Cmd` on a Mac), `Ctrl+Enter` saves, `Esc` closes. In the one-line fields of the trade and deposit tabs plain `Enter` saves too; in the note box it makes a new line. After a save it says so for a moment and puts itself away. Clicking another window also puts it away, but **what you typed stays** until it is saved (switching tabs keeps it too).
- **Note**: the first line is the title and the rest is the body (a first line longer than 80 characters is cut for the title and the whole text is kept as the body, so nothing is lost). Optional mood and tags.
- **Trade**: asset, long/short, entry, exit, size, fees. A blank exit saves an **open** trade and blank fees mean 0. The asset and direction are remembered for the next one, and the asset box suggests the ones you already use.
- **Deposit**: pick the goal (the last one used is remembered), deposit or withdrawal, amount, optional note. It shows the goal's balance.
- **Habits**: today's habits are listed alphabetically; click one to check it off (or click again to undo). Each click saves at once and the window stays open so you can tick several. Habits that are resting today are only counted ("2 habits are resting today").
- **Dates**: an entry is dated the day you **save** it (read at that moment, so a window left hidden past midnight does not use yesterday).
- **The main window follows along**: when something is saved from the small window, the open Dashboard, Logbook, Trades, Savings, Habits and Review pages reload their data (a page is never remounted, so a half-written entry in an editor is untouched).
- **Settings > Quick capture**: switch it off, change the shortcut, and choose whether closing the main window keeps the app running in the tray. A new shortcut is tried with the system **before** it is saved, so one that another program already owns never replaces one that works; the page tells you why it was refused. Rules for a shortcut: it needs Ctrl (Cmd on a Mac), Alt or the Windows key (Shift alone would stop you typing capitals), and a letter, digit or punctuation key needs **two** modifiers (a lone `Ctrl+C` or `Alt+S` belongs to every other program). The settings are stored as `captureEnabled`, `captureHotkey` and `captureKeepRunning`, so they travel with a JSON backup; a damaged value falls back to the default.
- **Things that changed because of it**:
  - Only **one copy** of the app can run now (two would fight over the database and the shortcut). Starting a second copy brings the first to the front.
  - The capture window is created **hidden at start-up**, so the shortcut opens it instantly. It costs one extra small renderer process while the app runs; turning Quick capture off destroys it.
  - With "keep running in the tray" **off** (the default), closing the main window quits the app as before. With it **on**, the shortcut and tray icon stay alive and you quit from the tray menu. A Mac always keeps running when its window is closed, as Macs do.
- **Platform notes**: some Linux desktops hide tray icons, and on Wayland a program cannot listen for shortcuts while another window has focus; if either applies, use "Quick capture" in the command palette. The tray icon is embedded in `src/main/trayIcon.ts` (a plus sign; a black "template" version for the Mac menu bar), so nothing extra has to be packaged.
- **Where things live**: `src/shared/capture.ts` has every rule (which shortcuts are allowed, how a key press becomes one, how the form text becomes a valid note / trade / deposit, which habits are listed), covered by `tests/capture.ts`. `src/main/capture.ts` owns the shortcut, tray icon and window. `modules/Capture.tsx` is the small window's page (the same renderer bundle, shown instead of `<App />` when the address ends in `#capture`) and `components/CaptureSettings.tsx` the settings tab. To add another thing to capture, add a tab to `TABS` in `Capture.tsx` and a builder in `shared/capture.ts`.

## Shortcuts
- `Ctrl+1` to `Ctrl+7` open the tools that declare those shortcuts (see `tools.ts`; Review has none, use `Ctrl+K`). The Quick capture shortcut works in any program and is set in Settings, `Ctrl+N` creates a new item on the current page
- `Ctrl+K` (`Cmd+K` on a Mac) opens the command palette; press it again, or `Esc`, to close it. Search is still `Ctrl+6`.
- `Ctrl+B` collapses the sidebar to icons, or expands it again

## Sidebar
- **Groups**: tools are grouped by category (Money, Productivity, Notes, Utilities, ...). Click a group heading to fold or unfold it. A folded group that holds the page you are on shows a small accent dot.
- **Pinned**: hover a tool (or tab to it) and use the pin button to put it in a "Pinned" section at the top; pinned tools are listed there only, in the order you pinned them. Unpin the same way. Settings is always at the bottom and is not pinnable.
- **Icons only**: the button at the top of the sidebar, or `Ctrl+B`, shrinks it to icons. Hover or tab to an icon to see its name and shortcut. In icons-only mode every group is open so every icon is reachable. (Pinning is done in the full sidebar.) It also switches to icons by itself in a narrow window.
- **Pin / unpin never loses your place**: the tool moves to the Pinned section (or back to its category), a folded section it is moving into is opened, and keyboard focus follows it to its pin button.
- **Remembered**: `pinnedTools`, `sidebarClosedGroups` and `sidebarCollapsed` are saved in the app settings (the `settings` table in `everything.db`), so they survive restarts and are part of the JSON export and import. A copy is kept in the window's local storage so the sidebar looks right from the first paint. The grouping rules are in `src/shared/tools.ts` (`sidebarLayout`) and covered by `npm test`; the drawing is in `components/Sidebar.tsx`, with `sb-*` styles in `styles.css`, which use only the theme variables.

## Command palette
`Ctrl+K` (`Cmd+K` on a Mac) opens a search box in the middle of the window.
- **Typing** matches tool names, categories and keywords from the registry. Letters only need to appear in order (`lgb` finds Logbook, `money` finds everything in Money), and every word you type must match something. Equal matches keep registry order.
- **Keys**: `Up` / `Down` move (and wrap round), `Enter` opens, `Esc` closes, and so does `Ctrl+K` again. Hover and click work too. Focus returns to whatever had it before; if that element is gone because the page changed, it lands on the page.
- **Empty box**: shows the tools you opened most recently (the page you are on is left out), newest first. Before any have been opened it lists every tool.
- **Recent tools** are saved as `recentTools` in the app settings (the `settings` table in `everything.db`): tool ids, newest first, at most 8, no repeats. Every way of changing tool records one (sidebar, `Ctrl+<digit>`, the palette, "View all", search results). They survive restarts, are part of the JSON export and import, and an id for a tool that no longer exists is skipped when shown. Nothing leaves the computer.
- **Actions**: things the palette can do besides opening a tool. Add one entry to `ACTIONS` in `src/renderer/src/actions.ts` (the file has an example); the palette itself does not change. The list starts empty.
- **Where things live**: the matching, ranking, recents and action rules are in `src/shared/palette.ts` (covered by `tests/palette.ts`, run by `npm test`; `tests/registry.ts` checks the real tool list against the sidebar layout and the search, and repeats the rules for a generated 60-tool list); `lib/paletteItems.ts` turns tools and actions into palette rows; `components/PaletteHost.tsx` feeds them in; `components/CommandPalette.tsx` is the window, with `cp-*` styles in `styles.css`, which use only the theme variables. No library was added: the matcher is about 60 lines.

## Search
Search matches words in any field (`gold breakout` needs both), `#risk` matches tags, and a date like `2026-10` matches that month.
The matching rules live in `src/shared/search.ts`; each table's SQL sits next to its other queries (`searchEntries`, `searchTrades`, `searchGoals`, `searchTransactions`).

## Habits
Add habits you want to do regularly and check them off day by day. Each habit has its own weekdays (every day, weekdays only, or any mix).
- The Habits page lists today's habits with a big check button, the current streak and a 7-day strip. The big circle is the **only** way to check off today; the small dots open a menu so a day you forgot can be fixed.
- The header says **"X of Y due today"**, and Y counts only the habits that are actually due today. A habit that is resting today is dimmed, carries a small **Rest day** badge, and its circle is disabled - so nothing is silently counted as "not done".
- The day dots show what happened in a shape as well as a colour, so the meaning never depends on seeing green or red: **done** = filled green circle with a tick, **missed** = red ring with a cross, **rest day** = muted dashed ring with a dash, **skipped** = muted dashed ring with a skip arrow, **to do today** = plain empty ring, **not yet** = dotted empty ring. Today's column has a slightly thicker ring.
- **Week navigation**: the `<` and `>` buttons move a week at a time, and **This week** jumps back. The strip shows the selected week (Monday to Sunday), so you can look at and fix older days. Future days and rest days are not clickable - a future day has not happened, and a rest day was not due.
- **The day menu**: clicking a dot opens a small panel with **Done**, **Missed**, **Skipped** and **Clear**. "Missed" and "Clear" both leave the day with no record (a missed day is worked out from the schedule, so it is never stored); "Clear" also removes a day that was already done. The choice that is already true is marked. Press **Esc** to close it, or click anywhere else.
- Click a habit's name for its 12-week history grid, 30-day rate and best streak. The same editor archives (hides but keeps the history) or deletes it.
- **Streak rules** (all in `src/shared/habits.ts`, covered by `tests/habits-rules.ts` and `tests/habits-history.ts`):
  - Only days the habit is **due** count towards a streak or a rate. A rest day neither adds to nor breaks a streak.
  - A **missed** day is a past day that was due and was not done. Today is never missed - the day is not over yet.
  - A **skipped** day (sick day, travel) neither adds to nor breaks a streak.
  - A check-in on a **rest day** is a bonus: it counts in the total only, never in a streak or a rate.
  - Days before a habit existed are not missed. If a habit was checked off before it was created, tracking is treated as having started on that earlier day.
- Streaks and rates are always calculated from the check-ins (`src/shared/habits.ts`), never stored. The shared helpers are `isHabitDue`, `getDayStatus`, `calculateCurrentStreak`, `calculateBestStreak` and `calculateCompletionRate`, so the Habits page, the Review page and the Dashboard can never disagree. The queries are in `src/main/habits.ts`.
- The Dashboard's "Habits today" tile uses the same rules, computed for the date the page sends.
- Habits and check-ins are in the JSON export and import. Backups made before habits existed still import (they just contain no habits).

## Tasks
Tasks live in one SQLite list with views (Today / Upcoming / Overdue / All / Completed), a board, filters, checklists, status, tags and projects. Queries: `src/main/tasks.ts` (tests in `tests/tasks.ts`); shared rules: `src/shared/tasks.ts`.

### Recurring tasks: the contract
A recurring task is a row whose `recurrence` field holds `{ frequency, intervalDays }`. Occurrences are ordinary task rows linked by `parent_task_id`. The rules are also written as a comment at the top of `src/main/tasks.ts`; the one-child rule is enforced by a unique index (migration 7).

### The task editor
Title, due date, priority and status are up top; project, tags, notes, checklist and repeat live under a collapsible **Advanced** section (a real button with `aria-expanded`). It opens by itself when the task being edited already has any of those set, and while it is hidden its button shows a one-line summary of what is set, so nothing set is ever hidden. Validation runs from one shared function, `taskInputProblems` in `src/shared/tasks.ts` (tests in `tests/tasks.ts`): it returns one plain "what to fix" message per bad field, the editor shows each next to its field (with `aria-invalid`/`aria-describedby`, focusing the first bad one on a failed save) and the main process throws the first message too, so both sides agree. Past due dates stay allowed — an overdue task is a real state — while impossible dates are refused. The editor follows the other editors' keyboard rules: `Esc` closes, `Ctrl+Enter` saves.
- **Completion creates the next occurrence.** Completing a row (tick, or saving the editor from a not-done status to done) adds one child occurrence — same title, notes, priority, project, tags and checklist (reset to unchecked) — dated the completed row's due date advanced by one interval, or today's local date when it has no due date. Daily = the day after, weekly = the week after, monthly = the same day next month (clamped to the month's end), custom = every N days.
- **One child, ever.** A row can never gain a second child. The completion re-checks for an existing child inside the same transaction, and the database itself forbids a second `parent_task_id` link to the same parent — so double-clicks, repeated calls and done → undone → done all change nothing beyond the status they set.
- **A child behaves exactly like any other task.** When completed it may spawn at most its one successor, decided by the rule copied into it when it was created. A series is therefore a straight line, one link per completion, never a fork, and it never runs ahead of you: nothing is generated in the background.
- **No end date or limit exists yet.** The rule has no end date or occurrence count, so a series keeps going as long as its occurrences keep being completed.
- **Editing a parent** touches only that row and rows created later. A child that already exists keeps everything it was created with, and editing (or removing the repeat from) a parent that already spawned changes no future occurrence.
- **Deleting a parent** unlinks the child (it becomes a standalone task with its own rule and keeps the series going); subtasks are deleted with their task.
- **Backups** keep ids and links exactly as they were. The import check refuses (with a plain message, before anything is replaced) a file whose task points at a parent not in the file, is its own parent, or has two children sharing one parent; importing never runs the completion logic, so restoring creates no extra occurrences.

## Daily briefing
The **Daily briefing** page (sidebar, top; also `Ctrl+K` > "daily briefing", and a card on the Dashboard) is a quiet summary of **today only**: tasks due and overdue, habits still to do with their streaks, savings goals with progress and the last deposit, open trades or yesterday's result, and yesterday's mood / your last journal entry — plus one rule-written line at the top ("You have 3 tasks due and 2 habits left today."). Rule-based and fully offline; no AI, no network.
- Each section **hides itself** when it has nothing to show. The Journal section always appears, because even empty it offers "Write today's entry".
- The feature can be switched off on the **Intelligence** page (`intelligence.features.dailyBriefing`, default on), which removes it from the sidebar and the palette and hides the Dashboard card.
- **Where things live**: every rule is a pure function in `src/shared/briefing.ts` (data in, sections out, all dates local `YYYY-MM-DD`; covered by `tests/briefing.ts`); `src/main/briefing.ts` only fetches the rows for the whole briefing in one round trip (`briefing:build`); `modules/Briefing.tsx` is the page.

## Natural-language quick add (step 4)
Type a sentence in the command palette (`Ctrl+K`) or the Quick capture window's **Ask** tab, and the parser proposes what to create. The parser is pure pattern-matching (`src/shared/quickAdd.ts`) — no AI, no network, dates computed from the local date. **Nothing saves until you confirm**: the preview card shows exactly what would be created, every field editable, and Cancel saves nothing. When the parse is not confident (unknown goal name, ambiguous habit prefix, no date found), the card says "Did you mean…?" instead of guessing.
- The feature is off until you turn on **Smart quick-add** on the Intelligence page.

### Supported phrases
- **Deposits / withdrawals**: `deposit 200 to vacation fund`, `add 25.50 into trip fund`, `save 10 to emergency`, `put 10 to emergency`, `withdraw 10 from car`. A currency symbol is ignored; "for/because/note …" after the goal becomes the note. An amount of 0 or a missing amount is refused.
- **Recurring tasks**: `task pay rent every month on the 1st`, `task water plants weekly`, `task stretch every 3 days`, `task jog daily`, `task report every monday`, `task clean every 2 weeks`.
- **One-off tasks**: `task call dentist friday high priority`, `task file taxes today`, `task book flight tomorrow`, `task submit report in 3 days`, `task review budget next monday`. Priorities: `high priority`, `priority low`, or a bare `high` / `medium` / `low`. The title is whatever is left after date and priority words come out.
- **Habit check-ins**: `habit check in meditation`, `habit checkin meditation`, `habit check off meditation`, `checked meditation`, `did meditation`. A unique prefix matches (`medi` → Meditation); an ambiguous prefix asks which one you meant.
- **Notes**: `note feeling tired today`; a `:` or `.` after the first words splits title from body.

### Dates (computed here, no library)
`today`, `tomorrow`, `in N days`, `next monday` (always next week's), and bare weekday names (`friday` = the next Friday, including later this week). Everything is arithmetic on the `YYYY-MM-DD` text with UTC helpers, so time zones and DST cannot shift a day.

### How to add a new pattern (one small change)
1. Open `src/shared/quickAdd.ts`.
2. Add a pattern to `PATTERNS`: an `id`, a `triggers` regex matching the whole trimmed lowercase line, and a `build(line, ctx)` returning either `{ ok: true, parse }` (the proposal), `null` (this pattern does not apply after all — later patterns get a turn), or `{ ok: false, error }` (recognised but bad input).
3. If the proposal is a new shape, extend `QuickAddProposal`, `describeProposal` and `QuickAddPreview` with its fields.
4. Wire saving in `src/renderer/src/lib/quickAddSave.ts` (one `if (proposal.kind === …)` branch).
5. Add tests in `tests/quickAdd.ts` — the happy phrase, the ambiguous form, and something that should be rejected.

## AI assistant (step 6)
The **Assistant** page answers questions about your own data through a chat. **Off by default** — and the Intelligence master toggle ("AI assistant") must be on before the page even appears in the sidebar.

### Modes, and exactly what leaves the computer
- **Off (default):** nothing. There is no request to build or send; the page says so.
- **Local model:** one short text block per question — the fixed instructions block (function names only, no data) plus a user turn reading `Today is <date>. Question: <your words>` — sent to an OpenAI-compatible endpoint that **must be loopback** (`localhost`, `127.0.0.1` or `[::1]`; anything else is refused). Nothing crosses your network. No key needed.
- **Cloud:** the same one text block, plus your API key in an `Authorization` header, over **https** (required; loopback is not allowed in cloud mode) to the address you set (default `https://api.openai.com/v1`). Enabling it requires typing "I understand". Under **every** answer, an expandable "What was sent, exactly" section shows the verbatim user turn, the instructions block's size, the function the model chose, its date range, and the number computed locally — plus the line "Rows sent to the provider: None." The numeric result never travels back to the provider.

In **all** modes the model never sees rows, SQL, history, or the database: it replies with one function call from a fixed list (`savings_total`, `trade_pnl`, `habit_completion_rate`, `tasks_completed`, `mood_average`, `journal_entries`), each taking only a from/to date range; the app runs it locally on the shared data layer. One call per question, no chaining. Read-only by construction — there is no write path.

### Key storage
Cloud keys are encrypted with **Electron `safeStorage`** (Windows DPAPI / macOS Keychain / desktop keyring) and stored only as a ciphertext blob. If the OS cannot encrypt (e.g. Linux without a keyring backend), saving is **refused** with an explanation rather than writing plain text. The key is never sent to the renderer, never logged, never shown back, and **excluded from JSON exports**. Automatic local `.db` copies can contain the encrypted blob. Remove key deletes the stored blob; if a saved blob cannot be decrypted on this computer, both Assistant pages say to paste it again.

### Safety and failure handling
Cloud confirmation is tied to the normalized address; changing it requires confirmation again. Requests do not follow redirects, and questions are limited to 500 characters. Restoring a JSON export resets the assistant to Off and clears cloud confirmation, while retaining a valid local URL and model name; any key blob in an edited export is ignored. Plain, specific errors cover: assistant off, cloud not confirmed, no key, unreachable server, rejected key, timeout (30 s), and unusable model replies. Chats exist only in the page's memory — "Clear history" empties them and nothing is persisted anywhere, not even the question list.

**Where things live:** every testable rule — function table, prompt, reply parsing, endpoint validation, readiness, failure wording — is pure in `src/shared/assistant.ts` (29 checks in `tests/assistant.ts`). `src/main/assistant.ts` owns safeStorage, the single `fetch` call (no SDK, no new dependency) and running the chosen function. `modules/Assistant.tsx` is the chat; the provider picker, key box and cloud confirmation live on the Intelligence page.
The selected provider is stored once in `assistant.provider`; the Intelligence provider picker updates the same main-owned assistant settings used by the Assistant page.

## Insights
The **Insights** page (sidebar, top; also `Ctrl+K` > "insights", and a "See patterns" card on the Dashboard) finds cross-tool patterns with **simple statistics only** — two-group averages and one Pearson correlation. No AI, no network. It respects the **Insights** toggle on the Intelligence page.

### How each insight is calculated
All maths lives in the pure module `src/shared/insights.ts` (tested in `tests/insights.ts`). It first builds one row per day in a rolling 6-week window (`buildInsightDays`): habits scheduled/done, average mood (1–5), closed-trade P&L, net savings, tasks completed that local day.

- **Savings vs. habit completion** (`savings-by-habits`): scheduled-habit days are ranked by that day's completion rate; the top half is the "high" group, the bottom half the "low" group. The insight compares the average net savings of the two groups. Needs `MIN_DAYS` (4) days per side.
- **Trade P&L vs. habit completion** (`trades-by-habits`): same grouping; compares average closed-trade P&L per day between the two groups.
- **Mood vs. tasks completed** (`mood-by-tasks`): days with a logged mood are ranked by tasks completed; top half vs. bottom half, comparing average mood (1–5).
- **Mood ↔ tasks correlation** (`mood-vs-tasks`): Pearson r between tasks-done and mood across all days with both. Reported with **n** and **r**; "no clear link / weak link / fairly strong link" by |r| (<0.3 / <0.6 / more).
- **Tables**: habit completion rate by weekday, closed-trade P&L by weekday, and closed-trade P&L bucketed by the day's mood — each row shows its own counts, so every headline is checkable.

**Honesty rules**: a comparison only appears when each side has ≥ `MIN_DAYS` (4) days; the window must span ≥ `MIN_WEEKS` (4) weeks; correlations need ≥ `MIN_MOODS` (4) joint days and non-zero variance; a difference under `SAME` (0.25) is reported as "about the same". Wording is descriptive ("was higher on", "might be a pattern") and never causal. Under every card sits the detail line: sample sizes and the raw averages (or n and r). When data is short, the page says exactly what is missing instead of guessing.

**Dismissals**: the ✕ on a card remembers the id in the main-owned `insightDismissals` setting, so it stays gone. The Dashboard card and the Review page's "Top insights" block (three strongest cards) honour the same list and the same toggle.

### How to add a new insight
1. In `src/shared/insights.ts`, extend `InsightDay` if you need a new per-day number, and fill it in `buildInsightDays`.
2. Write the comparison with the existing `compare(...)` helper (two groups → averages + sample sizes) or `correlationInsight(...)` (a series pair → r + n). Give it a unique `id`, cautious wording, and a plain-`needText` for when data is short.
3. Add the id to the `KNOWN` list in `src/main/insights.ts` so dismissal works.
4. Render it in `modules/Insights.tsx` (and optionally the Review "Top insights" list — they read the same arrays).
5. Tests in `tests/insights.ts`: the rich-window case, the tiny-data case, and a ties case.

## Automations
Automations are small, predictable helpers — **not** a general rule builder. Each one listens for one thing happening (a tool event), decides from its own toggle and a number, and either **creates a draft** or **shows a message**. All four are off by default, each with its own card on the Intelligence page.
- **Loss reflection drafts**: a trade closing at a loss bigger than your threshold creates a draft logbook entry with reflection prompts. The entry is tagged `#automation`, its first line says "Created by an automation — safe to delete", and deleting it in the Logbook deletes it like any entry.
- **Goal celebrations**: a savings goal reaching its target shows a celebration message and suggests setting a new goal.
- **Broken streak notes**: a habit streak of 7 or more days breaking shows a gentle note (on the Daily briefing's "From your automations" area).
- **Stale overdue tasks**: a task overdue for more than N days is surfaced in the Daily briefing.
- **Transparency**: the Intelligence page's **Automation activity** list shows every action with its time, rule and — when one was made — a link straight to the entry. Rows can be deleted one by one or cleared; deleting a row never touches the entry it may have created.
- **Safety**: rules can only create or show. The DB layer runs every action through `guardAction`, which drops anything else; there is no UPDATE or DELETE path an automation can reach. Loop prevention is three layers: rules never emit events; entries an automation made do not re-trigger `journal-entry-saved`; and `automation_events` has a unique `(rule, event_key)` row per trigger, so the same event can never fire a rule twice.
- Intelligence feature toggles, automation rules, and insight dismissals are stored under separate settings keys and are written by the main process, so changing one cannot overwrite another.
- Automation failures are logged and skipped; they cannot turn a successfully saved entry, trade, savings, task, or habit change into an apparent save failure.
- **Where things live**: the engine and all four rules are pure functions in `src/shared/automations.ts` (covered by `tests/automations.ts`; `tests/automations-safe.ts` verifies save isolation when automation fails). `src/main/automations.ts` receives events, dedups them in the `automation_events` table (migration 8) and carries out actions. Tools emit events in one line each (see `updateTrade` in `src/main/trades.ts`, `addTransaction` in `savings.ts`, `setCheckin` in `habits.ts`, `setTaskStatus` in `tasks.ts`, `createEntry` in `logbook.ts`). The Daily briefing shows the automation trail under "From your automations".

### How to add a new rule (one small change each)
1. In `src/shared/automations.ts`: add the trigger's event kind to `AutomationEventKind` (if it is new) and write a rule function returning an `AutomationRule` — `id`, `label`, `description`, the `listensTo` kinds, and a pure `run(event, settings, ctx)` that returns `AutomationAction[]` (today: `create-draft-entry` or `message`).
2. Add the rule to `defaultRules()` and a toggle key to `AutomationSettings` + `RULE_TOGGLE`, with a default of `false`.
3. Add the toggle card in the Intelligence page (`modules/Intelligence.tsx`) reading/writing that key.
4. Emit the event where it happens: `emitAutomation(db, kind, key, data)` in the tool's main-process query file. The `key` (e.g. `trade:12`) is what makes the trigger fire once, ever, per rule.
5. Add tests in `tests/automations.ts` — off by default, fires on the event, ignores the rest.

## Add a tool
Tools are defined once, in the registry `src/renderer/src/tools.ts`. The sidebar, the page router, the keyboard shortcuts and the Settings shortcut list all read it.
1. Create the page component (a file in `src/renderer/src/modules/`, taking `ModuleProps`).
2. Add one entry to `TOOLS`: `id`, `name`, `icon`, `route`, `category`, `keywords` and `component`. Within a category, tools show in list order, and the first entry is the start page.
   - Categories (`overview`, `money`, `health`, `productivity`, `notes`, `utilities`) are listed in `src/shared/tools.ts`. A category with no tools is not shown; a new category is one line there.
- `shortcut` (optional, a digit 1 to 9) gives a tool Ctrl+<digit>. Most new tools leave it out. `footer: true` keeps a tool at the bottom of the sidebar, always visible and not pinnable (Settings).
- Pages and code can go to a tool by id or route: `onNavigate('trades')` or `onNavigate('/trades')`.
- A mistake in an entry (duplicate id, route or shortcut, bad shape, unknown category) stops the app at start-up with a readable message. The rules are in `src/shared/tools.ts` and covered by `npm test`.

## Appearance (Settings > top four cards)
Everything applies at once and is saved. Settings are in the JSON export too.
- **Mode**: Dark, Light or System (follows Windows live). The sun/moon button at the bottom of the sidebar flips it quickly.
- **Interface style**: *Modern* (rounded cards, soft shadows) or *Classic minimal* (flat, thin lines, sharp corners, compact). Picking one also sets corner roundness and spacing; both can be changed afterwards.
- **Colour themes**: one list of 13 themes (Default, Midnight, Paper, Forest, Frost, Graphite, Mocha Cream, Espresso Night, Soft Linen, Fresh Meadow, Warm Sand, Royal Plum and Sage Garden). Every theme has light and dark variants. Theme tokens are `bg`, `surface`, `sidebar`, `border`, `text` and `muted`; their contrast ranges are checked in `tests/appearance.ts`. `Customise colours` overrides page, sidebar, card and text per mode, and takes precedence over the theme.
- **Accent colour**: presets or any colour, independent of the theme. Accent fills retain the chosen colour; selected and active items use an accent tint over the surface, and text/icons use a contrast-adjusted accent when needed. The default green is `#075b38` in light mode and `#42a879` in dark mode: a saved accent that is exactly one of those two follows the mode.
- **Corner roundness, spacing, text size, font**: one multiplier each, so every page follows without per-page edits.
- **Sidebar**: full or icons only. It also collapses by itself when the window is under 1000px wide.

How it works: `src/shared/appearance.ts` owns the unified theme list, pure colour math, contrast validation and saved-setting normalization; `lib/theme.ts` puts the resolved tokens on `<html>`; `lib/settingsStore.ts` is the shared settings copy and caches the appearance to prevent a flash. Modern cards use the surface token with a blended border and soft shadow. Classic minimal cards use the page background and full border token, with flat surfaces and a separated sidebar.
- **Add a colour theme**: add both light and dark token sets to `PALETTES` in `appearance.ts` and cover their contrast in `tests/appearance.ts`.
- **Buttons** (`styles.css`): `btn`, `btn-primary`, `btn-danger`, `btn-icon`, plus `btn-sm`. All react to hover, press, keyboard focus, `disabled` and `aria-busy="true"` (spinner while saving).
- **Sidebar order**: pinned tools first, then the categories in the order of `TOOL_CATEGORIES`; inside a category, the order of `TOOLS`. See "Sidebar" below.

## Tag colours
Settings > Tag colours lists every tag; pick a colour and it applies in the logbook, trades and search. Colours are saved in the settings (so they are in your JSON export too). Chip drawing is in `components/TagChip.tsx`, the colour store in `lib/tagColors.ts`.

## Export and import (Settings page)
- **Export everything (JSON)** saves logbook, trades, savings and settings to one file. Keep a copy somewhere other than this computer.
- **Export trades (CSV)** opens in Excel. It is for reading only; P&L is included as a calculated column.
- **Import backup** checks the file, shows what it contains versus what the app holds now, and on confirmation *replaces* all data with the file. The current database is copied to `before-import/` first (newest 5 kept). If the file has any problem nothing is changed. The check also rejects unknown moods and savings goals that would end below zero (`npm test` covers these).
- File format and checks: `src/shared/backup.ts`; database side: `src/main/backup.ts`.

## Your data
Stored in `%APPDATA%\feeblests-everything\data\everything.db`, with daily backups in `backups/`.
