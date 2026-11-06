// Plotting-only float64 fast path (docs/calculator-build-plan.md, section 13:
// "Floats for plotting and bulk data").
//
// The full evaluator is exact but slow (~0.2-0.3 ms per point, which is 10x the
// cost of the whole plot on plain doubles). This module compiles a parsed AST
// into a plain JavaScript closure that evaluates with float64 arithmetic and the
// Math functions, honouring the DEG/RAD/GRAD angle mode. It is built by walking
// the AST: no dynamic code execution of any kind (the boundary test forbids
// both eval and constructing functions from strings).
//
// The closure NEVER changes what the user sees: when anything in the expression
// is outside what the float path supports exactly (user-defined functions and
// variables other than the plot variable, constants other than the registered
// exact ones, or a registry function with no float twin), the compiler throws
// UnsupportedExpression and the graphing module falls back to the existing
// Decimal sampler.

import type { ASTNode } from '../../parser/ast'
import { registry } from '../../registry'
import { CalcError } from '../../errors'

export type AngleMode = 'deg' | 'rad' | 'grad'

/** Thrown when the expression contains anything the float path cannot mirror exactly. */
export class UnsupportedExpression extends CalcError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedExpression'
  }
}

/** Registered constants mirrored exactly as double literals. */
const FLOAT_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E
}

/**
 * Float twins for registry functions. Each entry: name -> arity-checked impl.
 * Trig entries here are for RADIAN input/output; the compile step wraps them
 * with the angle-mode conversion so one table serves all three modes.
 */
const FLOAT_FUNCTIONS: Record<string, { minArgs: number; maxArgs: number; impl: (...args: number[]) => number }> = {
  abs: { minArgs: 1, maxArgs: 1, impl: Math.abs },
  sqrt: { minArgs: 1, maxArgs: 1, impl: (x) => (x < 0 ? NaN : Math.sqrt(x)) },
  cbrt: { minArgs: 1, maxArgs: 1, impl: Math.cbrt },
  floor: { minArgs: 1, maxArgs: 1, impl: Math.floor },
  ceil: { minArgs: 1, maxArgs: 1, impl: Math.ceil },
  min: { minArgs: 1, maxArgs: 99, impl: Math.min },
  max: { minArgs: 1, maxArgs: 99, impl: Math.max },
  round: {
    minArgs: 1, maxArgs: 2,
    impl: (x, places) => {
      const p = places === undefined ? 0 : places
      if (!Number.isInteger(p)) return NaN
      const factor = Math.pow(10, p)
      return Math.round(x * factor) / factor
    }
  },
  // Scientific (radian semantics here; angle-mode conversion is applied at compile time)
  sin: { minArgs: 1, maxArgs: 1, impl: Math.sin },
  cos: { minArgs: 1, maxArgs: 1, impl: Math.cos },
  tan: {
    minArgs: 1, maxArgs: 1,
    impl: (rad) => {
      if (Math.abs(Math.cos(rad)) < 1e-15) return NaN
      return Math.tan(rad)
    }
  },
  cot: {
    minArgs: 1, maxArgs: 1,
    impl: (rad) => {
      if (Math.abs(Math.sin(rad)) < 1e-15) return NaN
      return 1 / Math.tan(rad)
    }
  },
  sec: {
    minArgs: 1, maxArgs: 1,
    impl: (rad) => {
      const c = Math.cos(rad)
      if (Math.abs(c) < 1e-15) return NaN
      return 1 / c
    }
  },
  csc: {
    minArgs: 1, maxArgs: 1,
    impl: (rad) => {
      const s = Math.sin(rad)
      if (Math.abs(s) < 1e-15) return NaN
      return 1 / s
    }
  },
  asin: { minArgs: 1, maxArgs: 1, impl: (x) => (x < -1 || x > 1 ? NaN : Math.asin(x)) },
  acos: { minArgs: 1, maxArgs: 1, impl: (x) => (x < -1 || x > 1 ? NaN : Math.acos(x)) },
  atan: { minArgs: 1, maxArgs: 1, impl: Math.atan },
  sinh: { minArgs: 1, maxArgs: 1, impl: Math.sinh },
  cosh: { minArgs: 1, maxArgs: 1, impl: Math.cosh },
  tanh: { minArgs: 1, maxArgs: 1, impl: Math.tanh },
  ln: { minArgs: 1, maxArgs: 1, impl: (x) => (x <= 0 ? NaN : Math.log(x)) },
  log10: { minArgs: 1, maxArgs: 1, impl: (x) => (x <= 0 ? NaN : Math.log10(x)) },
  log2: { minArgs: 1, maxArgs: 1, impl: (x) => (x <= 0 ? NaN : Math.log2(x)) },
  exp: { minArgs: 1, maxArgs: 1, impl: Math.exp }
}

/** Angle-mode conversion as doubles: the exact Decimal path uses pi = acos(-1). */
const DEG_TO_RAD = Math.PI / 180
const GRAD_TO_RAD = Math.PI / 200

interface CompileEnv {
  angleMode: AngleMode
}

function radiansOf(mode: AngleMode, v: number): number {
  if (mode === 'rad') return v
  if (mode === 'grad') return v * GRAD_TO_RAD
  return v * DEG_TO_RAD
}

function angleFromRadians(mode: AngleMode, v: number): number {
  if (mode === 'rad') return v
  if (mode === 'grad') return (v * 200) / Math.PI
  return (v * 180) / Math.PI
}

/**
 * Compile an AST into (x: number) => number.
 * Throws UnsupportedExpression for anything the float path cannot mirror
 * exactly; the caller then falls back to the exact Decimal evaluator.
 */
export function compileFloatExpression(ast: ASTNode, opts: { angleMode?: AngleMode } = {}): (x: number) => number {
  const angleMode = opts.angleMode ?? 'deg'
  checkSupported(ast)
  const fn = compileNode(ast, { angleMode })

  // All three plot variable names bind the same running value.
  return (x: number) => fn(x, x, x)
}

/**
 * Pre-compile pass: reject anything the float path cannot mirror exactly.
 * Plot variable names (x / t / theta) are fine; any other identifier must be a
 * registered constant. Assignments and unknown variables force the Decimal fallback.
 */
function checkSupported(ast: ASTNode): void {
  const visit = (node: ASTNode): void => {
    switch (node.type) {
      case 'Identifier': {
        const name = node.name.toLowerCase()
        if (name === 'x' || name === 't' || name === 'theta') return
        if (FLOAT_CONSTANTS[name] !== undefined) return
        if (registry.getConstant(name) !== undefined) return // any registered constant is fine
        throw new UnsupportedExpression(`float path does not support variable "${node.name}"`)
      }
      case 'Number':
        return
      case 'UnaryOp':
        visit(node.operand)
        return
      case 'BinaryOp':
        visit(node.left)
        visit(node.right)
        return
      case 'FunctionCall':
        for (const arg of node.args) visit(arg)
        return
      case 'Assignment':
        // Assignments change scope between points; the exact evaluator handles
        // them, the float closure cannot.
        throw new UnsupportedExpression('float path does not support assignments')
    }
  }
  visit(ast)
}

type FloatFn = (x: number, t: number, theta: number) => number

function compileNode(node: ASTNode, env: CompileEnv): FloatFn {
  switch (node.type) {
    case 'Number': {
      const value = Number(node.value)
      if (!Number.isFinite(value)) {
        // Literal too large for double: the exact evaluator caps magnitude at 1e100000,
        // the float path cannot represent it, so fall back.
        throw new UnsupportedExpression(`float path cannot represent the literal "${node.value}"`)
      }
      const constant = value
      return () => constant
    }

    case 'Identifier': {
      const name = node.name.toLowerCase()
      if (name === 'x' || name === 't' || name === 'theta') {
        const which = name === 'x' ? 0 : name === 't' ? 1 : 2
        return (x, t, theta) => (which === 0 ? x : which === 1 ? t : theta)
      }
      if (FLOAT_CONSTANTS[name] !== undefined) {
        const c = FLOAT_CONSTANTS[name]
        return () => c
      }
      const registered = registry.getConstant(name)
      if (registered !== undefined) {
        // Keep the exact constant value as a double: same digits both paths see.
        const c = registered.value.toNumber()
        if (!Number.isFinite(c)) throw new UnsupportedExpression(`constant "${node.name}" is not representable as a float`)
        return () => c
      }
      throw new UnsupportedExpression(`float path does not support variable "${node.name}"`)
    }

    case 'UnaryOp': {
      const operand = compileNode(node.operand, env)
      if (node.operator === '-') return (x, t, th) => -operand(x, t, th)
      return (x, t, th) => operand(x, t, th)
    }

    case 'BinaryOp': {
      const left = compileNode(node.left, env)
      const right = compileNode(node.right, env)
      switch (node.operator) {
        case '+':
          return (x, t, th) => left(x, t, th) + right(x, t, th)
        case '-':
          return (x, t, th) => left(x, t, th) - right(x, t, th)
        case '*':
          return (x, t, th) => left(x, t, th) * right(x, t, th)
        case '/':
          return (x, t, th) => left(x, t, th) / right(x, t, th)
        case '%':
          return (x, t, th) => left(x, t, th) % right(x, t, th)
        case '^': {
          // Mirror the exact evaluator's domain rules: 0^negative and
          // negative^fractional are errors there, NaN here marks the point dead.
          return (x, t, th) => {
            const base = left(x, t, th)
            const exponent = right(x, t, th)
            if (base === 0 && exponent < 0) return NaN
            if (base < 0 && !Number.isInteger(exponent)) return NaN
            return Math.pow(base, exponent)
          }
        }
        default: {
          const op = String(node['operator' as keyof typeof node] ?? '')
          throw new UnsupportedExpression(`float path does not support operator "${op}"`)
        }
      }
    }

    case 'FunctionCall': {
      const fn = registry.getFunction(node.name)
      if (!fn) throw new UnsupportedExpression(`undefined function "${node.name}"`)
      const floatFn = FLOAT_FUNCTIONS[node.name.toLowerCase()]
      // No float twin (fact, gcd, nPr, ... anything registered later) -> Decimal path.
      if (!floatFn) throw new UnsupportedExpression(`float path has no float version of "${node.name}"`)
      if (node.args.length < floatFn.minArgs || node.args.length > floatFn.maxArgs) {
        throw new UnsupportedExpression(`function "${node.name}" called with ${node.args.length} arguments`)
      }

      const name = node.name.toLowerCase()
      const args = node.args.map((a) => compileNode(a, env))
      const isAngleIn = name === 'sin' || name === 'cos' || name === 'tan' || name === 'cot' || name === 'sec' || name === 'csc'
      const isAngleOut = name === 'asin' || name === 'acos' || name === 'atan'

      const raw = floatFn.impl
      const mode = env.angleMode

      if (isAngleIn) {
        return (x, t, th) => {
          const v = args[0](x, t, th)
          if (Number.isNaN(v)) return NaN
          if (name === 'tan' || name === 'sec') {
            if (mode === 'deg' && Math.abs(v % 180) === 90) return NaN
            if (mode === 'grad' && Math.abs(v % 200) === 100) return NaN
          }
          if (name === 'cot' || name === 'csc') {
            if (mode === 'deg' && v % 180 === 0) return NaN
            if (mode === 'grad' && v % 200 === 0) return NaN
          }
          return raw(radiansOf(mode, v))
        }
      }
      if (isAngleOut) {
        return (x, t, th) => {
          const v = raw(...args.map((a) => a(x, t, th)))
          if (Number.isNaN(v)) return NaN
          return angleFromRadians(mode, v)
        }
      }
      return (x, t, th) => raw(...args.map((a) => a(x, t, th)))
    }

    case 'Assignment':
      throw new UnsupportedExpression('float path does not support assignments')

    default:
      throw new UnsupportedExpression('unknown AST node')
  }
}
