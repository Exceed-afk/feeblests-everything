## Conventions for this project

- No new dependencies without asking me first.
- Business rules and pure logic live in `src/shared/` (with tests in `tests/`, run via `tsx`). 
  Main process code should stay thin — mainly fetch/save + IPC. Avoid putting complex logic in `src/main/`.
- Always run `npm run typecheck && npm test` before saying anything is done. Fix failures yourself.
- Use theme tokens / classes only. No hardcoded colors or magic values.
- Keep everything local-only (SQLite + Electron). No external services, analytics, or network calls unless I explicitly request them.
- If a change alters existing behaviour (especially recurrence, task status, migrations, or backup), list it explicitly in your report. Never change behaviour silently.
- Update `README.md` for anything a user or future maintainer needs to know.
- Prefer small, focused changes. Ask before large refactors or architectural shifts.

- **Adding a new tool**: To add a new tool to the Freebuff app:
  1. Create a page component in `src/renderer/src/modules/` (e.g., `MyTool.tsx`)
  2. Add ONE entry to the `TOOLS` array in `src/renderer/src/tools.ts`:
     - `id`: short lowercase identifier (e.g. "mytool")
     - `name`: display name shown in the sidebar
     - `route`: page route (e.g. "/mytool")
     - `category`: one of the existing categories from `TOOL_CATEGORIES` in `src/shared/tools.ts`
     - `keywords`: lowercase array of search terms
     - `shortcut`: optional Ctrl+digit (1-7), leave out for most tools
     - `icon`: LucideReact icon component
     - `footer: true` to keep it at the bottom (Settings-only)
     - `component`: React component taking `ModuleProps`
  3. Re-export the component in `src/renderer/src/tools.ts` import section
  4. Run `npm run typecheck` to verify
  5. Add the tool's category to `TOOL_CATEGORIES` if it's a new category
  6. Add the tool's keywords to help users find it in search
  7. Update `README.md` if the tool has notable features or config

  See the existing entries in `src/renderer/src/tools.ts` for the exact pattern.
  The `validateTools(TOOLS)` call at the bottom will reject any mistakes at start-up.

- **Calculator (Phase 12)**: the all-in-one calculator is the biggest module; follow its layout:
  - **Files**: pure engine → `src/shared/calculator/` (parser/, evaluator/, numeric/, modules/, limits.ts, registry.ts…); UI → `src/renderer/src/modules/Calculator/` (CalculatorTool.tsx entry, panels/, workers/); SQL → `src/main/calculator.ts`; IPC handlers → `src/main/index.ts` (`calculator:*` channels); schema → migration 27's seven `calc_*` tables.
  - **Core boundary rule**: `src/shared/calculator/` must not import electron, react, `window`, or the db — enforced by `tests/calc-boundary.ts`. Heavy math (CAS, graph sampling, scripts) never crosses IPC; it runs in the Web Workers spawned by `workers/harness.ts`.
  - **Tests**: `npm run test:calc` (28-file logic/DB/adapters/limits/fuzz chain), `npm run test:calc-ui` (patchright Chromium against the `.calch` browser harness — build it first with `npx vite build --config vite.calch.config.ts`), `npm run test:calc-perf` (hardware-calibrated timing suite; updates `docs/calculator-performance.md`).
  - **Limits**: every user input class has a hard cap in `src/shared/calculator/limits.ts` — do not bypass or raise caps from callers; covered by `tests/calc-limits.ts`.
  - **Worker harness**: all three workers are spawned/correlated/terminated by `src/renderer/src/modules/Calculator/workers/harness.ts`; never spawn a bare `Worker` elsewhere in the calculator.
  - **Never edit an existing migration** in `src/main/migrations.ts` — append a new one; `user_version` tracks what has run.
  - **Regenerating docs**: `npm run gen:calc-docs` rebuilds `docs/calculator-functions.md` from the registry (do not hand-edit it).