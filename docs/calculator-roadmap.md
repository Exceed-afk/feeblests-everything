# Calculator: Roadmap

What the all-in-one calculator does not do yet, what is broken, and what to build next.
Replaces `calculator-known-limitations.md` (checked against the code on 2026-11-05).

Nothing here is a wall. Every item is either a **bug** (fix it), **not built yet** (build it), or a
**deliberate cap** (a number in `src/shared/calculator/limits.ts` that you can change on purpose).

Legend: [ ] to do, [x] done, [?] needs checking first

---

## 1. Known bugs and missing basics (do these first)

Found by hand-testing the expression bar and keypad on 2026-11-05.

- [x] **`%` does nothing.** Typing `%` is not accepted. Done 2026-11-05: Wanted: `50%` = 0.5, `200 + 10%` = 220,
      `200 - 10%` = 180, `50 * 10%` = 5 (same as Google's calculator).
- [x] **`2..3` returns an answer.** Done 2026-11-05 (tokenizer). It should be an error ("Invalid number"). Same for `1.2.3`.
      The number reader must reject more than one `.` in a number.
- [x] **`Ans` and chaining don't work.** Done 2026-11-05: `5 + 5 =` gives 10, then pressing `*` should start the
      next expression with 10 (`10 * 2 = 20`). Right now it becomes `5 + 5 * 2`. Also add an
      `Ans` key and `ans` in expressions, holding the last result.
- [x] **No delete (backspace) button.** Done 2026-11-05 (`⌫` key; the bar's own Backspace key already deleted characters, and `C` still clears all). Only `C` (clear all) exists. Add a backspace button that
      removes the last character, and make the Backspace key work too.
- [x] **No `e` button.** Done 2026-11-05 (on the main keypad). The constant `e` already exists in the engine, so only the keypad button
      is missing.
- [x] **`mod(a, b)` is missing.** The remainder after division: `mod(10, 3)` = 1. Done 2026-11-05:
      the sign follows the dividend (`mod(-10, 3)` = -1, `mod(10, -3)` = 1, like JS `%`), and
      `b = 0` is an error ("Division by zero in mod").
- [x] **No prime tools.** Done 2026-11-05: `isprime(n)` (1/0) and `primefactors(n)` (displayed like
      `2 x 2 x 3 x 5`), whole numbers 2 and up only, with the `primeNumberLimit` = 10,000,000,000
      cap in `limits.ts` so a huge number cannot freeze the app.
- [x] **`C(10, 0)`.** Checked 2026-11-05: `nCr(10, 0)` = 1, so `C(n, r)` and `P(n, r)` were added
      as aliases of `nCr` / `nPr`.
- [x] **`3.5! = 11.6317283966`.** Checked 2026-11-05: Γ(4.5) = 11.631728396567, so `x!` now uses
      the gamma function for non-whole x. BEHAVIOUR CHANGE: `3.5!` used to error, now it returns
      11.6317283966; negative whole numbers (`(-1)!`) stay an error.

## 2. Keypad parity with Google's calculator

The current keypad is a small subset. Google's has these, in this order of usefulness:

- [x] `Deg` / `Rad` toggle on the keypad — the DEG/RAD/GRAD toolbar segment is shown in Basic and
      Scientific mode, with an `Inv` toggle beside it in Scientific mode
- [x] `Inv` key that flips `sin`, `cos`, `tan` to `asin`, `acos`, `atan`, and `ln` / `log` to `e^x` / `10^x`
- [x] `x!`, `%`, backspace, `Ans`, `EXP` — `x!` inserts `!`, `%` the postfix percent, `⌫` deletes one
      character, `Ans` inserts `ans`, and `EXP` inserts `e` (the `1e3`-style exponent marker)
- [x] `sqrt` and `x^y`, plus `x^2` and `y-th root of x` (the function is `yRoot(x, y)`)
- [x] `ln`, `log`, `e`, `pi` (ln/log10 keys existed; `e` and `pi` are now on the main keypad too)
- [x] History button (history storage already exists) — already present in the toolbar
- [ ] `Rnd` (random number). Optional: the script sandbox is deliberately deterministic, so only allow it in the bar.

## 3. Next to build (no new dependencies)

| Item | Why it's easy |
| --- | --- |
| [x] **Currency syntax in the bar** (`100 USD to EUR`) — done 2026-11-06: `to` and `in` both work, codes are case-insensitive, the conversion runs through `performCurrencyConversion` (the Convert panel's own code) with the active rate set. |
| **Call panel functions from the bar** | Mostly adding entries to the function registry. |
| **Countdowns** (days and hours until a date) | Small addition to the Date/Time panel. |
| **Auto-fit / reset view button** on the graph | Zoom and pan already exist. |
| **Per-function show/hide toggle** on the graph | Colours are already assigned. |
| **Named time zones** (`Europe/Berlin`) | The built-in `Intl.DateTimeFormat` knows the zones and DST, so no library is needed. |
| **Holiday-aware business days** | Add a user-entered holiday list to `businessDaysBetween` / `addBusinessDays`. |
| [x] **Quadratic regression** — done 2026-11-06: `quadraticRegression` in the statistics module (x shifted by its mean for large-x stability), in the Stats panel and the function reference. |
| **Confidence intervals** (interval + level) | Built from the t/z tests that already exist. |
| **Custom functions in the bar** (`f(x) = ...`) | Needs a small store of user-defined functions. |
| [x] **Graph: intersection finder** — done 2026-11-06: `findIntersections` (sign changes + bisection, discontinuity guard, tangencies via the extrema finder), markers on the plot and a list. |

## 4. Later (bigger maths)

- [ ] Roots of polynomials above degree 3 (numeric method such as Durand-Kerner)
- [ ] CAS: expand and factor, integrals of trig / exponential / log, systems of equations
- [ ] Eigenvectors and n x n eigenvalues
- [ ] LU, QR, SVD and Cholesky decompositions
- [ ] Implicit graphs (`x^2 + y^2 = 25`) and inequality shading
- [ ] 3D surfaces (biggest job, do last)
- [ ] Rate history chart for currencies

## 5. Needs permission first

- [x] **KaTeX rendered math output.** Done 2026-11-06 with your approval: `katex` 0.19.1 (MIT),
      bundled locally (CSS + fonts), `trust: false`, plain text as the fallback. LaTeX copy-out still works.

## 6. Deliberate caps (change on purpose, never by accident)

All live in `src/shared/calculator/limits.ts`. They stop the app freezing on huge input. Raise one
only with a test and a timing check.

- Matrix size 50 x 50
- Script steps 100,000 and 5 s wall-clock time limit (CAS too)
- Expression length 20,000 characters, nesting depth 200
- Dataset 100,000 values
- Graph sampling 10,000 points

## 7. Out of scope on purpose

- Live exchange rates, update checks or any network access (the app stays local-only)
- `eval` / `new Function` (scripts run in the app's own interpreter)
- Engineering calculators and unit systems
- Exam-approved certification
- Scripts reading the date or random numbers (keeps scripts predictable)
