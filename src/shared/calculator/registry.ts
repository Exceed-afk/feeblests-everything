import { Decimal } from './numeric'

export interface RegisteredFunction {
  name: string
  aliases?: string[]
  category:
    | 'core'
    | 'scientific'
    | 'stats'
    | 'finance'
    | 'conversion'
    | 'matrix'
    | 'cas'
    | 'programming'
    | 'date'
  description: string
  examples: string[]
  minArity: number
  maxArity: number
  impl: (args: Decimal[], scope?: Record<string, Decimal>) => Decimal
  /**
   * Optional display hook for results whose numeric value and friendly display differ
   * (e.g. primefactors shows `2 x 2 x 3 x 5`). Receives the impl result and returns the
   * formatted string used by the engine's top-level result.
   */
  format?: (value: Decimal) => string
}

export interface RegisteredConstant {
  name: string
  aliases?: string[]
  description: string
  value: Decimal
}

class FunctionRegistry {
  private functions = new Map<string, RegisteredFunction>()
  private constants = new Map<string, RegisteredConstant>()

  registerFunction(fn: RegisteredFunction): void {
    this.functions.set(fn.name.toLowerCase(), fn)
    if (fn.aliases) {
      for (const alias of fn.aliases) {
        this.functions.set(alias.toLowerCase(), fn)
      }
    }
  }

  registerConstant(c: RegisteredConstant): void {
    this.constants.set(c.name.toLowerCase(), c)
    if (c.aliases) {
      for (const alias of c.aliases) {
        this.constants.set(alias.toLowerCase(), c)
      }
    }
  }

  getFunction(name: string): RegisteredFunction | undefined {
    return this.functions.get(name.toLowerCase())
  }

  getConstant(name: string): RegisteredConstant | undefined {
    return this.constants.get(name.toLowerCase())
  }

  listFunctions(): RegisteredFunction[] {
    const seen = new Set<string>()
    const list: RegisteredFunction[] = []
    for (const fn of this.functions.values()) {
      if (!seen.has(fn.name)) {
        seen.add(fn.name)
        list.push(fn)
      }
    }
    return list
  }

  listConstants(): RegisteredConstant[] {
    const seen = new Set<string>()
    const list: RegisteredConstant[] = []
    for (const c of this.constants.values()) {
      if (!seen.has(c.name)) {
        seen.add(c.name)
        list.push(c)
      }
    }
    return list
  }
}

export const registry = new FunctionRegistry()

// Core constants
registry.registerConstant({
  name: 'pi',
  aliases: ['π', 'PI'],
  description: 'Ratio of circumference of a circle to its diameter',
  value: new Decimal('3.1415926535897932384626433832795028841971')
})

registry.registerConstant({
  name: 'e',
  aliases: ['E'],
  description: "Euler's number, base of natural logarithm",
  value: new Decimal('2.7182818284590452353602874713526624977572')
})

// Core functions
registry.registerFunction({
  name: 'abs',
  category: 'core',
  description: 'Absolute value',
  examples: ['abs(-5)', 'abs(3.14)'],
  minArity: 1,
  maxArity: 1,
  impl: ([a]) => a.abs()
})

registry.registerFunction({
  name: 'sqrt',
  category: 'core',
  description: 'Square root',
  examples: ['sqrt(16)', 'sqrt(2)'],
  minArity: 1,
  maxArity: 1,
  impl: ([a]) => {
    if (a.isNegative()) throw new Error('Square root of negative number')
    return a.sqrt()
  }
})

registry.registerFunction({
  name: 'cbrt',
  category: 'core',
  description: 'Cube root',
  examples: ['cbrt(27)', 'cbrt(-8)'],
  minArity: 1,
  maxArity: 1,
  impl: ([a]) => a.cbrt()
})

registry.registerFunction({
  name: 'round',
  category: 'core',
  description: 'Round to nearest integer or specified decimal places (half away from zero: round(2.5) = 3, round(-2.5) = -3)',
  examples: ['round(2.5)', 'round(-2.5)', 'round(3.14159, 2)'],
  minArity: 1,
  maxArity: 2,
  impl: ([a, places]) => {
    const p = places ? places.toNumber() : 0
    return a.toDecimalPlaces(p)
  }
})

registry.registerFunction({
  name: 'floor',
  category: 'core',
  description: 'Round down to nearest integer',
  examples: ['floor(3.9)', 'floor(-2.1)'],
  minArity: 1,
  maxArity: 1,
  impl: ([a]) => a.floor()
})

registry.registerFunction({
  name: 'ceil',
  category: 'core',
  description: 'Round up to nearest integer',
  examples: ['ceil(3.1)', 'ceil(-2.9)'],
  minArity: 1,
  maxArity: 1,
  impl: ([a]) => a.ceil()
})

registry.registerFunction({
  name: 'min',
  category: 'core',
  description: 'Smallest of arguments',
  examples: ['min(3, 5, 1)', 'min(-2, 4)'],
  minArity: 1,
  maxArity: 99,
  impl: (args) => Decimal.min(...args)
})

registry.registerFunction({
  name: 'max',
  category: 'core',
  description: 'Largest of arguments',
  examples: ['max(3, 5, 1)', 'max(-2, 4)'],
  minArity: 1,
  maxArity: 99,
  impl: (args) => Decimal.max(...args)
})
