import { Decimal, registry } from '../../index'
import { CalcError } from '../../errors'

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
  if (!x.isInteger() || x.isNegative()) throw new CalcError('Factorial requires a non-negative whole number')
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
      const rad = toRad(x, mode)
      return rad.tan()
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
    aliases: ['perm'],
    category: 'scientific',
    description: 'Permutations P(n, r)',
    examples: ['nPr(5, 2)', 'nPr(10, 3)'],
    minArity: 2,
    maxArity: 2,
    impl: ([n, r]) => permutations(n, r)
  })

  registry.registerFunction({
    name: 'nCr',
    aliases: ['comb'],
    category: 'scientific',
    description: 'Combinations C(n, r)',
    examples: ['nCr(5, 2)', 'nCr(10, 3)'],
    minArity: 2,
    maxArity: 2,
    impl: ([n, r]) => combinations(n, r)
  })
}

registerScientificFunctions()
