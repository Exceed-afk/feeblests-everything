// One throw type for the whole calculator core, plus a dotenv-free place for
// shared error helpers.
//
// Every public function in src/shared/calculator must throw this type and nothing
// else. Raw TypeError / RangeError / "x.isPositive is not a function" must never
// escape to the UI: the panels show err.message for CalcError and say something
// generic for anything else.

/** The only error type the calculator core throws. */
export class CalcError extends Error {
  constructor(message: string, public readonly code: string = 'CALC_ERROR') {
    super(message)
    this.name = 'CalcError'
  }
}

/** Re-throw anything that is not already a CalcError as one, keeping the message readable. */
export function asCalcError(err: unknown, fallback: string): CalcError {
  if (err instanceof CalcError) return err
  const message = err instanceof Error ? err.message : String(err)
  // A message that leaked a JS engine detail is not useful to a user.
  if (/is not a function|Cannot read propert|undefined is not|Maximum call stack|out of memory/i.test(message)) {
    return new CalcError(fallback, 'CALC_INVALID_INPUT')
  }
  return new CalcError(message || fallback, 'CALC_ERROR')
}

/** Wraps an exported function: any throw leaves as a CalcError with a clear message. */
export function calcBoundary<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    try {
      return fn(...args)
    } catch (err) {
      throw asCalcError(err, `${name}: the input could not be used`)
    }
  }
}
