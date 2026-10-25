# Feeblest's Everything

Local-only logbook, trade tracker and savings tracker for Windows (Electron + React + Tailwind + SQLite).

## Run it
1. Install Node.js 20+ and, if the install step complains about compiling, the "Desktop development with C++" tools from Visual Studio Build Tools.
2. In this folder: `npm install` then `npm run dev`
3. Build an installer: `npm run dist`

## Where things live
- `src/main/` - the "backend": window + SQLite database (db.ts)
- `src/preload/` - the safe bridge exposing `window.api` to the UI
- `src/renderer/` - the UI (React). Each feature is a file in `src/renderer/src/modules/`
- `src/shared/types.ts` - types used by all three

## Dashboard
The home page shows trade stats, savings totals, your logbook streak and the newest entries and trades. Everything comes from one call (`dashboard:summary`, built in `src/main/dashboard.ts`), and clicking any item opens it in its own module.

## Shortcuts
- `Ctrl+1` to `Ctrl+6` switch module, `Ctrl+N` creates a new item on the current page
- `Ctrl+K` jumps to Search from anywhere

## Search
Search matches words in any field (`gold breakout` needs both), `#risk` matches tags, and a date like `2026-10` matches that month.
The matching rules live in `src/shared/search.ts`; each table's SQL sits next to its other queries (`searchEntries`, `searchTrades`, `searchGoals`, `searchTransactions`).

## Add a module
Create a page component, add one line to `src/renderer/src/modules/index.ts`.

## Tag colours
Settings > Tag colours lists every tag; pick a colour and it applies in the logbook, trades and search. Colours are saved in the settings (so they are in your JSON export too). Chip drawing is in `components/TagChip.tsx`, the colour store in `lib/tagColors.ts`.

## Export and import (Settings page)
- **Export everything (JSON)** saves logbook, trades, savings and settings to one file. Keep a copy somewhere other than this computer.
- **Export trades (CSV)** opens in Excel. It is for reading only; P&L is included as a calculated column.
- **Import backup** checks the file, shows what it contains versus what the app holds now, and on confirmation *replaces* all data with the file. The current database is copied to `before-import/` first (newest 5 kept). If the file has any problem nothing is changed.
- File format and checks: `src/shared/backup.ts`; database side: `src/main/backup.ts`.

## Your data
Stored in `%APPDATA%\feeblests-everything\data\everything.db`, with daily backups in `backups/`.
