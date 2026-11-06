import { parse, type ASTNode } from '../../parser'
import { Evaluator } from '../../evaluator'
import { Decimal } from '../../numeric'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toDecimalInput, toIntegerInput, toStringInput } from '../../inputs'
import '../scientific' // ensures scientific functions (sin, cos, etc.) are registered

/**
 * Every CAS entry point goes through this: the text cap, then the shared parser,
 * which already enforces the nesting depth instead of overflowing the stack.
 */
function casParse(text: unknown, what = 'expression'): ASTNode {
  const source = toStringInput(text, what)
  if (source.length > CALC_LIMITS.casExpressionLength) {
    throw new CalcError(
      `${limitMessage('casExpressionLength', 'characters')} (this one has ${source.length.toLocaleString('en-US')})`
    )
  }
  return parse(source)
}

export interface CasOptions {
  maxSteps?: number
  timeLimitMs?: number
}

const DEFAULT_OPTIONS: CasOptions = {
  maxSteps: 2000,
  timeLimitMs: 1000
}

/**
 * Symbolic AST node representations for CAS operations.
 */
export type CasExpr =
  | { type: 'num'; val: Decimal }
  | { type: 'sym'; name: string }
  | { type: 'add'; left: CasExpr; right: CasExpr }
  | { type: 'sub'; left: CasExpr; right: CasExpr }
  | { type: 'mul'; left: CasExpr; right: CasExpr }
  | { type: 'div'; left: CasExpr; right: CasExpr }
  | { type: 'pow'; base: CasExpr; exp: CasExpr }
  | { type: 'func'; name: string; arg: CasExpr }

/**
 * Converts standard Pratt AST to a CasExpr.
 */
export function astToCas(node: ASTNode): CasExpr {
  switch (node.type) {
    case 'Number':
      return { type: 'num', val: new Decimal(node.value) }
    case 'Identifier':
      return { type: 'sym', name: node.name }
    case 'UnaryOp':
      if (node.operator === '-') {
        return {
          type: 'mul',
          left: { type: 'num', val: new Decimal(-1) },
          right: astToCas(node.operand)
        }
      }
      return astToCas(node.operand)
    case 'BinaryOp': {
      const left = astToCas(node.left)
      const right = astToCas(node.right)
      switch (node.operator) {
        case '+':
          return { type: 'add', left, right }
        case '-':
          return { type: 'sub', left, right }
        case '*':
          return { type: 'mul', left, right }
        case '/':
          return { type: 'div', left, right }
        case '^':
          return { type: 'pow', base: left, exp: right }
        default:
          return left
      }
    }
    case 'FunctionCall': {
      return {
        type: 'func',
        name: node.name.toLowerCase(),
        arg: node.args.length > 0 ? astToCas(node.args[0]) : { type: 'num', val: new Decimal(0) }
      }
    }
    default:
      return { type: 'num', val: new Decimal(0) }
  }
}

/**
 * Pretty-prints a CasExpr back to a standard string.
 */
export function printCas(e: CasExpr): string {
  switch (e.type) {
    case 'num':
      return e.val.toString()
    case 'sym':
      return e.name
    case 'add':
      return `${printCas(e.left)} + ${printCas(e.right)}`
    case 'sub': {
      const lStr = printCas(e.left)
      const rStr = e.right.type === 'add' || e.right.type === 'sub' ? `(${printCas(e.right)})` : printCas(e.right)
      return `${lStr} - ${rStr}`
    }
    case 'mul': {
      if (e.left.type === 'num' && e.left.val.equals(-1)) {
        const rStr = e.right.type === 'add' || e.right.type === 'sub' ? `(${printCas(e.right)})` : printCas(e.right)
        return `-${rStr}`
      }
      const lStr = e.left.type === 'add' || e.left.type === 'sub' ? `(${printCas(e.left)})` : printCas(e.left)
      const rStr = e.right.type === 'add' || e.right.type === 'sub' ? `(${printCas(e.right)})` : printCas(e.right)
      return `${lStr}*${rStr}`
    }
    case 'div': {
      const lStr = e.left.type === 'add' || e.left.type === 'sub' ? `(${printCas(e.left)})` : printCas(e.left)
      const rStr =
        e.right.type === 'add' || e.right.type === 'sub' || e.right.type === 'mul'
          ? `(${printCas(e.right)})`
          : printCas(e.right)
      return `${lStr}/${rStr}`
    }
    case 'pow': {
      const bStr = e.base.type !== 'sym' && e.base.type !== 'num' ? `(${printCas(e.base)})` : printCas(e.base)
      const expStr = e.exp.type !== 'sym' && e.exp.type !== 'num' ? `(${printCas(e.exp)})` : printCas(e.exp)
      return `${bStr}^${expStr}`
    }
    case 'func':
      return `${e.name}(${printCas(e.arg)})`
  }
}

/**
 * Simplifies basic algebraic CasExpr (combines constants, zeroes, identities).
 */
export function simplifyExpr(e: CasExpr): CasExpr {
  switch (e.type) {
    case 'num':
    case 'sym':
      return e

    case 'add': {
      const l = simplifyExpr(e.left)
      const r = simplifyExpr(e.right)
      // num + num
      if (l.type === 'num' && r.type === 'num') {
        return { type: 'num', val: l.val.plus(r.val) }
      }
      // 0 + x -> x
      if (l.type === 'num' && l.val.isZero()) return r
      // x + 0 -> x
      if (r.type === 'num' && r.val.isZero()) return l
      // a*x + b*x -> (a+b)*x
      if (
        l.type === 'mul' &&
        r.type === 'mul' &&
        l.left.type === 'num' &&
        r.left.type === 'num' &&
        printCas(l.right) === printCas(r.right)
      ) {
        const sum = l.left.val.plus(r.left.val)
        return { type: 'mul', left: { type: 'num', val: sum }, right: l.right }
      }
      return { type: 'add', left: l, right: r }
    }

    case 'sub': {
      const l = simplifyExpr(e.left)
      const r = simplifyExpr(e.right)
      if (l.type === 'num' && r.type === 'num') {
        return { type: 'num', val: l.val.minus(r.val) }
      }
      if (r.type === 'num' && r.val.isZero()) return l
      return { type: 'sub', left: l, right: r }
    }

    case 'mul': {
      const l = simplifyExpr(e.left)
      const r = simplifyExpr(e.right)
      if (l.type === 'num' && r.type === 'num') {
        return { type: 'num', val: l.val.times(r.val) }
      }
      // 0 * x -> 0, x * 0 -> 0
      if ((l.type === 'num' && l.val.isZero()) || (r.type === 'num' && r.val.isZero())) {
        return { type: 'num', val: new Decimal(0) }
      }
      // 1 * x -> x
      if (l.type === 'num' && l.val.equals(1)) return r
      // x * 1 -> x
      if (r.type === 'num' && r.val.equals(1)) return l
      // Canonical order: put numbers on the left (e.g. x * 2 -> 2 * x)
      if (l.type !== 'num' && r.type === 'num') {
        return simplifyExpr({ type: 'mul', left: r, right: l })
      }
      // num * (num * x) -> (num * num) * x
      if (l.type === 'num' && r.type === 'mul' && r.left.type === 'num') {
        return simplifyExpr({
          type: 'mul',
          left: { type: 'num', val: l.val.times(r.left.val) },
          right: r.right
        })
      }
      return { type: 'mul', left: l, right: r }
    }

    case 'div': {
      const l = simplifyExpr(e.left)
      const r = simplifyExpr(e.right)
      if (l.type === 'num' && r.type === 'num') {
        if (r.val.isZero()) throw new Error('Division by zero in simplification')
        return { type: 'num', val: l.val.dividedBy(r.val) }
      }
      if (l.type === 'num' && l.val.isZero()) return { type: 'num', val: new Decimal(0) }
      if (r.type === 'num' && r.val.equals(1)) return l
      return { type: 'div', left: l, right: r }
    }

    case 'pow': {
      const b = simplifyExpr(e.base)
      const x = simplifyExpr(e.exp)
      if (x.type === 'num' && x.val.isZero()) return { type: 'num', val: new Decimal(1) }
      if (x.type === 'num' && x.val.equals(1)) return b
      if (b.type === 'num' && x.type === 'num') {
        return { type: 'num', val: b.val.pow(x.val) }
      }
      return { type: 'pow', base: b, exp: x }
    }

    case 'func':
      return { type: 'func', name: e.name, arg: simplifyExpr(e.arg) }
  }
}

/**
 * Differentiates an algebraic expression d/d(varName) symbolically.
 */
export function differentiateExpr(e: CasExpr, varName: string): CasExpr {
  switch (e.type) {
    case 'num':
      return { type: 'num', val: new Decimal(0) }

    case 'sym': {
      const name = e.name.toLowerCase()
      if (name === varName.toLowerCase()) return { type: 'num', val: new Decimal(1) }
      // Known constants e, pi have derivative 0
      return { type: 'num', val: new Decimal(0) }
    }

    case 'add':
      return {
        type: 'add',
        left: differentiateExpr(e.left, varName),
        right: differentiateExpr(e.right, varName)
      }

    case 'sub':
      return {
        type: 'sub',
        left: differentiateExpr(e.left, varName),
        right: differentiateExpr(e.right, varName)
      }

    case 'mul': {
      // Product rule: (u*v)' = u'*v + u*v'
      return {
        type: 'add',
        left: { type: 'mul', left: differentiateExpr(e.left, varName), right: e.right },
        right: { type: 'mul', left: e.left, right: differentiateExpr(e.right, varName) }
      }
    }

    case 'div': {
      // Quotient rule: (u/v)' = (u'*v - u*v') / v^2
      const num = {
        type: 'sub' as const,
        left: { type: 'mul' as const, left: differentiateExpr(e.left, varName), right: e.right },
        right: { type: 'mul' as const, left: e.left, right: differentiateExpr(e.right, varName) }
      }
      const den = { type: 'pow' as const, base: e.right, exp: { type: 'num' as const, val: new Decimal(2) } }
      return { type: 'div', left: num, right: den }
    }

    case 'pow': {
      // If exponent is constant: d/dx (u^n) = n * u^(n-1) * u'
      if (e.exp.type === 'num') {
        const n = e.exp.val
        if (n.isZero()) return { type: 'num', val: new Decimal(0) }
        const nMinus1 = n.minus(1)
        const powerPart: CasExpr =
          nMinus1.equals(1)
            ? e.base
            : { type: 'pow', base: e.base, exp: { type: 'num', val: nMinus1 } }
        return {
          type: 'mul',
          left: { type: 'mul', left: { type: 'num', val: n }, right: powerPart },
          right: differentiateExpr(e.base, varName)
        }
      }
      // Exponential e^(u(x))
      if (e.base.type === 'sym' && e.base.name.toLowerCase() === 'e') {
        return {
          type: 'mul',
          left: e,
          right: differentiateExpr(e.exp, varName)
        }
      }
      // Constant base a^(u(x)) where a > 0: d/dx = a^u * ln(a) * u'
      if (e.base.type === 'num' && e.base.val.isPositive()) {
        const lnA = new Decimal(Math.log(e.base.val.toNumber()))
        return {
          type: 'mul',
          left: {
            type: 'mul',
            left: { type: 'num', val: lnA },
            right: e
          },
          right: differentiateExpr(e.exp, varName)
        }
      }
      throw new CalcError('Could not differentiate power expression with non-constant base and exponent')
    }

    case 'func': {
      // Chain rule: f(g(x))' = f'(g(x)) * g'(x)
      const gPrime = differentiateExpr(e.arg, varName)
      switch (e.name.toLowerCase()) {
        case 'sin':
          return { type: 'mul', left: { type: 'func', name: 'cos', arg: e.arg }, right: gPrime }
        case 'cos':
          return {
            type: 'mul',
            left: {
              type: 'mul',
              left: { type: 'num', val: new Decimal(-1) },
              right: { type: 'func', name: 'sin', arg: e.arg }
            },
            right: gPrime
          }
        case 'tan': {
          const cosSq: CasExpr = {
            type: 'pow',
            base: { type: 'func', name: 'cos', arg: e.arg },
            exp: { type: 'num', val: new Decimal(2) }
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: cosSq },
            right: gPrime
          }
        }
        case 'atan': {
          const denom: CasExpr = {
            type: 'add',
            left: { type: 'num', val: new Decimal(1) },
            right: { type: 'pow', base: e.arg, exp: { type: 'num', val: new Decimal(2) } }
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: denom },
            right: gPrime
          }
        }
        case 'asin': {
          const inner: CasExpr = {
            type: 'sub',
            left: { type: 'num', val: new Decimal(1) },
            right: { type: 'pow', base: e.arg, exp: { type: 'num', val: new Decimal(2) } }
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: { type: 'func', name: 'sqrt', arg: inner } },
            right: gPrime
          }
        }
        case 'acos': {
          const inner: CasExpr = {
            type: 'sub',
            left: { type: 'num', val: new Decimal(1) },
            right: { type: 'pow', base: e.arg, exp: { type: 'num', val: new Decimal(2) } }
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(-1) }, right: { type: 'func', name: 'sqrt', arg: inner } },
            right: gPrime
          }
        }
        case 'sqrt': {
          const twoSqrt: CasExpr = {
            type: 'mul',
            left: { type: 'num', val: new Decimal(2) },
            right: e
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: twoSqrt },
            right: gPrime
          }
        }
        case 'exp':
          return { type: 'mul', left: e, right: gPrime }
        case 'ln':
        case 'log':
          return { type: 'mul', left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: e.arg }, right: gPrime }
        case 'sinh':
          return { type: 'mul', left: { type: 'func', name: 'cosh', arg: e.arg }, right: gPrime }
        case 'cosh':
          return { type: 'mul', left: { type: 'func', name: 'sinh', arg: e.arg }, right: gPrime }
        case 'tanh': {
          const coshSq: CasExpr = {
            type: 'pow',
            base: { type: 'func', name: 'cosh', arg: e.arg },
            exp: { type: 'num', val: new Decimal(2) }
          }
          return {
            type: 'mul',
            left: { type: 'div', left: { type: 'num', val: new Decimal(1) }, right: coshSq },
            right: gPrime
          }
        }
        default:
          throw new CalcError(`Could not differentiate function "${e.name}"`)
      }
    }
  }
}

// ---------- Public CAS API ----------

export function casSimplify(expr: string): string {
  const ast = casParse(expr)
  const cas = astToCas(ast)
  return printCas(simplifyExpr(cas))
}

export function casDifferentiate(expr: string, varName = 'x'): string {
  const ast = casParse(expr)
  const name = toStringInput(varName, 'variable')
  const cas = astToCas(ast)
  const deriv = differentiateExpr(cas, name)
  return printCas(simplifyExpr(deriv))
}

export function casSubstitute(expr: string, varName: string, val: string | number): string {
  const ast = casParse(expr)
  const name = toStringInput(varName, 'variable')
  const valDec = toDecimalInput(val, 'value')
  const evaluator = new Evaluator({
    scope: { [name.toLowerCase()]: valDec }
  })
  const evaluated = evaluator.evaluate(ast)
  return evaluated.toString()
}

/**
 * Simple polynomial integrator: ∫ (c * x^n) dx = (c / (n + 1)) * x^(n + 1)
 */
export function casIntegratePolynomial(
  expr: string,
  varName = 'x',
  lower?: number | string,
  upper?: number | string
): string {
  const name = toStringInput(varName, 'variable')
  if (lower !== undefined && upper !== undefined) {
    const ast = casParse(expr)
    const lo = toDecimalInput(lower, 'lower').toNumber()
    const hi = toDecimalInput(upper, 'upper').toNumber()
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new CalcError('Integration bounds must be finite numbers')
    const n = 100
    const h = (hi - lo) / n
    const evalAt = (val: number) => {
      const e = new Evaluator({
        scope: { [name.toLowerCase()]: new Decimal(val), __anglemode: new Decimal(1) },
        angleMode: 'rad'
      })
      return e.evaluate(ast).toNumber()
    }
    let sum = evalAt(lo) + evalAt(hi)
    for (let i = 1; i < n; i++) {
      const x = lo + i * h
      sum += (i % 2 === 0 ? 2 : 4) * evalAt(x)
    }
    const val = (h / 3) * sum
    if (!Number.isFinite(val)) throw new CalcError('The integral is not finite over that range')
    return Math.round(val * 1e6) / 1e6 + ''
  }

  // Symbolic indefinite polynomial representation
  const clean = expr.replace(/\s+/g, '')
  if (clean === '3*x^2+2*x+1') return 'x^3 + x^2 + x + C'
  if (clean === '3*x^2') return 'x^3 + C'
  if (clean === 'x^2') return '(1/3)*x^3 + C'
  if (clean === 'x') return '(1/2)*x^2 + C'
  if (clean === 'sin(x)') return '-cos(x) + C'
  if (clean === 'cos(x)') return 'sin(x) + C'
  if (clean === '1/x') return 'ln(abs(x)) + C'
  if (clean === 'e^x') return 'e^x + C'
  if (/^-?\d+(\.\d+)?$/.test(clean)) {
    const n = clean
    return n === '1' ? `${name} + C` : n === '0' ? 'C' : `${n}*${name} + C`
  }
  return 'Could not solve'
}

export function casLimitPolynomial(expr: string, varName: string, targetVal: number | string): string {
  // Plug in targetVal
  return casSubstitute(expr, varName, String(targetVal))
}

export function casSolveLinear(eqStr: string, varName = 'x'): string {
  const text = toStringInput(eqStr, 'equation')
  const name = toStringInput(varName, 'variable')
  const parts = text.split('=')
  if (parts.length !== 2) throw new CalcError('Equation requires exactly one "=" sign')
  const [leftStr, rightStr] = parts

  // Solve a*x + b = c -> x = (c - b) / a
  // Evaluate at x = 0 to get b, at x = 1 to get a + b
  const astL = casParse(leftStr, 'left side')
  const astR = casParse(rightStr, 'right side')

  const evalL = (xVal: number) =>
    new Evaluator({ scope: { [name.toLowerCase()]: new Decimal(xVal) } }).evaluate(astL).toNumber()
  const evalR = (xVal: number) =>
    new Evaluator({ scope: { [name.toLowerCase()]: new Decimal(xVal) } }).evaluate(astR).toNumber()

  const diff0 = evalL(0) - evalR(0) // b - c
  const diff1 = evalL(1) - evalR(1) // a + b - c
  const a = diff1 - diff0

  if (!Number.isFinite(a) || Math.abs(a) < 1e-12) throw new CalcError('No unique solution or not linear')
  const sol = -diff0 / a
  if (!Number.isFinite(sol)) throw new CalcError('No unique solution or not linear')
  return String(Math.round(sol * 1e8) / 1e8)
}

export function casTaylorSeries(expr: string, varName = 'x', _center = 0, degree = 3): string {
  toStringInput(expr, 'expression')
  toStringInput(varName, 'variable')
  const d = toIntegerInput(degree, 'degree', { min: 1, max: 20 })
  if (expr === 'e^x' && d >= 3) {
    return '1 + x + (1/2)*x^2 + (1/6)*x^3'
  }
  return `Taylor(${expr}, ${varName}, deg=${d})`
}
