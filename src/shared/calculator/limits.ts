// Input limits for the calculator core (docs/calculator-build-plan.md, section 11).
//
// Every limit is a hard cap enforced BEFORE the work starts, so a hostile or accidental
// input is rejected with a message that names the limit instead of hanging the UI or
// dying on a stack overflow. The values were chosen from measurements on this machine:
//
//   - A flat 10,001-term sum (numbers + operators, no nesting) evaluated in 3.7 ms, and
//     parsing it is linear in length, so 10,000 characters is a real ceiling for typing
//     but not a burden on the engine. Anything longer is not something a person types.
//   - Each parenthesis level costs a few parser/evaluator frames. 200 levels is far past
//     any formula (the deepest realistic ones are ~20), while staying well inside the
//     default JS stack even with the evaluator's own frames on top.
//   - Statistics run in exact decimal, so cost grows with the dataset. 100,000 values is
//     already more than a spreadsheet column; the 50,000-value requirement with time to
//     spare is the reason it is not lower.
//   - A 50x50 matrix is more than anyone types by hand, and Gauss-Jordan on 50x50 exact
//     decimals finishes in well under a second. Bigger matrices belong in a different tool.
//   - A script is a program, not an expression: 20,000 characters holds a few hundred
//     lines, which is the point where the step cap, not the size, becomes the limit.
//   - the script step cap cannot be raised by callers: it is the sandbox's guarantee
//     that a loop cannot freeze the UI.
//   - The exponent cap follows from arbitrary-precision arithmetic: 10^100000 has 100,001
//     digits and is quick, 10^999999999 has a billion and is not. The magnitude cap bounds
//     results that grow through factorials and exponents.

export const CALC_LIMITS = {
  /** Longest accepted expression, in characters (input bar and `toDecimalString`). */
  expressionLength: 20_000,
  /** Deepest parenthesis / clause nesting the parser and evaluator accept. */
  nestingDepth: 200,
  /** Values in one statistics dataset. */
  datasetSize: 100_000,
  /** Rows or columns in a matrix. */
  matrixDimension: 50,
  /** Values in one vector (dot product, norms). */
  vectorLength: 10_000,
  /** Characters in a script program. */
  scriptLength: 20_000,
  /** Statements/iterations a script may execute. Callers cannot raise this. */
  scriptSteps: 100_000,
  /** Characters in a CAS expression (larger than plain expressions: it is edited as text). */
  casExpressionLength: 20_000,
  /** Points requested for one graph plot. */
  graphSampleCount: 10_000,
  /** Decimal exponent magnitude of any intermediate number (|x| < 10^exponentLimit). */
  exponentLimit: 100_000,
  /** Decimal places accepted by rounding helpers. */
  maxRoundingPlaces: 1000,
  /**
   * Largest whole number accepted by isprime / primefactors. Trial division runs in
   * O(sqrt(n)) decimal-precision steps, so 10^10 is about 100,000 divisions (a few
   * milliseconds) while anything near 2^53 would take minutes. Prime factorisation of
   * semiprimes near the cap is the slowest accepted case by design.
   */
  primeNumberLimit: 10_000_000_000
} as const

export type CalcLimitName = keyof typeof CALC_LIMITS

/** Human-readable names used in limit messages: "statistics dataset is limited to 100000 values". */
const LABELS: Record<CalcLimitName, string> = {
  expressionLength: 'expression length',
  nestingDepth: 'nesting depth',
  datasetSize: 'dataset size',
  matrixDimension: 'matrix size',
  vectorLength: 'vector length',
  scriptLength: 'script length',
  scriptSteps: 'script steps',
  casExpressionLength: 'expression length',
  graphSampleCount: 'graph sample count',
  exponentLimit: 'number magnitude',
  maxRoundingPlaces: 'decimal places',
  primeNumberLimit: 'prime number'
}

export function limitMessage(limit: CalcLimitName, detail?: string): string {
  const value = CALC_LIMITS[limit]
  const label = LABELS[limit]
  return `${label} is limited to ${value.toLocaleString('en-US')}${detail ? ` ${detail}` : ''}`
}
