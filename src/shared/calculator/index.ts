import { parse } from './parser'
import { Evaluator, type EvaluationContext, type CurrencyContext } from './evaluator'
import { formatResult, Decimal, type OutputFormat } from './numeric'

export * from './types'
export * from './numeric'
export * from './registry'
export * from './parser'
export * from './evaluator'
export * from './rates'
export * from './currencyUi'
export * from './currencyExpression'
export * from './latex'
export * from './errors'
export * from './limits'
export * from './inputs'

export interface CalculationResult {
  value: Decimal
  formatted: string
  error?: string
  /** Set for `100 USD to EUR`: the result's currency code, shown after the number. */
  currency?: string
}

export class CalculatorEngine {
  private evaluator: Evaluator
  private defaultFormat: OutputFormat = 'decimal'
  private precision = 12

  constructor(context: EvaluationContext = {}) {
    this.evaluator = new Evaluator(context)
  }

  setPrecision(p: number): void {
    this.precision = Math.max(1, Math.min(30, p))
  }

  setDefaultFormat(f: OutputFormat): void {
    this.defaultFormat = f
  }

  setAngleMode(mode: 'deg' | 'rad' | 'grad'): void {
    const code = mode === 'rad' ? new Decimal(1) : mode === 'grad' ? new Decimal(2) : new Decimal(0)
    this.evaluator.setVariable('__angleMode', code)
  }

  /** The offline rates `100 USD to EUR` converts with (the Convert panel's own data). */
  setCurrencyContext(currency: CurrencyContext | null): void {
    this.evaluator.setCurrencyContext(currency)
  }

  calculate(expression: string, format?: OutputFormat): CalculationResult {
    try {
      const ast = parse(expression)
      const val = this.evaluator.evaluate(ast)
      this.evaluator.setAns(val)
      // A top-level call whose result has its own display form (primefactors) shows that;
      // everything else keeps the requested number format.
      const callName = ast.type === 'FunctionCall' ? ast.name.toLowerCase() : null
      const custom = callName ? this.evaluator.getFunctionFormatter(callName) : undefined
      const formatted = custom
        ? custom(val)
        : formatResult(val, {
            format: format || this.defaultFormat,
            precision: this.precision
          })
      // A currency conversion shows its code (`92.31 EUR`); Ans still holds the number.
      const currency = ast.type === 'CurrencyConversion' ? ast.to : undefined
      return { value: val, formatted, currency }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        value: null as any,
        formatted: 'Error',
        error: msg
      }
    }
  }

  setVariable(name: string, value: Decimal): void {
    this.evaluator.setVariable(name, value)
  }

  getVariable(name: string): Decimal | undefined {
    return this.evaluator.getVariable(name)
  }

  getAns(): Decimal {
    return this.evaluator.getAns()
  }
}

export * from './modules/scientific'
export * from './modules/statistics'
export * from './modules/finance'
export * from './modules/conversions'
export * from './modules/graphing'
export * from './modules/linear-algebra'
export * from './modules/complex'
export * from './modules/cas'
export * from './modules/scripting'
export * from './modules/datetime'
