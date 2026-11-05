feeblests-everything/
├── .freebuff/
├── .git/
├── .preview/
├── .tooling/
├── .vscode/
├── build/
├── docs/
│   ├── architecture.md
│   ├── calculator-agent-prompt.md
│   ├── calculator-build-plan.md
│   ├── database-schema.md
│   ├── EXTENSION_PLAN.md
│   ├── intelligence-plan-(done).md
│   ├── task-manager-improvement-plan(done).md
│   └── TREE.md
├── scripts/
│   ├── build-native.mjs
│   ├── check-db.cjs
│   ├── launch.cjs
│   ├── preview-server.mjs
│   ├── preview.cjs
│   ├── qa-insights-height.mjs
│   ├── qa-result.json
│   ├── tmp-check-today.mjs
│   ├── tmp-verify-habits.mjs
│   ├── tmp-verify-popover.mjs
│   ├── tmp-verify-themes.mjs
│   ├── tmp-verify-types.mjs
│   └── qa-insights*.png
├── src/
│   ├── main/
│   │   ├── assistant.ts
│   │   ├── automations.ts
│   │   ├── backup.ts
│   │   ├── briefing.ts
│   │   ├── builtinTemplates.ts
│   │   ├── calendar.ts
│   │   ├── capture.ts
│   │   ├── dailyCheck.ts
│   │   ├── db.ts
│   │   ├── index.ts
│   │   ├── ipc.ts
│   │   ├── logbook.ts
│   │   ├── migrations.ts
│   │   ├── review.ts
│   │   ├── savings.ts
│   │   ├── search.ts
│   │   ├── tasks.ts
│   │   ├── trades.ts
│   │   └── ...
│   ├── modules/
│   ├── preload/
│   │   └── index.ts
│   ├── renderer/
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── App.css
│   │   │   ├── main.tsx
│   │   │   ├── tools.ts
│   │   │   ├── components/
│   │   │   │   ├── PaletteHost.tsx
│   │   │   │   ├── Pnl.tsx
│   │   │   │   ├── PnlChart.tsx
│   │   │   │   └── Sidebar.tsx
│   │   │   ├── lib/
│   │   │   │   ├── dates.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── format.ts
│   │   │   │   ├── navigation.ts
│   │   │   │   ├── paletteItems.ts
│   │   │   │   ├── settingsStore.ts
│   │   │   │   ├── snippet.ts
│   │   │   │   ├── theme.ts
│   │   │   │   └── useTaskFilters.ts
│   │   │   └── modules/
│   │   │       ├── Calendar/
│   │   │       ├── Capture/
│   │   │       ├── Dashboard/
│   │   │       ├── Habits/
│   │   │       ├── Logbook/
│   │   │       ├── Review/
│   │   │       ├── Savings/
│   │   │       ├── Search/
│   │   │       └── Trades/
│   │   └── index.html
│   └── shared/
│       ├── appearance.ts
│       ├── assistant.ts
│       ├── automations.ts
│       ├── backup.ts
│       ├── calculators.ts
│       ├── calendar.ts
│       ├── capture.ts
│       ├── dashboard.ts
│       ├── format.ts
│       ├── habits.ts
│       ├── math.ts
│       ├── palette.ts
│       ├── review.ts
│       ├── savings.ts
│       ├── search.ts
│       ├── tasks.ts
│       ├── tools.ts
│       ├── trades.ts
│       ├── types.ts
│       └── url.ts
├── tests/
│   ├── appearance.ts
│   ├── assistant-compare.ts
│   ├── assistant-filters.ts
│   ├── assistant-followup.ts
│   ├── assistant-format.ts
│   ├── assistant-lists.ts
│   ├── assistant-parse.ts
│   ├── assistant-provider.ts
│   ├── assistant-range-resolve.ts
│   ├── assistant-range.ts
│   ├── assistant-settings.ts
│   ├── assistant.ts
│   ├── automations-glue.ts
│   ├── automations-safe.ts
│   ├── automations.ts
│   ├── backup-validation.ts
│   ├── briefing.ts
│   ├── builtin-templates.ts
│   ├── calculators.ts
│   ├── calendar.ts
│   ├── capture.ts
│   ├── changes-since.ts
│   ├── content.ts
│   ├── daily-check.ts
│   ├── dashboard.ts
│   ├── design.ts
│   ├── eval/
│   ├── expenses-service.ts
│   ├── focus.ts
│   ├── goal-projection.ts
│   ├── habit-checkin.ts
│   ├── habit-rate-parity.ts
│   ├── habits-db.ts
│   ├── habits-history.ts
│   ├── habits-links.ts
│   ├── habits-organisation.ts
│   ├── habits-rules.ts
│   ├── habits-stats.ts
│   ├── habits-types.ts
│   ├── habits.ts
│   ├── insights-stats.ts
│   ├── insights.ts
│   ├── insightsData.ts
│   ├── intelligence-settings.ts
│   ├── logbook-summary.ts
│   ├── markdown.ts
│   ├── migration-safety.ts
│   ├── migrations.ts
│   ├── notes.ts
│   ├── palette-recipes.ts
│   ├── palette.ts
│   ├── phase0.ts
│   ├── quickAdd.ts
│   ├── registry.ts
│   ├── review.ts
│   ├── savings.ts
│   ├── scratch-zzz-tokens.ts
│   ├── sqlite.ts
│   ├── streak-break.ts
│   ├── tags-service.ts
│   ├── task-completions.ts
│   ├── tasks.ts
│   ├── tmp-debug.ts
│   ├── tools-hub.ts
│   ├── tools-math.ts
│   ├── tools-service.ts
│   ├── tools.ts
│   ├── trade-closed.ts
│   ├── trade-rules.ts
│   ├── trades.ts
│   ├── url.ts
│   └── weekly-summary.ts
├── .gitignore
├── AGENTS.md
├── CHANGELOG.md
├── README.md
├── electron-builder.yml
├── electron.vite.config.ts
├── package-lock.json
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── vite.preview.config.ts
└── NEXTSTEP.md
