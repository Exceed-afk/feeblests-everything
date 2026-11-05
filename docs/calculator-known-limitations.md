# Calculator: Known Limitations

An honest list of what the all-in-one calculator (Phase 12) does **not** do, checked against the
build plan (`docs/calculator-build-plan.md`) and the code on 2026-11-05. Each item says whether it
is planned, deferred or out of scope. Nothing here is a bug — these are gaps or deliberate
exclusions.

## Graphing

| Not built                                             | Plan reference                                       | Status                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Implicit graphs** (`x² + y² = 25`)                  | Phase 6 lists implicit as "optional"                 | Deferred (plan marks it optional; no code exists).                                                                      |
| **Inequality shading** (`y < x²`)                     | Phase 6 lists inequalities as "optional"             | Deferred (same).                                                                                                        |
| **3D surfaces**                                       | Phase 6: "3D surfaces last, and only if time allows" | Out of scope for this release; not built.                                                                               |
| **Intersection finder** between two plotted functions | Phase 6 lists intersections among finders            | Not built — roots and local extrema per function exist, intersections do not. Deferred.                                 |
| **Auto-scale / reset view button**                    | Phase 6 lists auto-scale                             | Partial: zoom and pan exist; an explicit auto-fit control is not in the panel. Deferred.                                |
| **Per-function visibility toggles / colours**         | Phase 6                                              | Functions get theme-derived colours automatically; a user-facing visibility toggle per function is not built. Deferred. |

## Linear algebra

| Not built                                     | Plan reference                                               | Status                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Eigenvectors** (and eigenvalues beyond 2×2) | Phase 7                                                      | Deferred: `eigenvalues2x2` exists (2×2 only, real eigenvalues); no eigenvector computation, no n×n eigenvalues.           |
| **Decompositions** (LU, QR, SVD, Cholesky)    | Phase 7: "basic decompositions if the library supports them" | Out of scope — the core is own-code (no math.js), and these were not implemented.                                         |
| **Matrices above 50×50**                      | Limits, not the plan                                         | By design: `CALC_LIMITS.matrixDimension = 50` (`src/shared/calculator/limits.ts`). Hard cap, not planned to lift.         |
| Polynomial roots beyond degree 3              | Phase 7 lists "polynomial roots"                             | Partial: `polynomialRootsReal` covers cubics (Cardano) and lower; higher-degree real-root finding is not built. Deferred. |

## CAS

| Not built                                                          | Plan reference                                                  | Status                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Expand and factor**                                              | Phase 8 lists "simplify, expand, factor, substitute"            | Deferred: the CAS panel offers simplify, differentiate, integrate (polynomials), limit, substitute, solve-linear, Taylor. Expand/factor are not implemented. |
| **Indefinite integration of non-polynomials**                      | Phase 8 "integrals (definite and indefinite)"                   | Partial: `casIntegratePolynomial` handles polynomials only. Trig/exponential/log integrals are not built. Deferred.                                          |
| **Systems of equations** (symbolic, more than one linear equation) | Phase 8 "solve equations and systems"                           | Deferred: only single linear equations in one variable (`casSolveLinear`).                                                                                   |
| **Rendered math notation in CAS results**                          | Phase 8 "show results in rendered math notation"                | Deferred (see KaTeX below). CAS output is plain text.                                                                                                        |
| CAS beyond a light engine                                          | Plan §13 risk: "start with a light engine, document its limits" | By design. Taylor series are truncated polynomials around 0; limits are evaluated by substitution (no one-sided/infinite limits). Deferred indefinitely.     |

## Interface / display

| Not built                                                          | Plan reference                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KaTeX rendered math output** for results, history and CAS        | Phase 11, §5 (KaTeX), §11                       | **Out of scope for this release**: no rendering library was added; the app's no-new-dependencies convention held. Results display as formatted text; LaTeX is available only as copy-out (`toLatexResult`).                                                                                                                                                                                                                                                                                          |
| **Functions only available in panels, not in the expression bar**  | Registry-driven UI (§4)                         | By design, but worth knowing: the expression bar registers only ~60 functions (core, scientific, statistics distributions, `pmt/pv/fv/nper/npv/irr/compound`, `dot`, `cabs`). **Not callable from the bar**: unit conversions, number-base conversion, matrix operations beyond `dot`, CAS operations, date arithmetic, bitwise/script tools, amortization, TVM solving for `rate`, position sizing. They live in their panels. Deferred (registry entries for these would be a natural later step). |
| **Adjustable keypad layout**                                       | Phase 11 "adjustable keypad layout"             | Not built. Deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Statistics and finance dataset input inside the expression bar** | Phase 3 dataset entry                           | Datasets are typed/imported in the Statistics panel; the bar takes `mean(1,2,3)` style lists only. Deferred.                                                                                                                                                                                                                                                                                                                                                                                         |
| Copy as plain number only when it is one                           | Phase 11 "copy as text, LaTeX, or plain number" | Built for results (text + LaTeX). No third "raw decimal" toggle. Deferred/trivial.                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Currency

| Not built                                                                                                                                                      | Plan reference                       | Status                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Currency syntax in the expression bar** (`100 USD to EUR`)                                                                                                   | §7 "Use in expressions"              | **Not built.** Currency conversion lives entirely in the Convert panel (offline rates, overrides, rate sets). Deferred — this was explicitly a plan item and is the most likely next addition. |
| **Live exchange rates**                                                                                                                                        | §7 future extension, §1 out of scope | Out of scope by design (local-only app; the `RateProvider` seam exists but only `ManualRateProvider` is implemented).                                                                          |
| **Rate history with a chart**                                                                                                                                  | §7 "Rate history (optional)"         | Not built (optional plan item). Deferred.                                                                                                                                                      |
| **Currency codes are free text (3–5 chars)** — but there is **no currency-list validation against ISO** or duplicate-name warnings beyond unique codes per set | §7 rules                             | Working as designed; noted so nobody expects ISO validation.                                                                                                                                   |

## Date and time

| Not built                                       | Plan reference                       | Status                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Countdowns** (days/hours until a future date) | Phase 10 "countdowns"                | **Not built.** The Date/Time panel has difference, add/subtract, age, duration arithmetic and time-zone shift — no countdown display. Deferred.                            |
| Named time zones (`Europe/Berlin`)              | Phase 10 "time zone conversion"      | Partial: fixed numeric UTC-offset shifts only (`timeZoneConvert(date, fromOffset, toOffset)`, offsets capped at ±14 h). No IANA zone database, no DST awareness. Deferred. |
| Holiday-aware business days                     | Phase 10 "business-day calculations" | Partial: Mon–Fri only (`businessDaysBetween`, `addBusinessDays`). No holiday calendars. Deferred.                                                                          |

## Scripting / programming

| Not built                                                                                  | Plan reference | Status                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom functions defined in the expression language** (`f(x) = …` callable from the bar) | Phase 9        | Deferred: saved programs run in the Programming panel's interpreter; you cannot define a function in the bar and use it later.              |
| Script access to dates/randomness                                                          | —              | Out of scope by design: the sandbox exposes arithmetic and its own builtins only (no `Date.now`, no `Math.random` — deterministic scripts). |

## Security & scope boundaries (deliberate, not gaps)

- No network access anywhere in the calculator, ever (no live rates, no update checks).
- No `eval`/`new Function`; scripts run in the own interpreter with the `CALC_LIMITS.scriptSteps`
  cap (100,000) that callers cannot raise, plus a 5 s wall-clock limit.
- Imports (CSV/JSON/programs) are parsed as data, validated, and never executed.
- Engineering calculators and engineering unit systems remain out of scope (plan §1).
- Exam-approved certification is out of scope (plan §1).
- Expression length 20,000 chars, nesting depth 200, dataset 100,000 values, graph sampling
  10,000 points, CAS/scripts 5 s — all hard caps in `src/shared/calculator/limits.ts`.

## Statistics

| Not built                                                                                                                                    | Plan reference                                                   | Status                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Quadratic regression**                                                                                                                     | Phase 3 lists linear, quadratic, exponential, logarithmic, power | Deferred: linear, exponential, logarithmic and power regressions exist; quadratic does not.                             |
| Confidence intervals as a distinct tool                                                                                                      | Phase 3 "hypothesis tests and confidence intervals"              | Partial: t/z tests exist and report means/differences; a dedicated CI output (interval + level) is not built. Deferred. |
| `stats_boxplot` / `stats_scatter_r2` are registry functions, but the plots themselves are panel-drawn SVG — the bar only returns the numbers | §4 registry UI                                                   | Working as designed; noted so nobody expects `stats_boxplot(...)` to draw.                                              |

## Where things stand overall

Everything in plan Releases A–C (Phases 0–10) is built except the items above; Phase 11's KaTeX
and keypad-layout items are the main polish gaps, and Phase 12 (hardening: fuzz, perf, security
review, generated docs, migrations) is complete. The single biggest _functional_ gap versus the
plan is currency syntax in the expression bar (`100 USD to EUR`).
