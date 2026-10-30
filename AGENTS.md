## Conventions for this project
- No new dependencies without asking me first.
- Business rules live in pure functions in src/shared/ with tests in tests/ (run with tsx). Main process code only fetches/saves.
- Run `npm run typecheck && npm test` before saying anything is done.
- Use theme tokens/classes only, no hardcoded colors. Keep everything local-only.
- If a change alters existing behaviour, list it explicitly in your report. Never change behaviour silently.
- Update README.md for anything a user or future maintainer needs to know.
