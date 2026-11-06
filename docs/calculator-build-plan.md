# All-in-One Calculator Module: Build Plan

A plan for adding a full-featured calculator (everything except engineering tools) to a local-first desktop or web app. It is written to adapt to whatever framework the host project uses at the time of the build.

---

## 1. Goal and scope

### In scope
- Core arithmetic with correct order of operations
- Scientific functions
- Statistics and probability
- Finance (time value of money, loans, NPV/IRR, compound interest)
- Currency conversion using **user-entered exchange rates** (no internet)
- Unit and everyday conversions (non-engineering)
- Graphing (2D)
- Linear algebra and complex numbers
- Symbolic math (CAS): simplify, solve, derivatives, integrals, limits
- Programming and number tools (number bases, bitwise, custom functions and scripts)
- Date and time arithmetic
- History, memory, variables, and a polished interface

### Out of scope (for now)
- Engineering-specific calculators (circuits, structural, thermodynamics, fluid, and similar)
- Engineering-heavy unit systems and standards tables
- Live exchange rates or any network access
- Exam-approved certification (a software calculator generally cannot qualify)

---

## 2. Design principles

1. **Pure logic core, thin adapters.** All math lives in a framework-free module (no UI, storage, or platform imports). Everything the host provides (UI, storage, settings, routing) goes through small adapters. This is what makes the build adjust to any framework.
2. **One registration point.** The calculator should plug into the host with a single entry (a tool registry, route table, or plugin manifest, whichever the host uses). Removing it should be as easy as adding it.
3. **No dynamic code execution on user input.** Never use `eval`, `new Function`, or equivalents. Parse expressions into an AST and evaluate the AST.
4. **Exact where it matters.** Use arbitrary-precision decimals for finance and currency. Use floats only where speed matters (graphing, large statistics).
5. **Local-first.** Everything works offline. Nothing is sent anywhere.
6. **Lazy by default.** Heavy modules (graphing, CAS) load only when first used.
7. **Test-first for math.** Every function ships with known-answer tests.

---

## 3. Step 0: Discovery checklist (do this before writing code)

Inspect the host project and fill in this table. The rest of the plan maps onto the answers.

| Concern | Question to answer | Why it matters |
|---|---|---|
| Language | TypeScript, JavaScript, other? | Decides library choices and typing of the core |
| UI framework | React, Vue, Svelte, native, other? | Decides the UI adapter |
| Styling and theming | Tailwind, CSS modules, design tokens? Dark mode mechanism? | Calculator must follow the host theme |
| Tool registration | Registry, router, plugin system? What fields does an entry need (id, name, icon, route, category, keywords, component)? | Single registration point |
| Search integration | Does the host have global search? How are tools indexed? | Calculator should be findable by keywords |
| Storage | SQLite, IndexedDB, files, other? Migration system? | History, saved programs, rates, settings |
| Process model | Single process or main/renderer split? How is IPC done? | Where storage calls and heavy work run |
| Settings system | Is there a settings store for per-tool preferences? | Precision, angle mode, base currency |
| Test runner | What runs tests? Where do tests live? | Test suite placement |
| Build tooling | Bundler, code splitting support, module format? | Lazy loading and worker support |
| Security rules | Context isolation, CSP, sandboxing, restrictions on external links? | Constraints on workers and any libraries |
| Conventions | Folder layout, naming, lint rules, error handling? | Match existing style |

Output of this step: a short "host mapping" note listing the answer to each row.

---

## 4. Architecture

src/
  shared/
    calculator/                    # core: pure logic. No electron, react, window or db imports
      index.ts                     # public API (what savings, trades, assistant can import)
      types.ts                     # types for history, programs, rate sets, settings (used by IPC)
      registry.ts                  # function and constant registry
      parser/                      # tokenizer, Pratt parser, AST, error types
      evaluator/                   # AST evaluation, scope, variables, Ans
      numeric/                     # decimal wrapper, rounding, formatting
      modules/
        scientific/  statistics/  finance/  conversions/
        linear-algebra/  complex/  datetime/  graphing/
        cas/  scripting/

  main/
    calculator.ts                  # SQLite service for calc_* tables (history, variables, programs, rates, settings)
    migrations.ts                  # (edit) add the calc_* migration
    ipc.ts                         # (edit) calculator handlers
    backup.ts                      # (edit) include calc_* tables

  preload/
    index.ts                       # (edit) expose the calculator API

  renderer/src/
    tools.ts                       # (edit) one line importing the host entry
    modules/Calculator/
      Calculator.tsx               # lazy-loaded entry component
      adapters/
        storage.ts                 # interface + implementation over the preload API
        settings.ts                # wraps lib/settingsStore.ts
        themeTokens.ts             # maps lib/theme.ts to calculator tokens
        host-entry.ts              # the single registration entry (id, name, icon, keywords, lazy component)
      shell/                       # layout, mode tabs, history panel
      input/                       # expression input, keypad, keyboard handling
      display/                     # rendered math output
      panels/                      # stats, finance, graph, convert, matrix, CAS and so on
      workers/                     # cas.worker.ts, graph.worker.ts, script.worker.ts

tests/                             # flat, like your other tests
  calc-parser.ts  calc-evaluator.ts  calc-numeric.ts  calc-registry.ts
  calc-scientific.ts  calc-statistics.ts  calc-finance.ts  calc-conversions.ts
  calc-known-answers.ts            # the 500+ expression tests
  calc-adapters.ts                 # contract tests for the adapter interfaces
  calc-boundary.ts                 # fails if core imports electron, react, window or db
  calc-fuzz.ts                     # parser fuzzing

docs/calculator-functions.md       # generated from the registry
scripts/gen-calculator-docs.mjs    # the generator

### Key interfaces

- **Function registry:** each function declares `name`, `aliases`, `arity`, `category`, `description`, `examples`, and `impl`. The UI keypad, autocomplete, help, and the docs file are all generated from it, so adding a function is one entry.
- **StorageAdapter:** `saveHistory`, `loadHistory`, `saveProgram`, `loadPrograms`, `saveRates`, `loadRates`, `getSetting`, `setSetting`. The host implementation maps these to whatever storage exists.
- **RateProvider (currency):** `getRate(from, to)`. The only implementation now is `ManualRateProvider`. A live provider can be added later without touching the rest.

---

## 5. Technology choices

Pick one option per row. The right choice depends on the Step 0 answers.

| Need | Primary choice | Alternatives | Notes |
|---|---|---|---|
| Expression parsing | Own Pratt parser | Math.js parser | Own parser gives full control and a small footprint. Math.js is faster to start and covers more. |
| Exact decimals | Decimal.js | big.js, bignumber.js | Needed for finance and currency |
| Statistics | simple-statistics | Own implementations | Small and well tested |
| Distributions | jStat | Own implementations | Normal, t, chi-square, binomial, Poisson |
| Linear algebra and complex | Math.js | ml-matrix, own code | Math.js handles matrices and complex numbers |
| Symbolic math (CAS) | Nerdamer | Algebrite, Giac (WASM), SymPy (bundled Python) | Nerdamer is pure JS and light. SymPy is stronger but heavy. |
| Math rendering | KaTeX | MathJax | KaTeX is faster and smaller |
| Plotting | Canvas with own renderer or Function Plot | uPlot, Chart libraries | A general charting library is overkill for function graphs |
| Heavy computation | Web Worker | Worker threads in the host runtime | Keeps the UI responsive |
| Scripting | Sandboxed expression language (own) | Restricted JS interpreter | Never run user scripts with host privileges |

If the host is not JavaScript or TypeScript, replace these with the equivalent libraries for that language. The architecture stays the same.

---

## 6. Phases

Each phase ends with a usable calculator. Do not start a phase until the previous one passes its acceptance criteria.

### Phase 0: Foundation and host mapping
- Complete the discovery checklist.
- Create the folder structure and the single host registration entry with a placeholder screen.
- Define the adapter interfaces and write contract tests for them.
- Set up the test runner for the calculator folder.

**Acceptance:** the placeholder tool appears in the host navigation and search, and adapter contract tests pass.

### Phase 1: Core engine
- Tokenizer and Pratt parser producing an AST.
- Evaluator with operator precedence, parentheses, unary minus, implicit multiplication (`2(3+4)`), percentages, and clear error messages with positions.
- Variables, `Ans`, and memory (store, recall, clear).
- Number layer: Decimal wrapper, rounding modes, and output formats (decimal, fraction, scientific, fixed places).
- History data model (see section 9).
- Basic UI: expression input, result display, history list, keyboard support.

**Acceptance:** 500+ known-answer expression tests pass, including edge cases (`0.1+0.2`, division by zero, deep nesting, very large and very small numbers). No use of dynamic code execution anywhere.

### Phase 2: Scientific
- Trigonometry in degrees, radians, and gradians, plus inverse and hyperbolic functions.
- Logs (natural, base 10, arbitrary base), exponentials, roots, powers.
- Factorial, permutations, combinations, gamma function.
- Absolute value, floor, ceiling, rounding, modulo, GCD, LCM, prime tools.
- Constants library (pi, e, physical constants for general use).
- Angle mode setting.

**Acceptance:** function results match reference values to the stated precision. Angle mode is applied consistently, including in inverse functions.

### Phase 3: Statistics and probability
- Dataset entry (paste, import CSV, manual table).
- Descriptive statistics: mean, median, mode, variance, standard deviation (sample and population), quartiles, range, percentiles.
- Regression: linear, quadratic, exponential, logarithmic, power, with r and R-squared.
- Distributions: normal, binomial, Poisson, t, chi-square, uniform (PDF, CDF, inverse CDF).
- Hypothesis tests and confidence intervals (z and t).
- Charts: histogram, box plot, scatter with regression line.

**Acceptance:** results match reference values from a trusted source for a fixed set of datasets.

### Phase 4: Finance
- Time value of money solver: present value, future value, payment, rate, periods (solve for any one).
- Loans and mortgages with amortization schedule and extra-payment options.
- Compound and simple interest, with different compounding frequencies.
- NPV, IRR, XNPV, XIRR, payback period.
- Percentage tools: markup, margin, discount, tax, tip, percent change.
- Savings goal and annuity tools.
- Position sizing and risk-reward tools (useful for trading): risk amount, stop distance, lot or position size, R:R ratio, break-even win rate.

**Acceptance:** results match standard financial calculator outputs for a fixed set of scenarios. All money math uses exact decimals.

### Phase 5: Conversions and currency (manual rates)
- Unit conversion for everyday categories: length, mass, volume, area, temperature, speed, time, data size, energy, pressure, and similar non-engineering sets.
- Currency conversion using user-entered rates (see section 7).
- Number base conversion (binary, octal, decimal, hex) with grouping.

**Acceptance:** conversion round trips return the original value within precision. Currency conversion works fully offline.

### Phase 6: Graphing
- Function input reusing the Phase 1 parser (variables `x`, `t`, `theta`).
- Plot types: explicit `y=f(x)`, parametric, polar, implicit (optional), inequalities (optional).
- Multiple functions with colors and visibility toggles.
- Zoom, pan, reset, auto-scale, grid, axes.
- Trace, value table, and finders for roots, intersections, minima, maxima, and derivatives at a point.
- Adaptive sampling so discontinuities and asymptotes do not draw false lines.
- Run sampling in a worker if the host allows it.
- 3D surfaces last, and only if time allows.

**Acceptance:** plots stay smooth at 60 frames per second during pan and zoom for common functions, and discontinuities render correctly.

### Phase 7: Linear algebra and complex numbers
- Matrix and vector entry and operations: add, multiply, transpose, determinant, inverse, rank, row reduction, solving linear systems.
- Eigenvalues and eigenvectors, and basic decompositions if the library supports them.
- Vector tools: dot product, cross product, norm, angle.
- Complex arithmetic, rectangular and polar forms, roots of complex numbers.
- Polynomial roots.

**Acceptance:** results match reference values on a fixed set of matrices, including singular and ill-conditioned cases (with clear error messages).

### Phase 8: Symbolic math (CAS)
- Simplify, expand, factor, substitute.
- Solve equations and systems symbolically, with numeric fallback.
- Derivatives, integrals (definite and indefinite), limits, series.
- Show results in rendered math notation.
- Run in a worker with a time limit so a hard problem cannot freeze the app.
- Clear "could not solve" results instead of wrong answers.

**Acceptance:** a fixed set of textbook problems returns correct results, and the time limit stops runaway computations.

### Phase 9: Programming and number tools
- Bitwise operations, shifts, and two's complement views.
- Custom functions and variables defined in the expression language.
- A small sandboxed scripting language for loops, conditionals, and saved programs.
- Save, load, rename, and delete programs.
- Import and export programs as files.

**Acceptance:** scripts cannot access the file system, network, or host APIs, and infinite loops are stopped by a step or time limit.

### Phase 10: Date and time
- Difference between dates, add or subtract days, weeks, months, and years.
- Business-day calculations.
- Age calculation, countdowns, and time zone conversion.
- Duration arithmetic (`2h 30m + 45m`).

**Acceptance:** results are correct across month ends, leap years, and daylight saving changes.

### Phase 11: Interface polish
- Rendered math output (KaTeX) for results and history. **Done 2026-11-06** for CAS results (`katex` 0.19.1, bundled locally, `trust: false`, plain-text fallback); history rows still show plain text.
- Mode switcher or tabs: Basic, Scientific, Statistics, Finance, Graph, Matrix, CAS, Convert, Programming, Date.
- Autocomplete and function search from the function registry, plus built-in help with examples.
- Keyboard-first use: shortcuts, command palette integration if the host has one, full keyboard navigation.
- Copy results as text, LaTeX, or plain number.
- Theming from the host (dark mode included), adjustable keypad layout, and accessibility (screen reader labels, contrast, focus order).

**Acceptance:** all features are reachable by keyboard, pass an accessibility check, and follow the host theme.

### Phase 12: Hardening and release
- Performance pass (startup time, memory, lazy loading).
- Fuzz tests on the parser and evaluator.
- Security review (see section 11).
- Documentation: generated function reference and a short user guide.
- Versioned data migrations for all calculator tables.

**Acceptance:** all tests pass, no known incorrect results, and the host app starts no slower than before the calculator was added.

---

## 7. Currency conversion with user-entered rates

Because the app is local-only, rates are entered and maintained by the user.

### Behavior
- **Base currency.** The user picks a base currency (for example USD). Every rate is stored relative to the base.
- **Add a rate.** The user adds a currency code, name (optional), and the rate against the base. The inverse is calculated automatically.
- **Cross rates.** Conversions between two non-base currencies go through the base (`A to B = rate(B) / rate(A)`). The user can also override a specific pair with a direct rate.
- **Last updated.** Each rate stores a timestamp and an optional note ("bank rate", "airport rate").
- **Stale warning.** A setting (for example 7 days) marks old rates visibly so the user knows to refresh them.
- **Rate sets or profiles (optional).** Let the user keep several sets (for example "Bank", "Cash exchange") and pick one for conversions.
- **Quick edit.** Edit a rate directly from the conversion screen so a one-off rate does not require leaving the calculator.
- **Import and export.** CSV or JSON, so the user can paste rates from a spreadsheet.
- **Rate history (optional).** Keep past values per currency, with a small chart.
- **Use in expressions.** Allow `100 USD to EUR` in the expression bar, using the same parser and the active rate set.

### Rules
- Store rates as strings and compute with exact decimals, never floats.
- The user chooses how many decimal places to show, and the calculator never rounds the stored rate.
- If a needed rate is missing, show a clear message with a shortcut to add it. Never guess or substitute.
- A history entry for a currency conversion saves a snapshot of the rate used, so old results stay explainable after rates change.
- Currency codes are free text with validation (3 to 5 characters) so users can add crypto, gold (XAU), or custom units.

### Future extension (do not build now)
The `RateProvider` interface has one implementation, `ManualRateProvider`. A live provider can be added later behind an opt-in setting, and it should write into the same rate tables so the rest of the calculator does not change. Because it needs network access, that step will also need to follow the host's network and security rules.

---

## 8. Registration and integration (generic)

- **Single entry:** one registration (tool entry, route, or plugin manifest) containing id, name, icon, category, keywords, and a lazily loaded entry component.
- **Search keywords:** include terms like `calculator`, `calc`, `math`, `convert`, `currency`, `loan`, `graph`, `matrix`, `percent`, `statistics`.
- **Lazy loading:** the entry component and each heavy module are loaded on demand.
- **Settings:** register calculator settings (angle mode, precision, default output format, base currency, stale-rate threshold) through the host settings system if present, or store them via the storage adapter.
- **Shortcuts:** register a "focus calculator" shortcut and a "quick calculate" action if the host supports global commands.
- **Cross-tool links (optional):** let other tools call the core directly, for example a savings tool using the finance module or a trade tool using position sizing, through the core's public API.

---

## 9. Data model (storage-agnostic)

Use whatever storage the host provides and its migration system. Suggested tables or collections:

| Table | Fields |
|---|---|
| `calc_history` | id, created_at, mode, input, result, result_format, rate_snapshot (nullable), pinned |
| `calc_variables` | name, value, updated_at |
| `calc_programs` | id, name, source, created_at, updated_at |
| `calc_rate_sets` | id, name, base_currency, is_active, updated_at |
| `calc_rates` | id, rate_set_id, currency_code, name, rate_to_base (string), note, updated_at |
| `calc_rate_overrides` | id, rate_set_id, from_code, to_code, rate (string), updated_at |
| `calc_settings` | key, value |

Guidelines:
- Cap history size with a setting and offer "clear history".
- Keep numeric values as strings to preserve exact decimals.
- Every schema change goes through a versioned migration.
- If the host supports sync or backup, include these tables in it.

---

## 10. Testing strategy

- **Known-answer tests** for every registered function (at least 3 cases each, including edge cases).
- **Property tests** for inverses (`sin(asin(x))`, unit round trips, `a + b - b = a` in exact mode).
- **Reference suites** for finance, statistics, and linear algebra, checked against trusted published values.
- **Parser fuzzing** with random and malformed input. The parser must never crash or hang.
- **Contract tests** for each adapter interface, so swapping the host implementation is safe.
- **UI tests** for keyboard flows, mode switching, and history behavior.
- **Performance tests** for large datasets, large matrices, and plot sampling.
- **Regression log:** every bug found becomes a permanent test.

---

## 11. Security and safety

- No `eval`, `new Function`, or dynamic imports from user input.
- Scripts run in a sandbox with step and time limits and no access to host APIs.
- CAS and heavy plotting run in workers with timeouts.
- Validate and cap input size (expression length, dataset size, matrix dimensions).
- Imports (CSV, JSON, programs) are parsed as data and validated, never executed.
- Rendered math (KaTeX) is configured to disable features that could inject HTML or load external resources.
- No network calls from the calculator in this scope.
- Do not log the contents of history or rates to external services.

---

## 12. Performance targets

- The calculator adds no measurable delay to host startup (all heavy code is lazy).
- Basic expression evaluation returns in under 50 ms.
- Graph pan and zoom stay smooth for typical functions.
- CAS and scripts are interruptible, and the UI stays responsive while they run.
- History loads in pages, not all at once.

---

## 13. Risks and decisions to settle early

| Risk or decision | Recommendation |
|---|---|
| CAS quality vs. size | Start with a light engine, document its limits, and keep the wrapper swappable. |
| Parser: own vs. library | Own parser if long-term control matters. Library if speed to first release matters. |
| Float vs. decimal speed | Decimal for money, statistics, and the main evaluator. Floats for plotting and bulk data. |
| Scope creep | Ship Phases 0 to 5 as the first release, then add graphing, matrices, and CAS as updates. |
| Engineering creep | Keep the exclusion list explicit. New tools go through a separate plan. |
| Manual rates being wrong | Show last-updated dates and stale warnings, and store rate snapshots in history. |

---

## 14. Definition of done

- [ ] Host mapping note completed
- [ ] Single registration entry works, including navigation and search
- [ ] Phases 1 to 12 acceptance criteria met
- [ ] Function registry generates in-app help and the docs file
- [ ] Currency works offline with manual rates, rate sets, stale warnings, and import/export
- [ ] All tests pass, including fuzz and reference suites
- [ ] Security checklist reviewed
- [ ] Migrations versioned and tested on existing data
- [ ] Keyboard, accessibility, and theming checks passed
- [ ] Removing the registration entry cleanly removes the calculator from the host

---

## 15. Suggested release plan

1. **Release A:** Phases 0 to 5 (core, scientific, statistics, finance, conversions with manual currency). Covers most daily use.
2. **Release B:** Phases 6 to 7 (graphing, linear algebra, complex numbers).
3. **Release C:** Phases 8 to 10 (CAS, programming, date and time).
4. **Release D:** Phases 11 to 12 (polish and hardening), plus any items deferred along the way.

Phase 11 interface work should start alongside Phase 1 in small steps. It is listed last only because the final polish pass comes after all modules exist.
