import { Decimal } from '../../numeric'
import { registry } from '../../registry'
import { CalcError } from '../../errors'
import { toDecimalInput, toIntegerInput, describe } from '../../inputs'

/** Largest degree accepted by complexRoots: returns that many numbers. */
const MAX_ROOT_DEGREE = 1_000

/** Turn anything the API accepts (Decimal, number, numeric string, {re, im}) into a Complex. */
function toComplexInput(value: unknown, what: string): Complex {
  if (value instanceof Complex) {
    assertFiniteComplex(value, what)
    return value
  }
  if (value && typeof value === 'object' && 're' in (value as Record<string, unknown>)) {
    const obj = value as { re: unknown; im?: unknown }
    const z = new Complex(toDecimalInput(obj.re, `${what}.re`), obj.im === undefined ? new Decimal(0) : toDecimalInput(obj.im, `${what}.im`))
    return z
  }
  return new Complex(toDecimalInput(value, what))
}

function assertFiniteComplex(z: Complex, what: string): void {
  if (!(z instanceof Complex)) throw new CalcError(`${what} must be a complex number (got ${describe(z)})`)
  if (!z.re.isFinite() || !z.im.isFinite()) throw new CalcError(`${what} must be finite`)
}

export class Complex {
  constructor(public re: Decimal, public im: Decimal = new Decimal(0)) {
    // The public object is part of the API: a call with plain numbers must work.
    this.re = toDecimalInput(re, 'real part')
    this.im = toDecimalInput(im, 'imaginary part')
  }

  static fromPolar(r: Decimal | string | number, theta: Decimal | string | number): Complex {
    const radius = toDecimalInput(r, 'r')
    const angle = toDecimalInput(theta, 'theta')
    return new Complex(radius.times(angle.cos()), radius.times(angle.sin()))
  }

  toString(precision = 6): string {
    const rStr = this.re.toDecimalPlaces(precision).toString()
    const iAbs = this.im.abs().toDecimalPlaces(precision).toString()

    if (this.im.isZero()) return rStr
    if (this.re.isZero()) {
      return this.im.isNegative() ? `-${iAbs}i` : `${iAbs}i`
    }
    const sign = this.im.isNegative() ? '-' : '+'
    return `${rStr} ${sign} ${iAbs}i`
  }
}

export function complexAdd(a: Complex, b: Complex): Complex {
  const x = toComplexInput(a, 'a')
  const y = toComplexInput(b, 'b')
  return new Complex(x.re.plus(y.re), x.im.plus(y.im))
}

export function complexSub(a: Complex, b: Complex): Complex {
  const x = toComplexInput(a, 'a')
  const y = toComplexInput(b, 'b')
  return new Complex(x.re.minus(y.re), x.im.minus(y.im))
}

export function complexMultiply(a: Complex, b: Complex): Complex {
  const x = toComplexInput(a, 'a')
  const y = toComplexInput(b, 'b')
  // (a.re*b.re - a.im*b.im) + (a.re*b.im + a.im*b.re)i
  return new Complex(
    x.re.times(y.re).minus(x.im.times(y.im)),
    x.re.times(y.im).plus(x.im.times(y.re))
  )
}

export function complexDivide(a: Complex, b: Complex): Complex {
  const x = toComplexInput(a, 'a')
  const y = toComplexInput(b, 'b')
  const denom = y.re.times(y.re).plus(y.im.times(y.im))
  if (denom.isZero()) throw new CalcError('Complex division by zero')

  const realNum = x.re.times(y.re).plus(x.im.times(y.im))
  const imagNum = x.im.times(y.re).minus(x.re.times(y.im))

  return new Complex(realNum.dividedBy(denom), imagNum.dividedBy(denom))
}

export function complexAbs(z: Complex): Decimal {
  const value = toComplexInput(z, 'z')
  return value.re.times(value.re).plus(value.im.times(value.im)).sqrt()
}

export function complexArg(z: Complex): Decimal {
  const value = toComplexInput(z, 'z')
  return new Decimal(Math.atan2(value.im.toNumber(), value.re.toNumber()))
}

export function complexSqrt(z: Complex): Complex {
  const value = toComplexInput(z, 'z')
  const r = complexAbs(value)
  const theta = complexArg(value)
  const sqrtR = r.sqrt()
  const halfTheta = theta.dividedBy(2)
  return Complex.fromPolar(sqrtR, halfTheta)
}

export function complexPower(z: Complex, n: number | string): Complex {
  const value = toComplexInput(z, 'z')
  const exp = toDecimalInput(n, 'n')
  if (!exp.isInteger()) throw new CalcError('The power of a complex number must be a whole number')
  if (exp.abs().gt(10_000)) throw new CalcError('The power of a complex number is limited to 10,000')
  const r = complexAbs(value)
  const theta = complexArg(value)
  const rN = r.pow(exp)
  const thetaN = theta.times(exp)
  return Complex.fromPolar(rN, thetaN)
}

/**
 * Returns the n complex nth-roots of z: w_k = r^(1/n) * e^(i * (theta + 2k*pi)/n)
 */
export function complexRoots(z: Complex, n: number | string): Complex[] {
  const value = toComplexInput(z, 'z')
  const degree = toIntegerInput(n, 'n', { min: 1 })
  if (degree > MAX_ROOT_DEGREE) {
    throw new CalcError(`Root degree is limited to ${MAX_ROOT_DEGREE.toLocaleString('en-US')}`)
  }
  const r = complexAbs(value)
  const theta = complexArg(value).toNumber()
  const rRoot = new Decimal(Math.pow(r.toNumber(), 1 / degree))

  const roots: Complex[] = []
  for (let k = 0; k < degree; k++) {
    const angle = (theta + 2 * Math.PI * k) / degree
    roots.push(Complex.fromPolar(rRoot, new Decimal(angle)))
  }
  return roots
}

export function registerComplexFunctions(): void {
  registry.registerFunction({
    name: 'cabs',
    category: 'matrix',
    description: 'Modulus of complex number (re, im)',
    examples: ['cabs(3, 4)'],
    minArity: 2,
    maxArity: 2,
    impl: ([re, im]) => complexAbs(new Complex(re, im))
  })
}

registerComplexFunctions()
