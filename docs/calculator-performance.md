# Calculator Performance Baseline & Benchmarks

This document records the baseline execution timings for the calculator engine and modules across arithmetic, statistics, linear algebra, graphing, finance, scripting, SQLite history storage/paging, and currency operations.

The performance suite is executed via:

```bash
npm run test:calc-perf
```

---

## Benchmark Environment

- **Date:** 2026-11-05
- **CPU:** 13th Gen Intel(R) Core(TM) i5-1345U (12 cores)
- **OS Platform & Version:** Windows_NT 10.0.26300 (win32, x64)
- **Node.js Version:** v22.23.2

---

## Methodology

- **Warm-up:** 5 unmeasured iterations prior to timing collection.
- **Sample size:** At least 20 measured iterations per benchmark.
- **Metric:** Median execution time (ms), alongside Mean, Min, and Max.
- **Failure threshold:** In accordance with Section 12 of `docs/calculator-build-plan.md`, benchmarks fail only if the median exceeds 3x the plan's stated target (or 3x measured baseline when no target is explicitly specified).

---

## Baseline Performance Results

Run 1 is the original baseline (2026-11-04, before the graph-sampling fast path). Run 2 is the current run (2026-11-05, after the fast path) on the same machine; the machine was less loaded, so non-graph rows also moved. The thresholds enforced by `tests/calc-perf.ts` are the **fixed numbers from the Section 12 target column** (not computed from the run): graphs fail above 5 ms / 50 ms, and the basic-expression budget stays 50 ms.

| Benchmark Case                    | Description & Parameters                          | Section 12 Target | Run 1 Median (ms) | Run 2 Median (ms) | Mean (ms, Run 2) | Status |
| --------------------------------- | ------------------------------------------------- | ----------------- | ----------------- | ----------------- | ---------------- | ------ |
| **Basic Expression**              | `2 + 3 * 4 - sqrt(16)` evaluation                 | < 50 ms           | **0.020**         | **0.022**         | 0.063            | PASS   |
| **10,000-term Expression**        | Flat sum `1+1+1+...` (9,999 terms)                | —                 | **6.962**         | **7.815**         | 7.944            | PASS   |
| **Stats: computeStats**           | 100,000 `Decimal` values                          | —                 | **221.060**       | **156.841**       | 156.131          | PASS   |
| **Stats: percentile**             | 100,000 values, 95th percentile                   | —                 | **129.240**       | **61.795**        | 64.425           | PASS   |
| **Stats: linearRegression**       | 100,000 $(x, y)$ coordinate pairs                 | —                 | **307.547**       | **142.378**       | 147.653          | PASS   |
| **Stats: tTestOneSample**         | 100,000 floating-point numbers                    | —                 | **70.714**        | **34.873**        | 35.885           | PASS   |
| **Matrix Multiply**               | 50x50 `Decimal` matrix multiplication             | —                 | **80.001**        | **35.228**        | 35.531           | PASS   |
| **Matrix Determinant**            | 50x50 Gaussian elimination with pivoting          | —                 | **158.419**       | **54.478**        | 55.241           | PASS   |
| **Matrix Inverse**                | 50x50 Gauss-Jordan with augmented identity        | —                 | **558.651**       | **210.213**       | 211.720          | PASS   |
| **Graph: Default Plot**           | `sin(x)` over $[-10, 10]$ (300 points)            | < 5 ms            | **56.108**        | **0.114**         | 0.144            | PASS   |
| **Graph: Wide Range & Asymptote** | `tan(x)` over $[-50, 50]$ (3,000 points)          | < 50 ms           | **896.968**       | **0.257**         | 0.326            | PASS   |
| **Finance: Amortization**         | 360-row loan schedule (30-year monthly)           | —                 | **4.742**         | **1.752**         | 2.035            | PASS   |
| **Scripting: 5,000 Steps**        | Loop accumulating 2,500 iterations (5,000 steps)  | —                 | **77.950**        | **26.623**        | 26.538           | PASS   |
| **SQLite: Bulk Insert**           | 10,000 history rows in single transaction         | —                 | **76.229**        | **31.504**        | 32.427           | PASS   |
| **SQLite: Page 1 History**        | `LIMIT 50 OFFSET 0` from 10,000 rows              | —                 | **5.413**         | **2.817**         | 3.107            | PASS   |
| **SQLite: Page 100 History**      | `LIMIT 50 OFFSET 4950` from 10,000 rows           | —                 | **12.593**        | **6.620**         | 6.814            | PASS   |
| **Currency: Cross Rates**         | 10,000 conversions through calculated cross rates | —                 | **15.634**        | **5.497**         | 5.662            | PASS   |

---

## Stability Observation

Across both runs:

- Basic expression evaluation is sub-millisecond (~0.02 ms), easily satisfying the < 50 ms budget by a factor of 2,500x.
- Graph sampling uses a float64 fast path (see below): a default 300-point plot runs in ~0.11 ms (was 56 ms) and `tan(x)` over 3,000 points in ~0.26 ms (was ~880 ms), roughly 500x and 3,400x faster. Expressions the float path cannot mirror exactly (user variables, assignments, functions without a float twin such as `fact`, `gcd`, `nCr`, the statistics distributions) automatically fall back to the exact Decimal sampler, which costs ~0.2-0.3 ms per point.
- In the browser harness (`tests/calc-ui.ts`, test 11), the graph panel keeps a median frame time of **16.6 ms** with p95 at 17.6 ms while panning and zooming a default plot — right at the 60 fps (16.7 ms) budget; the sampling cost itself is now negligible inside those frames.
- Linear algebra operations on 50x50 exact Decimal matrices complete in ~35 ms for multiply, ~55 ms for determinant, ~210 ms for inverse in an idle process.
- Large-dataset statistics on 100,000 Decimal values complete in ~35 ms to ~160 ms depending on sort and reduction complexity.
- SQLite paged history queries remain under 15 ms even at page 100 on a 10,000 row table.

---

## Graph Sampling Fast Path (2026-11-05)

Plotting now compiles the parsed expression into a plain float64 JavaScript
closure (`src/shared/calculator/modules/graphing/float-compile.ts`) built by
walking the AST — no dynamic code execution. The closure uses double arithmetic
and `Math` functions, honours the DEG/RAD/GRAD angle mode, and mirrors the exact
evaluator's domain rules (`0^n` with `n < 0`, negative base with fractional
exponent, log/sqrt domain, `asin`/`acos` range become dead points rather than
values).

- Anything the float path cannot mirror exactly — user-defined variables,
  assignments, or a registry function without a float twin (`fact`, `gcd`,
  `nPr`, the statistics distributions, ...) — automatically falls back to the
  original Decimal sampler. Nothing is silently approximated.
- Roots, extrema and every number shown to the user are still computed with the
  exact Decimal evaluator; only the raw sample points for drawing use floats.
- Discontinuity/asymptote detection is unchanged and applies to both paths.

Measured cost per sampled point: ~0.0004 ms on the float path vs ~0.2-0.3 ms on
the Decimal path.
