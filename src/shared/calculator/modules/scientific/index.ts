import { Decimal, registry } from '../../index'
import { CalcError } from '../../errors'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { gammaFn } from '../statistics'

/** Largest factorial that stays printable: 9,999! is about 35,660 digits. */
const MAX_FACTORIAL = 9_999
/** Largest n accepted by nPr / nCr: the result is estimated from the numbers first. */
const MAX_PERMUTATION_N = 1_000_000
/** Digits allowed in a combinatorics result (nCr(1e6, 5e5) has about 301,000). */
const MAX_COMBINATION_DIGITS = 20_000

function requireInteger(value: Decimal, what: string, min = 0): number {
  if (!value.isInteger()) throw new CalcError(`${what} must be a whole number`)
  if (value.isNegative() || value.lt(min)) throw new CalcError(`${what} cannot be negative`)
  if (value.gt(MAX_PERMUTATION_N)) {
    throw new CalcError(`${what} is limited to ${MAX_PERMUTATION_N.toLocaleString('en-US')}`)
  }
  return value.toNumber()
}

/** Log10 estimate for n! via Stirling, used to refuse enormous results before computing them. */
function log10FactorialApprox(n: number): number {
  if (n < 2) return 0
  return n * Math.log10(n / Math.E) + 0.5 * Math.log10(2 * Math.PI * n)
}

export function factorial(x: Decimal): Decimal {
  // Non-whole factorials use the gamma function: x! = Γ(x + 1), so 3.5! = Γ(4.5) =
  // 11.6317283966 (the same answer Google's calculator gives). Negative whole numbers
  // are poles of gamma and stay an error.
  if (!x.isInteger()) {
    const g = x.toNumber() + 1
    if (!Number.isFinite(g) || g > 171) {
      throw new CalcError(`Factorial is limited to arguments whose gamma fits (got ${x.toString()})`)
    }
    return new Decimal(gammaFn(g))
  }
  if (x.isNegative()) throw new CalcError('Factorial requires a non-negative whole number')
  const n = x.toNumber()
  if (n > MAX_FACTORIAL) {
    throw new CalcError(`Factorial is limited to ${MAX_FACTORIAL.toLocaleString('en-US')}! (got ${x.toString()})`)
  }
  let res = new Decimal(1)
  for (let i = 2; i <= n; i++) res = res.times(i)
  return res
}

export function permutations(n: Decimal, r: Decimal): Decimal {
  const num = requireInteger(n, 'n')
  const k = requireInteger(r, 'r')
  if (k > num) throw new CalcError('r cannot be larger than n')
  if (log10FactorialApprox(num) - log10FactorialApprox(num - k) > MAX_COMBINATION_DIGITS) {
    throw new CalcError(`The result of nPr(${num}, ${k}) is too large to display`)
  }
  let res = new Decimal(1)
  for (let i = 0; i < k; i++) res = res.times(num - i)
  return res
}

export function combinations(n: Decimal, r: Decimal): Decimal {
  const num = requireInteger(n, 'n')
  let k = requireInteger(r, 'r')
  if (k > num) throw new CalcError('r cannot be larger than n')
  if (k > num - k) k = num - k
  // log10 C(n,k) = log10 n! - log10 k! - log10 (n-k)!
  const digits = log10FactorialApprox(num) - log10FactorialApprox(k) - log10FactorialApprox(num - k)
  if (digits > MAX_COMBINATION_DIGITS) {
    throw new CalcError(
      `The result of nCr(${num}, ${k}) has about ${Math.round(digits).toLocaleString('en-US')} digits; ` +
        `results are limited to ${MAX_COMBINATION_DIGITS.toLocaleString('en-US')} digits`
    )
  }
  let res = new Decimal(1)
  for (let i = 1; i <= k; i++) {
    res = res.times(num - i + 1).dividedBy(i)
  }
  return res.toDecimalPlaces(0)
}

export function registerScientificFunctions(): void {
  // Angle conversion helpers
  const toRad = (angle: Decimal, mode: 'deg' | 'rad' | 'grad'): Decimal => {
    if (mode === 'rad') return angle
    if (mode === 'grad') return angle.times(Decimal.acos(-1)).dividedBy(200)
    return angle.times(Decimal.acos(-1)).dividedBy(180)
  }

  const fromRad = (rad: Decimal, mode: 'deg' | 'rad' | 'grad'): Decimal => {
    if (mode === 'rad') return rad
    if (mode === 'grad') return rad.times(200).dividedBy(Decimal.acos(-1))
    return rad.times(180).dividedBy(Decimal.acos(-1))
  }

  const getAngleMode = (scope?: Record<string, Decimal>): 'deg' | 'rad' | 'grad' => {
    const raw = scope?.['__anglemode']
    if (!raw) return 'deg'
    const n = raw.toNumber()
    if (n === 1) return 'rad'
    if (n === 2) return 'grad'
    return 'deg'
  }

  const checkTanSecPole = (angle: Decimal, mode: 'deg' | 'rad' | 'grad', fnName: string) => {
    if (mode === 'deg') {
      const m = angle.abs().modulo(180)
      if (m.equals(90)) throw new CalcError(`${fnName} is undefined at this angle`)
    } else if (mode === 'grad') {
      const m = angle.abs().modulo(200)
      if (m.equals(100)) throw new CalcError(`${fnName} is undefined at this angle`)
    } else {
      if (angle.cos().abs().lt('1e-15')) throw new CalcError(`${fnName} is undefined at this angle`)
    }
  }

  const checkCotCscPole = (angle: Decimal, mode: 'deg' | 'rad' | 'grad', fnName: string) => {
    if (mode === 'deg') {
      const m = angle.abs().modulo(180)
      if (m.isZero()) throw new CalcError(`${fnName} is undefined at this angle`)
    } else if (mode === 'grad') {
      const m = angle.abs().modulo(200)
      if (m.isZero()) throw new CalcError(`${fnName} is undefined at this angle`)
    } else {
      if (angle.sin().abs().lt('1e-15')) throw new CalcError(`${fnName} is undefined at this angle`)
    }
  }

  // Trigonometry
  registry.registerFunction({
    name: 'sin',
    category: 'scientific',
    description: 'Sine of angle',
    examples: ['sin(90)', 'sin(pi/2)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      const rad = toRad(x, mode)
      return rad.sin()
    }
  })

  registry.registerFunction({
    name: 'cos',
    category: 'scientific',
    description: 'Cosine of angle',
    examples: ['cos(0)', 'cos(pi)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      const rad = toRad(x, mode)
      return rad.cos()
    }
  })

  registry.registerFunction({
    name: 'tan',
    category: 'scientific',
    description: 'Tangent of angle',
    examples: ['tan(45)', 'tan(0)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      checkTanSecPole(x, mode, 'tan')
      const rad = toRad(x, mode)
      return rad.tan()
    }
  })

  registry.registerFunction({
    name: 'cot',
    category: 'scientific',
    description: 'Cotangent of angle',
    examples: ['cot(45)', 'cot(90)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      checkCotCscPole(x, mode, 'cot')
      const rad = toRad(x, mode)
      return rad.cos().dividedBy(rad.sin())
    }
  })

  registry.registerFunction({
    name: 'sec',
    category: 'scientific',
    description: 'Secant of angle',
    examples: ['sec(0)', 'sec(60)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      checkTanSecPole(x, mode, 'sec')
      const rad = toRad(x, mode)
      return new Decimal(1).dividedBy(rad.cos())
    }
  })

  registry.registerFunction({
    name: 'csc',
    category: 'scientific',
    description: 'Cosecant of angle',
    examples: ['csc(90)', 'csc(30)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const mode = getAngleMode(scope)
      checkCotCscPole(x, mode, 'csc')
      const rad = toRad(x, mode)
      return new Decimal(1).dividedBy(rad.sin())
    }
  })

  // Inverse trigonometry
  registry.registerFunction({
    name: 'asin',
    aliases: ['arcsin'],
    category: 'scientific',
    description: 'Inverse sine',
    examples: ['asin(1)', 'asin(0.5)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      if (x.abs().greaterThan(1)) throw new Error('asin argument out of range [-1, 1]')
      const rad = x.asin()
      return fromRad(rad, getAngleMode(scope))
    }
  })

  registry.registerFunction({
    name: 'acos',
    aliases: ['arccos'],
    category: 'scientific',
    description: 'Inverse cosine',
    examples: ['acos(1)', 'acos(0)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      if (x.abs().greaterThan(1)) throw new Error('acos argument out of range [-1, 1]')
      const rad = x.acos()
      return fromRad(rad, getAngleMode(scope))
    }
  })

  registry.registerFunction({
    name: 'atan',
    aliases: ['arctan'],
    category: 'scientific',
    description: 'Inverse tangent',
    examples: ['atan(1)', 'atan(0)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x], scope) => {
      const rad = x.atan()
      return fromRad(rad, getAngleMode(scope))
    }
  })

  // Hyperbolic
  registry.registerFunction({
    name: 'sinh',
    category: 'scientific',
    description: 'Hyperbolic sine',
    examples: ['sinh(0)', 'sinh(1)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => x.sinh()
  })

  registry.registerFunction({
    name: 'cosh',
    category: 'scientific',
    description: 'Hyperbolic cosine',
    examples: ['cosh(0)', 'cosh(1)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => x.cosh()
  })

  registry.registerFunction({
    name: 'tanh',
    category: 'scientific',
    description: 'Hyperbolic tangent',
    examples: ['tanh(0)', 'tanh(1)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => x.tanh()
  })

  // Logarithms and exponentials
  registry.registerFunction({
    name: 'ln',
    aliases: ['log'],
    category: 'scientific',
    description: 'Natural logarithm (base e)',
    examples: ['ln(e)', 'ln(1)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => {
      if (!x.isPositive()) throw new Error('Logarithm of non-positive number')
      return x.ln()
    }
  })

  registry.registerFunction({
    name: 'log10',
    category: 'scientific',
    description: 'Common logarithm (base 10)',
    examples: ['log10(100)', 'log10(1000)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => {
      if (!x.isPositive()) throw new Error('Logarithm of non-positive number')
      return x.log(10)
    }
  })

  registry.registerFunction({
    name: 'log2',
    category: 'scientific',
    description: 'Binary logarithm (base 2)',
    examples: ['log2(8)', 'log2(1024)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => {
      if (!x.isPositive()) throw new Error('Logarithm of non-positive number')
      return x.log(2)
    }
  })

  registry.registerFunction({
    name: 'exp',
    category: 'scientific',
    description: 'Exponential e^x',
    examples: ['exp(1)', 'exp(0)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => x.exp()
  })

  // Combinatorics and number theory
  registry.registerFunction({
    name: 'fact',
    aliases: ['factorial'],
    category: 'scientific',
    description: 'Factorial of non-negative integer',
    examples: ['fact(5)', 'fact(0)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => factorial(x)
  })

  // Remainder after division. Sign follows the dividend (the same rule as JS % and
  // most calculators): mod(-10, 3) = -1 and mod(10, -3) = 1. The result has the sign
  // of a, never of b. b = 0 is an error.
  registry.registerFunction({
    name: 'mod',
    category: 'scientific',
    description: 'Remainder after division a mod b (sign follows a)',
    examples: ['mod(10, 3)', 'mod(-10, 3)'],
    minArity: 2,
    maxArity: 2,
    impl: ([a, b]) => {
      if (b.isZero()) throw new CalcError('Division by zero in mod')
      return a.modulo(b)
    }
  })

  // The y-th root of x: yRoot(8, 3) = 2. y = 0 is an error; a negative x with an even y
  // has no real root and is an error too (an odd y keeps the sign, like cbrt(-8) = -2).
  registry.registerFunction({
    name: 'yroot',
    aliases: ['yRoot'],
    category: 'scientific',
    description: 'The y-th root of x (yRoot(x, y))',
    examples: ['yRoot(8, 3)', 'yRoot(16, 4)'],
    minArity: 2,
    maxArity: 2,
    impl: ([x, y]) => {
      if (y.isZero()) throw new CalcError('The 0-th root is undefined')
      if (x.isNegative() && y.modulo(2).isZero()) {
        throw new CalcError('A negative number has no real even root')
      }
      return x.isNegative()
        ? x.abs().pow(new Decimal(1).dividedBy(y)).neg()
        : x.pow(new Decimal(1).dividedBy(y))
    }
  })

  registry.registerFunction({
    name: 'gcd',
    category: 'scientific',
    description: 'Greatest common divisor',
    examples: ['gcd(24, 36)', 'gcd(17, 13)'],
    minArity: 2,
    maxArity: 2,
    impl: ([a, b]) => {
      if (!a.isInteger() || !b.isInteger()) throw new Error('GCD requires integers')
      let x = a.abs()
      let y = b.abs()
      while (!y.isZero()) {
        const t = y
        y = x.modulo(y)
        x = t
      }
      return x
    }
  })

  registry.registerFunction({
    name: 'lcm',
    category: 'scientific',
    description: 'Least common multiple',
    examples: ['lcm(4, 6)', 'lcm(12, 18)'],
    minArity: 2,
    maxArity: 2,
    impl: ([a, b]) => {
      if (!a.isInteger() || !b.isInteger()) throw new Error('LCM requires integers')
      if (a.isZero() || b.isZero()) return new Decimal(0)
      let x = a.abs()
      let y = b.abs()
      const product = x.times(y)
      while (!y.isZero()) {
        const t = y
        y = x.modulo(y)
        x = t
      }
      return product.dividedBy(x)
    }
  })

  registry.registerFunction({
    name: 'nPr',
    aliases: ['perm', 'P'],
    category: 'scientific',
    description: 'Permutations P(n, r)',
    examples: ['nPr(5, 2)', 'nPr(10, 3)'],
    minArity: 2,
    maxArity: 2,
    impl: ([n, r]) => permutations(n, r)
  })

  registry.registerFunction({
    name: 'nCr',
    aliases: ['comb', 'C'],
    category: 'scientific',
    description: 'Combinations C(n, r)',
    examples: ['nCr(5, 2)', 'nCr(10, 3)'],
    minArity: 2,
    maxArity: 2,
    impl: ([n, r]) => combinations(n, r)
  })

  // --- Prime tools: whole numbers 2 and up only, capped so a huge n cannot freeze the app ---
  const requirePrimeInput = (x: Decimal, fnName: string): number => {
    if (!x.isInteger()) throw new CalcError(`${fnName} requires a whole number`)
    if (x.lt(2)) throw new CalcError(`${fnName} requires a whole number of 2 or more (got ${x.toString()})`)
    if (x.gt(CALC_LIMITS.primeNumberLimit)) {
      throw new CalcError(limitMessage('primeNumberLimit', `(got ${x.toString()})`))
    }
    return x.toNumber()
  }

  registry.registerFunction({
    name: 'isprime',
    category: 'scientific',
    description: 'True (1) when n is a prime number, otherwise false (0)',
    examples: ['isprime(7)', 'isprime(60)'],
    minArity: 1,
    maxArity: 1,
    impl: ([x]) => {
      const n = requirePrimeInput(x, 'isprime')
      return isPrimeNumber(n) ? new Decimal(1) : new Decimal(0)
    }
  })

  registry.registerFunction({
    name: 'primefactors',
    category: 'scientific',
    description: 'Prime factorisation of n, shown as 2 x 2 x 3 x 5',
    examples: ['primefactors(60)'],
    minArity: 1,
    maxArity: 1,
    // The numeric value is the product (60); the display shows the factor list.
    impl: ([x]) => {
      const n = requirePrimeInput(x, 'primefactors')
      return new Decimal(primeFactorsOf(n).reduce((a, b) => a * b, 1))
    },
    format: (value) => primeFactorsString(value.toNumber())
  })
}

/** Whole-number primality by trial division up to sqrt(n). */
export function isPrimeNumber(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false
  if (n % 2 === 0) return n === 2
  for (let d = 3; d * d <= n; d += 2) {
    if (n % d === 0) return false
  }
  return true
}

/** Repeated prime factors of n, e.g. [2, 2, 3, 5] for 60. n >= 2. */
export function primeFactorsOf(n: number): number[] {
  const factors: number[] = []
  let rest = n
  for (let d = 2; d * d <= rest; d += d === 2 ? 1 : 2) {
    while (rest % d === 0) {
      factors.push(d)
      rest = Math.floor(rest / d)
    }
  }
  if (rest > 1) factors.push(rest)
  return factors
}

/** Prime factors rendered like `2 x 2 x 3 x 5`. */
export function primeFactorsString(n: number): string {
  return primeFactorsOf(n).join(' x ')
}

registerScientificFunctions()
