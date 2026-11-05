import assert from 'node:assert/strict'
import {
  Complex,
  complexAdd,
  complexSub,
  complexMultiply,
  complexDivide,
  complexAbs,
  complexArg,
  complexPower,
  complexSqrt,
  complexRoots
} from '../src/shared/calculator/modules/complex'
import { Decimal } from '../src/shared/calculator/numeric'

const dec = (n: number | string): Decimal => new Decimal(n)
const close = (actual: Decimal | number, expected: number, tol = 1e-6, label?: string) => {
  const a = typeof actual === 'number' ? actual : actual.toNumber()
  assert.ok(
    Math.abs(a - expected) <= tol,
    `${label || ''} expected ${expected}, got ${a} (diff ${Math.abs(a - expected)})`
  )
}

let checks = 0
const ok = () => { checks++ }

// z1 = 3 + 4i, z2 = 1 - 2i
const z1 = new Complex(dec(3), dec(4))
const z2 = new Complex(dec(1), dec(-2))

// Addition: (3 + 4i) + (1 - 2i) = 4 + 2i
const zAdd = complexAdd(z1, z2)
close(zAdd.re, 4); close(zAdd.im, 2); ok()

// Subtraction: (3 + 4i) - (1 - 2i) = 2 + 6i
const zSub = complexSub(z1, z2)
close(zSub.re, 2); close(zSub.im, 6); ok()

// Multiplication: (3 + 4i)(1 - 2i) = 3 - 6i + 4i - 8i^2 = 3 - 2i + 8 = 11 - 2i
const zMul = complexMultiply(z1, z2)
close(zMul.re, 11); close(zMul.im, -2); ok()

// Division: (3 + 4i) / (1 - 2i)
// (3 + 4i)(1 + 2i) / (1^2 + (-2)^2) = (3 + 6i + 4i - 8) / 5 = (-5 + 10i) / 5 = -1 + 2i
const zDiv = complexDivide(z1, z2)
close(zDiv.re, -1); close(zDiv.im, 2); ok()

// Modulus / Abs: |3 + 4i| = sqrt(3^2 + 4^2) = 5
close(complexAbs(z1), 5, 1e-9); ok()

// Argument / Phase: arg(3 + 4i) = atan2(4, 3) ~ 0.927295 rad
close(complexArg(z1), Math.atan2(4, 3), 1e-6); ok()

// Square root of -1 is i (0 + 1i)
const sqrtNegOne = complexSqrt(new Complex(dec(-1), dec(0)))
close(sqrtNegOne.re, 0, 1e-7); close(sqrtNegOne.im, 1, 1e-7); ok()

// Square root of 3 + 4i is 2 + 1i (since (2+i)^2 = 4 + 4i - 1 = 3 + 4i)
const sqrtZ1 = complexSqrt(z1)
close(sqrtZ1.re, 2, 1e-7); close(sqrtZ1.im, 1, 1e-7); ok()

// nth Roots: 3rd roots of 1 (cube roots of unity: 1, e^(2pi*i/3), e^(4pi*i/3))
const cubeRoots = complexRoots(new Complex(dec(1), dec(0)), 3)
assert.equal(cubeRoots.length, 3); ok()
// Root 0 = 1 + 0i
close(cubeRoots[0].re, 1, 1e-6); close(cubeRoots[0].im, 0, 1e-6); ok()
// Root 1 = -0.5 + sqrt(3)/2 i
close(cubeRoots[1].re, -0.5, 1e-6); close(cubeRoots[1].im, Math.sqrt(3) / 2, 1e-6); ok()
// Root 2 = -0.5 - sqrt(3)/2 i
close(cubeRoots[2].re, -0.5, 1e-6); close(cubeRoots[2].im, -Math.sqrt(3) / 2, 1e-6); ok()

// Polar form conversion: 2 * e^(i * pi/3) = 2*(0.5 + i*sqrt(3)/2) = 1 + sqrt(3)i
const polarZ = Complex.fromPolar(dec(2), dec(Math.PI / 3))
close(polarZ.re, 1, 1e-6); close(polarZ.im, Math.sqrt(3), 1e-6); ok()

console.log(`ok   ${checks} complex numbers tests passed`)
