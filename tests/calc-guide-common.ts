// Shared test harness for docs/calculator-testing-guide.md tests.
//
// One file per guide section (tests/calc-guide-sectionN.ts) so a module can be
// re-run on its own:  npx tsx tests/calc-guide-section4.ts
//
// Every row of the guide becomes one result with one of four statuses:
//   passed  - the calculator gives the guide's answer
//   failed  - it gives a different answer (a bug report; the expectation is never edited to fit)
//   todo    - the feature does not exist yet, so the row is skipped, not failed
//   skipped - needs a screen, a mouse, a restart or UI timing; listed for manual testing
//
// A failing check never stops the file: the whole section runs and reports at the end.
export interface TestRunResult {
  module: string
  section: string
  name: string
  input: string
  expected: string
  actual?: string
  status: 'passed' | 'failed' | 'todo' | 'skipped'
  note?: string
  guess?: string
}

export class GuideSuite {
  results: TestRunResult[] = []

  constructor(public sectionName: string, public moduleName: string) { }

  pass(name: string, input: string, expected: string, actual?: string) {
    this.results.push({
      module: this.moduleName,
      section: this.sectionName,
      name,
      input,
      expected,
      actual: actual ?? expected,
      status: 'passed'
    })
  }

  fail(name: string, input: string, expected: string, actual: string, guess: string) {
    this.results.push({
      module: this.moduleName,
      section: this.sectionName,
      name,
      input,
      expected,
      actual,
      status: 'failed',
      guess
    })
  }

  todo(name: string, input: string, expected: string, note: string) {
    this.results.push({
      module: this.moduleName,
      section: this.sectionName,
      name,
      input,
      expected,
      status: 'todo',
      note
    })
  }

  skip(name: string, input: string, expected: string, note: string) {
    this.results.push({
      module: this.moduleName,
      section: this.sectionName,
      name,
      input,
      expected,
      status: 'skipped',
      note
    })
  }

  test(name: string, input: string, expected: string, fn: () => void | { actual: string }, guessIfFail?: string) {
    try {
      const res = fn()
      const actualStr = res && res.actual !== undefined ? res.actual : expected
      this.pass(name, input, expected, actualStr)
    } catch (err) {
      // A check may mark its own row as todo / skipped by throwing one of these.
      if (err instanceof GuideTodo) {
        this.todo(name, input, expected, err.note)
        return
      }
      if (err instanceof GuideSkip) {
        this.skip(name, input, expected, err.note)
        return
      }
      const actual = err instanceof GuideMismatch ? err.actual : err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      this.fail(name, input, expected, actual, guessIfFail || 'The calculator returned a different value than the guide.')
    }
  }

  summary() {
    const passed = this.results.filter((r) => r.status === 'passed').length
    const failed = this.results.filter((r) => r.status === 'failed').length
    const todo = this.results.filter((r) => r.status === 'todo').length
    const skipped = this.results.filter((r) => r.status === 'skipped').length
    return { total: this.results.length, passed, failed, todo, skipped }
  }

  /** Print the section report. Returns the number of failures (for the exit code). */
  report(): number {
    const s = this.summary()
    console.log(`\n=== ${this.sectionName} (${this.moduleName}) ===`)
    console.log(`total ${s.total} | passed ${s.passed} | failed ${s.failed} | todo ${s.todo} | skipped ${s.skipped}`)
    for (const r of this.results.filter((x) => x.status === 'failed')) {
      console.log(`  FAIL  ${r.name}`)
      console.log(`        input:    ${r.input}`)
      console.log(`        expected: ${r.expected}`)
      console.log(`        actual:   ${r.actual}`)
      if (r.guess) console.log(`        guess:    ${r.guess}`)
    }
    for (const r of this.results.filter((x) => x.status === 'todo')) {
      console.log(`  TODO  ${r.name} — ${r.note}`)
    }
    for (const r of this.results.filter((x) => x.status === 'skipped')) {
      console.log(`  SKIP  ${r.name} — ${r.note}`)
    }
    return s.failed
  }
}

/** Thrown by a check to report a mismatch with a readable actual value. */
export class GuideMismatch extends Error {
  constructor(public actual: string, message?: string) {
    super(message ?? `expected a different value, got ${actual}`)
    this.name = 'GuideMismatch'
  }
}

/** Thrown by a check when the feature under test does not exist yet. */
export class GuideTodo extends Error {
  constructor(public note: string) {
    super(note)
    this.name = 'GuideTodo'
  }
}

/** Thrown by a check when the row needs a screen, a mouse, a restart or UI timing. */
export class GuideSkip extends Error {
  constructor(public note: string) {
    super(note)
    this.name = 'GuideSkip'
  }
}

// ---------- assertion helpers ----------

/** The exact text the calculator shows. */
export function expectText(actual: string, expected: string): { actual: string } {
  if (actual !== expected) throw new GuideMismatch(actual, `expected "${expected}", got "${actual}"`)
  return { actual }
}

/** A number within `tolerance` of the guide's value (rounding is not a bug). */
export function expectClose(actual: number | string, expected: number, tolerance: number): { actual: string } {
  const n = typeof actual === 'number' ? actual : Number(actual)
  if (!Number.isFinite(n) || Math.abs(n - expected) > tolerance) {
    throw new GuideMismatch(String(actual), `expected ${expected} ± ${tolerance}, got ${actual}`)
  }
  return { actual: String(actual) }
}

/** The text starts with the guide's digits (e.g. "1.41421356..." vs 1.4142135624). */
export function expectStartsWith(actual: string, prefix: string): { actual: string } {
  if (!actual.startsWith(prefix)) throw new GuideMismatch(actual, `expected a value starting "${prefix}", got "${actual}"`)
  return { actual }
}

/** The call must fail with a message matching `pattern` (a clear error, not a crash). */
export function expectError(fn: () => unknown, pattern: RegExp): { actual: string } {
  let value: unknown
  try {
    value = fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!pattern.test(message)) {
      throw new GuideMismatch(`error: ${message}`, `the error message does not match ${pattern}`)
    }
    return { actual: `error: ${message}` }
  }
  throw new GuideMismatch(`no error (returned ${String(value)})`, 'expected an error, but the call succeeded')
}

/** A calculator result that must be an error (never a number shown with confidence). */
export function expectCalcError(result: { error?: string; formatted: string }, pattern: RegExp): { actual: string } {
  if (!result.error) throw new GuideMismatch(result.formatted, 'expected an error, but a value was shown')
  if (!pattern.test(result.error)) {
    throw new GuideMismatch(`error: ${result.error}`, `the error message does not match ${pattern}`)
  }
  return { actual: `error: ${result.error}` }
}

/** A calculator result that must be a value, shown as `expected`. */
export function expectCalc(result: { error?: string; formatted: string }, expected: string): { actual: string } {
  if (result.error) throw new GuideMismatch(`error: ${result.error}`, `expected "${expected}", got an error`)
  return expectText(result.formatted, expected)
}

/** Run a section file's suite and set a non-zero exit code when anything failed. */
export function finish(suite: GuideSuite): void {
  const failed = suite.report()
  if (failed > 0) process.exitCode = 1
}
