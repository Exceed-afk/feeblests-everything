import { Decimal } from '../numeric'
import { registry } from '../registry'
import type { ASTNode } from '../parser/ast'
import { CALC_LIMITS, limitMessage } from '../limits'
import { CalcError } from '../errors'
import { performCurrencyConversion } from '../rates'
import type { CalcRate, CalcRateOverride, CalcRateSet } from '../types'

/**
 * The offline rates a `100 USD to EUR` expression converts with. The UI fills this
 * from the same storage the Convert panel uses; without it a conversion is a clear
 * error rather than a guess.
 */
export interface CurrencyContext {
  rateSet: CalcRateSet
  rates: CalcRate[]
  overrides?: CalcRateOverride[]
  baseCurrency: string
  staleRateDays: number
  /** Local date used for the stale-rate check. */
  today?: string | Date
}

export interface EvaluationContext {
  scope?: Record<string, Decimal>
  angleMode?: 'deg' | 'rad' | 'grad'
  ans?: Decimal
  currency?: CurrencyContext
  customFunctions?: Record<string, (args: Decimal[]) => Decimal>
}

export class EvaluationError extends CalcError {
  constructor(message: string, public pos: number) {
    super(`${message} at position ${pos}`, 'CALC_EVAL')
    this.name = 'EvaluationError'
  }
}

/** |x| < 10^exponentLimit. Keeps every intermediate number printable and quick. */
export function assertMagnitude(value: Decimal, pos = 0): Decimal {
  if (!value.isFinite()) {
    throw new EvaluationError('Result is not a finite number', pos)
  }
  if (!value.isZero() && Math.abs(value.e) >= CALC_LIMITS.exponentLimit) {
    throw new EvaluationError(
      `${limitMessage('exponentLimit', 'in either direction (|x| < 10^' + CALC_LIMITS.exponentLimit + ')')}`,
      pos
    )
  }
  return value
}

export class Evaluator {
  private scope: Map<string, Decimal>
  private angleMode: 'deg' | 'rad' | 'grad'
  private ans: Decimal
  private currency: CurrencyContext | null
  private customFunctions: Map<string, (args: Decimal[]) => Decimal> | null
  // Counted on every recursive step; checked before the JS stack is anywhere near its
  // limit, so a deep tree fails with our own error instead of "Maximum call stack size".
  // The parser already caps real nesting at 200; this is the backstop for a hand-built AST.
  private depth = 0

  constructor(context: EvaluationContext = {}) {
    this.scope = new Map(Object.entries(context.scope || {}))
    this.angleMode = context.angleMode || 'deg'
    this.ans = context.ans || new Decimal(0)
    this.currency = context.currency ?? null
    this.customFunctions = context.customFunctions
      ? new Map(Object.entries(context.customFunctions).map(([k, v]) => [k.toLowerCase(), v]))
      : null
  }

  /** Replace the offline rates used by `100 USD to EUR` expressions. */
  setCurrencyContext(currency: CurrencyContext | null): void {
    this.currency = currency
  }

  setVariable(name: string, value: Decimal): void {
    this.scope.set(name.toLowerCase(), value)
  }

  /**
   * Evaluate a long left-deep chain (a + b + c + ...) with an explicit stack instead of
   * recursion, so a flat 10,000-term sum cannot exhaust the JS call stack.
   */
  private evaluateLeftChain(node: Extract<ASTNode, { type: 'BinaryOp' }>): Decimal {
    const spine: Array<Extract<ASTNode, { type: 'BinaryOp' }>> = []
    let cur: ASTNode = node
    while (cur.type === 'BinaryOp') {
      spine.push(cur)
      cur = cur.left
      if (spine.length > CALC_LIMITS.expressionLength) {
        throw new EvaluationError('The expression chain is too long', node.pos)
      }
    }
    let value = this.evaluate(cur)
    for (let i = spine.length - 1; i >= 0; i--) {
      const op = spine[i]
      value = this.evaluateBinary(op.operator, value, op.right, op.pos)
    }
    // A trailing postfix percent on the whole chain (e.g. `50%` alone): the spine loop
    // already applied any inner one; nothing extra is needed here.
    return value
  }

  /**
   * Evaluate a binary operation whose right side may be a postfix percent.
   * Google-style semantics: `a + b%` adds a x b/100 and `a - b%` subtracts a x b/100
   * (the percent is a fraction OF a); after * / ^ the percent is just b/100.
   */
  private evaluateBinary(op: string, left: Decimal, rightNode: ASTNode, pos: number): Decimal {
    if (rightNode.type === 'PercentSuffix') {
      const raw = this.evaluate(rightNode.operand)
      if (op === '+') return assertMagnitude(left.plus(left.times(raw).dividedBy(100)), pos)
      if (op === '-') return assertMagnitude(left.minus(left.times(raw).dividedBy(100)), pos)
      return this.applyBinaryOp(op, left, raw.dividedBy(100), pos)
    }
    return this.applyBinaryOp(op, left, this.evaluate(rightNode), pos)
  }

  /** One binary operation, with the size and domain checks every path shares. */
  private applyBinaryOp(op: string, left: Decimal, right: Decimal, pos: number): Decimal {
    switch (op) {
      case '+':
        return assertMagnitude(left.plus(right), pos)
      case '-':
        return assertMagnitude(left.minus(right), pos)
      case '*': {
        // Refuse before multiplying: 10^60000 * 10^60000 costs real time and is over the cap anyway.
        const estimate = Math.abs(left.e) + Math.abs(right.e) + 2
        if (!left.isZero() && !right.isZero() && estimate > CALC_LIMITS.exponentLimit) {
          throw new EvaluationError(limitMessage('exponentLimit', 'in either direction (the product is too large)'), pos)
        }
        return assertMagnitude(left.times(right), pos)
      }
      case '/': {
        if (right.isZero()) throw new EvaluationError('Division by zero', pos)
        return assertMagnitude(left.dividedBy(right), pos)
      }
      case '%': {
        if (right.isZero()) throw new EvaluationError('Modulo by zero', pos)
        return left.modulo(right)
      }
      case '^': {
        if (left.isZero() && right.isNegative()) {
          throw new EvaluationError('Division by zero in exponentiation', pos)
        }
        if (left.isNegative() && !right.isInteger()) {
          throw new EvaluationError('Negative base with non-integer exponent', pos)
        }
        return assertMagnitude(this.power(left, right, pos), pos)
      }
      default:
        throw new EvaluationError(`Unknown operator "${op}"`, pos)
    }
  }

  getVariable(name: string): Decimal | undefined {
    const norm = name.toLowerCase()
    if (norm === 'ans') return this.ans
    return this.scope.get(norm)
  }

  setAns(val: Decimal): void {
    this.ans = val
  }

  getAns(): Decimal {
    return this.ans
  }

  /** Display hook of a registered function (e.g. primefactors' `2 x 2 x 3 x 5`). */
  getFunctionFormatter(name: string): ((value: Decimal) => string) | undefined {
    return registry.getFunction(name)?.format
  }

  evaluate(node: ASTNode): Decimal {
    this.depth++
    try {
      if (this.depth > CALC_LIMITS.nestingDepth * 8) {
        throw new EvaluationError(limitMessage('nestingDepth', '(the expression is nested too deeply)'), node.pos || 0)
      }
      return this.evaluateNode(node)
    } finally {
      this.depth--
    }
  }

  private evaluateNode(node: ASTNode): Decimal {
    switch (node.type) {
      case 'Number': {
        // 1e999999999 never becomes a Decimal: the length of the literal alone is the giveaway.
        const digits = node.value.replace(/^[+-]/, '').split(/[eE]/)[0].length
        const exponent = /[eE]([+-]?\d+)/.exec(node.value)
        const magnitude = (exponent ? Math.abs(Number(exponent[1])) : 0) + digits
        if (magnitude > CALC_LIMITS.exponentLimit) {
          throw new EvaluationError(
            limitMessage('exponentLimit', `(this literal has ${magnitude.toLocaleString('en-US')} digits of magnitude)`),
            node.pos
          )
        }
        return new Decimal(node.value)
      }

      case 'Identifier': {
        const val = this.getVariable(node.name)
        if (val !== undefined) return val

        const c = registry.getConstant(node.name)
        if (c !== undefined) return c.value

        throw new EvaluationError(`Undefined variable or constant "${node.name}"`, node.pos)
      }

      case 'Assignment': {
        const val = this.evaluate(node.value)
        this.setVariable(node.name, val)
        this.ans = val
        return val
      }

      case 'UnaryOp': {
        const val = this.evaluate(node.operand)
        return node.operator === '-' ? val.neg() : val
      }

      case 'BinaryOp': {
        // Long left-deep chains (sums, products) are walked iteratively, not recursively.
        if (node.left.type === 'BinaryOp') return this.evaluateLeftChain(node)
        return this.evaluateBinary(node.operator, this.evaluate(node.left), node.right, node.pos)
      }

      case 'CurrencyConversion': {
        const amount = this.evaluate(node.amount)
        const ctx = this.currency
        if (!ctx) {
          throw new EvaluationError(
            `Currency conversion needs your offline rates: open Convert → Offline Currency Rates and add ${node.from} and ${node.to}`,
            node.pos
          )
        }
        // Name the code that is not in the set, rather than a generic pair message.
        const known = new Set([ctx.baseCurrency.toUpperCase(), ...ctx.rates.map((r) => r.currencyCode.toUpperCase())])
        for (const code of [node.from, node.to]) {
          if (!known.has(code)) {
            throw new EvaluationError(
              `Unknown currency code "${code}" — it is not in the rate set "${ctx.rateSet.name}"`,
              node.pos
            )
          }
        }
        // The Convert panel's own conversion code: one converter, not two.
        const out = performCurrencyConversion({
          amount,
          from: node.from,
          to: node.to,
          targetSet: ctx.rateSet,
          rates: ctx.rates,
          overrides: ctx.overrides,
          baseCurrency: ctx.baseCurrency,
          staleRateDays: ctx.staleRateDays,
          today: ctx.today ?? new Date()
        })
        return assertMagnitude(new Decimal(out.result), node.pos)
      }

      case 'PercentSuffix': {
        // Standalone percent (or percent after * / ^, handled in evaluateBinary):
        // divide by 100. `50%` = 0.5.
        return assertMagnitude(this.evaluate(node.operand).dividedBy(100), node.pos)
      }

      case 'FunctionCall': {
        const lowerName = node.name.toLowerCase()
        const custom = this.customFunctions?.get(lowerName)
        if (custom) {
          const evaluatedArgs = node.args.map((arg) => this.evaluate(arg))
          try {
            return assertMagnitude(custom(evaluatedArgs), node.pos)
          } catch (err) {
            if (err instanceof EvaluationError) throw err
            throw new EvaluationError(
              err instanceof Error ? err.message : `Error executing ${node.name}`,
              node.pos
            )
          }
        }

        const fn = registry.getFunction(node.name)
        if (!fn) {
          throw new EvaluationError(`Undefined function "${node.name}"`, node.pos)
        }

        if (node.args.length < fn.minArity || node.args.length > fn.maxArity) {
          throw new EvaluationError(
            `Function "${node.name}" expects between ${fn.minArity} and ${fn.maxArity} arguments, received ${node.args.length}`,
            node.pos
          )
        }

        const evaluatedArgs = node.args.map((arg) => this.evaluate(arg))
        try {
          return assertMagnitude(fn.impl(evaluatedArgs, Object.fromEntries(this.scope)), node.pos)
        } catch (err) {
          if (err instanceof EvaluationError) throw err
          throw new EvaluationError(
            err instanceof Error ? err.message : `Error executing ${node.name}`,
            node.pos
          )
        }
      }

      default:
        throw new EvaluationError('Unknown AST node', 0)
    }
  }

  /**
   * Exponentiation with a size test first.
   * The result's decimal exponent is about (exponent x log10(base)), so a tower like
   * 9^9^9^9 or 2^(2^40) is rejected from the numbers alone instead of being computed.
   */
  private power(base: Decimal, exponent: Decimal, pos: number): Decimal {
    if (exponent.isZero()) return new Decimal(1)
    if (exponent.abs().gt(2_147_483_647)) {
      throw new EvaluationError(limitMessage('exponentLimit', 'for an exponent'), pos)
    }
    const exp = exponent.toNumber()
    if (base.isZero()) return new Decimal(0)
    const log10 = Math.log10(Math.abs(base.toNumber() || Number.MIN_VALUE))
    const estimate = Number.isFinite(log10) ? Math.abs(exp * log10) : Number.POSITIVE_INFINITY
    // Integer powers of a base near 1 can be well conditioned even when |base| is tiny,
    // so only integer exponents get the direct magnitude test.
    if (exponent.isInteger() && estimate > CALC_LIMITS.exponentLimit) {
      throw new EvaluationError(
        limitMessage(
          'exponentLimit',
          `in either direction (${base.toString().slice(0, 12)} ^ ${exponent.toString()} would have about ` +
          `${Math.round(estimate).toLocaleString('en-US')} digits)`
        ),
        pos
      )
    }
    if (!exponent.isInteger() && (!Number.isFinite(exp) || Math.abs(exp) > 1e6)) {
      throw new EvaluationError(limitMessage('exponentLimit', 'for a fractional exponent'), pos)
    }
    return base.pow(exponent)
  }
}

export function evaluate(node: ASTNode, context?: EvaluationContext): Decimal {
  return new Evaluator(context).evaluate(node)
}
