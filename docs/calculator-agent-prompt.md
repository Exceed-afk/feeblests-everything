# Agent Prompt: Build the Calculator Module

---

## Role

You are a senior engineer adding a full-featured calculator module to this project. You work carefully, in small verified steps, and you match the project's existing conventions instead of imposing your own.

## Files to read first (before writing any code)

1. `architecture.md` is the source of truth for how this project is structured: folder layout, conventions, process model, storage, IPC, registration of tools, theming, testing, and build rules.
2. `calculator-build-plan.md` is the source of truth for what the calculator must do: scope, phases, acceptance criteria, data model, and the currency design.

If the two documents conflict:
- `architecture.md` wins on **how** things are done in this project (conventions, structure, security rules).
- `calculator-build-plan.md` wins on **what** the calculator must contain.
- If you cannot resolve a conflict, stop and ask me. Do not guess.

## Hard rules

1. **Follow `architecture.md` exactly.** Use the project's existing patterns for registration, IPC, storage, migrations, settings, theming, and tests. Do not invent a parallel pattern.
2. **One registration point.** The calculator plugs into the host through the project's single tool or module registration mechanism. Adding or removing the calculator must be one entry plus its folder.
3. **Keep the math core pure.** All calculator logic lives in a framework-free folder with no UI, storage, or platform imports. Everything the host provides goes through small adapters.
4. **No dynamic code execution on user input.** Never use `eval`, `new Function`, or similar. Parse to an AST and evaluate the AST.
5. **Exact decimals for money and currency.** Store numeric values as strings where exactness matters.
6. **No network access.** The calculator works fully offline. Currency conversion uses **user-entered exchange rates only** (see the plan, section 7). Build the `RateProvider` interface with a single `ManualRateProvider`. Do not add any live-rate code.
7. **No engineering tools.** Respect the exclusion list in the plan. Do not add circuit, structural, thermodynamic, fluid, or similar calculators.
8. **New dependencies need justification.** Before adding any package, check whether the project already has something that does the job. If you add one, state why, its size, its license, and what you considered instead. Prefer the choices listed in the plan, and ask me before adding anything not listed there.
9. **Do not touch unrelated code.** Only change files the calculator needs (the registration entry, the migration, shared settings, and so on). If you find a bug or improvement elsewhere, note it in your report instead of fixing it.
10. **Every function ships with tests.** Known-answer tests first, then the implementation. Do not mark a phase done if its tests are missing or failing.
11. **Lazy-load heavy modules** (graphing, CAS, scripting) so app startup is not slowed.
12. **Security and limits.** Cap input sizes, run heavy computation (CAS, scripts, large plots) with time or step limits, and keep scripts sandboxed with no host API access.

## Step 0: Discovery (do this first and show me the result)

Read `architecture.md` and inspect the codebase. Then produce a short **host mapping note** that answers every row of the discovery checklist in section 3 of the plan: language, UI framework, styling and theming, tool registration, search integration, storage and migrations, process model and IPC, settings, test runner, build tooling and code splitting, security rules, and conventions.

Also list:
- Anything in `architecture.md` that the plan does not account for.
- Anything in the plan that does not fit this project, with your proposed adjustment.
- Open questions for me.

**Stop after Step 0 and wait for my confirmation before writing calculator code**, unless I have told you below to continue.

## How to work

- Work **one phase at a time**, in the order given in the plan. Do not start a phase until the previous one meets its acceptance criteria.
- For each phase:
  1. Restate the phase goal and the acceptance criteria in two or three lines.
  2. List the files you will create or change.
  3. Write tests first, then the implementation.
  4. Run the full test suite, the type checker, and the linter. Fix everything you broke.
  5. Run the app (or the closest verification the project allows) and confirm the feature works as a user would see it.
  6. Update `architecture.md` with the calculator's folder structure, its registration entry, its storage tables, and any new conventions. Keep the file's existing style.
  7. Write the phase report (format below), then **stop and wait for my approval** before the next phase.
- Make small, reviewable commits (or change sets) with clear messages, one logical change each. Do not bundle a whole phase into a single commit.
- Database changes go through the project's migration system as new versioned migrations. Never edit an old migration. Test the migration against existing data.
- Generate in-app help and the function reference from the function registry described in the plan, instead of writing them by hand.
- Match the project's theming, including dark mode, and keyboard and accessibility standards from the start, not as a final pass.

## Phase report format

After each phase, reply with:

1. **Done:** what was built, in plain language.
2. **Files:** created and changed, grouped by purpose.
3. **Tests:** number added, total passing, and anything skipped (with the reason).
4. **Acceptance criteria:** each criterion with pass or fail and how you verified it.
5. **Dependencies:** any added, with justification.
6. **Decisions:** choices you made that I should know about.
7. **Issues and risks:** known gaps, bugs found elsewhere, and questions for me.
8. **Next:** the next phase and what it needs from me.

## When to stop and ask

Stop and ask me instead of guessing when:
- `architecture.md` and the plan conflict and you cannot resolve it.
- A required change would affect code outside the calculator in a way the plan does not cover.
- A dependency is needed that is not in the plan.
- A test reveals that a plan assumption is wrong.
- Something would break the offline, local-only design.

## Current assignment

**Build now:** Step 0 only. 

**Extra instructions from me:** none.
