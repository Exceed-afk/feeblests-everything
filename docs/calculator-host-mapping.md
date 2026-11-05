# Calculator Host Mapping (Phase 0 output)

The build plan (`docs/calculator-build-plan.md`, Section 3 "Discovery checklist") requires a short
host-mapping note filled in from the real host project. This is that note, written from what the
code does now (verified against the source, not the plan's guesses). It answers the Section 14
"Definition of done" host-mapping checkbox.

| Concern | Answer in this host |
|---|---|
| **Language** | TypeScript 5.6 everywhere (strict, `tsc --noEmit` in `npm run typecheck`). |
| **UI framework** | React 18 (`react`/`react-dom` 18.3), one renderer bundle, no router. |
| **Styling and theming** | Tailwind 3 whose colour names all map to CSS variables set by `applyAppearance()` (`src/renderer/src/lib/theme.ts`, values in `src/shared/appearance.ts`). Dark mode = a `dark` class on `<html>` (`darkMode: 'class'`). The calculator consumes only token classes (`bg-card`, `border-line`, `text-muted`, `text-accent-fg`, …) plus its own `calc-*` semantic classes in `src/renderer/src/styles.css` — never literal colours — so theme/accent/radius/density changes apply to it without any calculator-side work. |
| **Tool registration** | One registry: `src/renderer/src/tools.ts`. A `TOOLS` array entry carries `id` (`'calculator'`), `name`, `route` (`'/calculator'`, label only), `category`, `keywords` (palette/search), an optional `shortcut` (none for the calculator), and the component. The Calculator entry is a **lazy** import (`lazy(() => import('./modules/Calculator/Calculator'))` + `Suspense`), the one exception to the app's static imports, because the calculator is the heaviest tool. `validateTools(TOOLS)` throws at startup on a malformed entry. Removing the entry removes the tool cleanly. |
| **Search integration** | Two layers: the command palette (Ctrl+K) ranks tools by `keywords` through the fuzzy matcher in `src/shared/palette.ts`, and the Settings page's tool checkboxes use the same list. The calculator does **not** participate in the SQLite `search_index` universal search (it has no rows that are user-searchable text). |
| **Storage** | SQLite via better-sqlite3, one file at `userData/data/everything.db`. Schema changes are append-only migrations in `src/main/migrations.ts` (migration 27 adds the seven `calc_*` tables). The renderer never touches SQL. |
| **Process model** | Electron main/renderer split. Renderer → preload (`contextBridge` → `window.api.calculator.*`) → `ipcRenderer.invoke` → `ipcMain.handle` (registered in `src/main/index.ts`, handlers thin in `src/main/calculator.ts`) → SQLite. Heavy math (CAS, graph sampling, scripts) never crosses IPC: it runs in Web Workers inside the renderer. |
| **Settings system** | Two stores: the app-wide settings store (`settings` table, one JSON blob) for appearance etc., and the calculator's own per-tool settings in the `calc_settings` key/value table (`precision`, `angleMode`, `defaultOutputFormat`, `baseCurrency`, `staleRateDays`, `maxHistoryItems`, `currencyDisplayDecimals`), typed by `CalcSettings` in `src/shared/calculator/types.ts` and read/written through the storage adapter. |
| **Test runner** | Plain `tsx` + `node:assert`, tests in flat `tests/calc-*.ts`. `npm run test:calc` runs the 28-file calculator chain (logic, DB, adapters, workers harness, fuzz, limits); `npm run test:calc-ui` is a browser integration suite (patchright Chromium against the `.calch` preview build); `npm run test:calc-perf` is the hardware-calibrated timing suite. The whole app also runs `npm test`, which includes `test:calc`. |
| **Build tooling** | electron-vite (renderer bundled with Vite/rollup, code splitting available and used for the calculator's `panelChunks.ts` lazy panels). Web Workers are bundled via `new Worker(new URL(...), { type: 'module' })` in `src/renderer/src/modules/Calculator/workers.ts`. |
| **Security rules** | `contextIsolation: true`, `nodeIntegration: false`, sandbox default; the preload bridge is the only door. External links go to the OS browser (`shell.openExternal`, gated by `src/shared/url.ts`). Calculator-specific rules (plan Section 11, all implemented): no `eval`/`new Function` anywhere (AST evaluation only), scripts run in a worker sandbox with a step cap (`CALC_LIMITS.scriptSteps`, not raisable by callers) and time limit, CSV/JSON/program imports are parsed and validated as data and never executed, every input class has a hard cap in `src/shared/calculator/limits.ts`, and there are no network calls from the calculator. |
| **Conventions** | Pure logic in `src/shared/calculator/` (import-boundary-tested by `tests/calc-boundary.ts`: it must not import electron, react, window or db); main-process files thin; theme tokens only; behaviour changes listed in the report and CHANGELOG. |

## Storage path in detail (renderer → preload → IPC → main → SQLite)

1. A panel calls `defaultStorageAdapter.<method>()` — an `ElectronIpcCalculatorAdapter`
   (`src/renderer/src/modules/Calculator/adapters/storage.ts`) that implements the framework-free
   `StorageAdapter` interface from `src/shared/calculator/types.ts`.
2. That adapter forwards to `window.api.calculator.<method>` exposed by the preload script
   (`src/preload/index.ts`, namespaced group `calculator`); when `window.api` is absent (browser
   preview, `vite.calch.config.ts` + `tests/calc-ui.ts` harness) it falls back to a
   `LocalStorageCalculatorAdapter` so the UI still works with `localStorage` keys `calc_*`.
3. Preload turns each call into `ipcRenderer.invoke('calculator:<method>', payload)`.
4. `src/main/index.ts` registers one `ipcMain.handle` per channel; the handler calls the matching
   query function in `src/main/calculator.ts` (history, variables, programs, rate sets/rates/
   overrides, settings — including the `maxHistoryItems` prune on every history save) with the DB
   handle from `src/main/db.ts`.
5. Results return as plain JSON rows (`CalcHistoryItem`, `CalcRate`, …). `rateSnapshot` on a
   currency history row is a JSON string holding the exact rates used (see
   `src/shared/calculator/currencyUi.ts`).

## Backup

`src/main/backup.ts` exports/imports the seven `calc_*` tables in the JSON backup format
(`schemaVersion` recorded and validated by `src/shared/backup.ts`), so calculator history,
programs, variables, rate sets and settings round-trip with the rest of the app. Migration-27
columns (`pinned`, `rate_snapshot`) are part of that round-trip.

## Migrations

The calculator owns migration 27 (`calc_history`, `calc_variables`, `calc_programs`,
`calc_rate_sets`, `calc_rates`, `calc_rate_overrides`, `calc_settings`). Rule: migrations are
append-only — never edit an existing entry; `user_version` (= `MIGRATIONS.length`) tracks what
has run. Current count: 27.

## Workers

`src/renderer/src/modules/Calculator/workers.ts` is the shared harness: it spawns
`cas.worker.ts`, `graph.worker.ts` and `script.worker.ts` (bundled as module workers), correlates
requests by id, enforces time limits (CAS default 5 s via `CasOptions.timeLimitMs`, graph 2 s,
scripts 5 s wall-clock on top of the 100k step cap), hard-terminates on timeout, and supports
cancel/abort (graph sampling cancels stale requests during rapid pan/zoom). The UI shows
"Running… / Cancel" while a worker task is live. QA: `scripts/qa-calculator-workers.mjs`
(behaviour) and `tests/calc-workers-harness.ts` + `tests/calc-perf.ts` (timings).
