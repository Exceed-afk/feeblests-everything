import { parse } from './parser'
import { Evaluator, type EvaluationContext } from './evaluator'
import { formatResult, Decimal, type OutputFormat } from './numeric'

export * from './types'
export * from './numeric'
export * from './registry'
export * from './parser'
export * from './evaluator'
export * from './rates'
export * from './currencyUi'
export * from './errors'
export * from './limits'
export * from './inputs'

export interface CalculationResult {
  value: Decimal
  formatted: string
  error?: string
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

  calculate(expression: string, format?: OutputFormat): CalculationResult {
    try {
      const ast = parse(expression)
      const val = this.evaluator.evaluate(ast)
      this.evaluator.setAns(val)
      const formatted = formatResult(val, {
        format: format || this.defaultFormat,
        precision: this.precision
      })
      return { value: val, formatted }
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
