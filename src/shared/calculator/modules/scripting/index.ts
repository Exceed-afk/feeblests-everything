import { parse, type ASTNode } from '../../parser'
import { Evaluator } from '../../evaluator'
import { Decimal } from '../../numeric'
import { CALC_LIMITS, limitMessage } from '../../limits'
import { CalcError } from '../../errors'
import { toStringInput, requireDefined } from '../../inputs'

/** Word sizes a bitwise operation may use. */
const WORD_BITS = new Set([8, 16, 32, 64])

function wordBits(value: unknown): number {
  if (value === undefined) return 32
  const n = typeof value === 'bigint' ? Number(value) : value
  const bits = Number(n)
  if (!WORD_BITS.has(bits)) throw new CalcError('Word size must be 8, 16, 32 or 64 bits')
  return bits
}

function bigintInput(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  throw new CalcError(`${what} must be a whole number`)
}

// ---------- Bitwise Operations ----------

export function bitwiseAnd(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') & bigintInput(b, 'b')
}

export function bitwiseOr(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') | bigintInput(b, 'b')
}

export function bitwiseXor(a: bigint | number | string, b: bigint | number | string): bigint {
  return bigintInput(a, 'a') ^ bigintInput(b, 'b')
}

export function bitwiseNot(a: bigint | number | string, bits: number | string = 32): bigint {
  const size = wordBits(bits)
  const mask = (1n << BigInt(size)) - 1n
  return (~bigintInput(a, 'a')) & mask
}

export function bitwiseShiftLeft(a: bigint | number | string, shift: number | string, bits: number | string = 32): bigint {
  const size = wordBits(bits)
  const n = Number(shift)
  if (!Number.isInteger(n) || n < 0 || n > size) throw new CalcError(`Shift must be between 0 and ${size}`)
  const mask = (1n << BigInt(size)) - 1n
  return (bigintInput(a, 'a') << BigInt(n)) & mask
}

export function bitwiseShiftRight(a: bigint | number | string, shift: number | string): bigint {
  const n = Number(shift)
  if (!Number.isInteger(n) || n < 0 || n > 1024) throw new CalcError('Shift must be between 0 and 1024')
  return bigintInput(a, 'a') >> BigInt(n)
}

export function formatBinaryWord(val: bigint | number | string, bits: number | string = 32): string {
  const size = wordBits(bits)
  const mask = (1n << BigInt(size)) - 1n
  const unsigned = bigintInput(val, 'val') & mask
  const bin = unsigned.toString(2).padStart(size, '0')
  // Group into 4-bit nibbles
  return bin.replace(/\B(?=(\d{4})+(?!\d))/g, ' ')
}

export function parseBinaryWord(str: string): bigint {
  const text = toStringInput(str, 'binary string')
  const clean = text.replace(/[\s,_]/g, '')
  if (!/^[01]{1,1024}$/.test(clean)) throw new CalcError('Binary string must be 1 to 1024 zeroes and ones')
  return BigInt(`0b${clean}`)
}

// ---------- Sandboxed Scripting Engine ----------

export interface ScriptContext {
  /** Callers may LOWER the step cap, never raise it above CALC_LIMITS.scriptSteps. */
  maxSteps?: number
  initialScope?: Record<string, string>
  /** @internal Internal step counter ref shared across nested function and block calls */
  _stepRef?: { count: number; max: number }
  /** @internal Current call stack depth for custom function calls */
  _recursionDepth?: number
  /** @internal Custom functions passed down to child executions */
  _customFuncs?: Record<string, CustomFunc>
}

export interface ScriptExecutionResult {
  returnValue: string
  scope: Record<string, string>
  stepsCount: number
}

interface CustomFunc {
  params: string[]
  body: string[]
}

/**
 * Sandboxed line-based script interpreter with:
 * - Variable assignments (e.g. x = 10, fact = fact * n)
 * - Conditionals (if condition { ... } else { ... })
 * - Loops (while condition { ... })
 * - Function declarations (fn name(param) { ... })
 * - Return statements (return expr)
 * - Strict step counter limit ensuring termination
 */
export function executeScript(
  source: string,
  context: ScriptContext = {}
): ScriptExecutionResult {
  const text = toStringInput(source, 'script')
  if (text.length > CALC_LIMITS.scriptLength) {
    throw new CalcError(
      `${limitMessage('scriptLength', 'characters')} (this one has ${text.length.toLocaleString('en-US')})`
    )
  }
  if (!context || typeof context !== 'object') throw new CalcError('Script context must be an object')
  if (context.initialScope !== undefined && (context.initialScope === null || typeof context.initialScope !== 'object')) {
    throw new CalcError('initialScope must be an object of name: value pairs')
  }

  // A hard ceiling no caller can move: a loop can never freeze the UI.
  const requested = context.maxSteps === undefined ? CALC_LIMITS.scriptSteps : Number(context.maxSteps)
  if (!Number.isFinite(requested)) throw new CalcError('maxSteps must be a number')
  const maxSteps = Math.min(CALC_LIMITS.scriptSteps, Math.max(1, Math.floor(requested)))

  const stepRef = context._stepRef ?? { count: 0, max: maxSteps }
  const recursionDepth = context._recursionDepth ?? 0

  if (typeof source !== 'string') throw new CalcError('Script must be text')
  source = text

  const scope: Record<string, Decimal> = {}
  for (const [k, v] of Object.entries(context.initialScope || {})) {
    try {
      scope[k.toLowerCase()] = new Decimal(requireDefined(v, `initialScope.${k}`))
    } catch {
      throw new CalcError(`initialScope.${k} must be a number`)
    }
  }

  const funcs: Record<string, CustomFunc> = { ...(context._customFuncs || {}) }

  const evalExpr = (exprStr: string): Decimal => {
    const trimmed = exprStr.trim()
    if (!trimmed) throw new CalcError('Empty expression in statement')

    const customFunctions: Record<string, (args: Decimal[]) => Decimal> = {}
    for (const [fnName, customFn] of Object.entries(funcs)) {
      customFunctions[fnName] = (args: Decimal[]) => {
        if (args.length !== customFn.params.length) {
          throw new CalcError(
            `Function "${fnName}" expects ${customFn.params.length} arguments, received ${args.length}`
          )
        }
        if (recursionDepth + 1 > CALC_LIMITS.scriptRecursionDepth) {
          throw new CalcError('Maximum recursion depth exceeded')
        }
        const fnScope: Record<string, string> = {
          ...Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()]))
        }
        for (let i = 0; i < customFn.params.length; i++) {
          fnScope[customFn.params[i]] = args[i].toString()
        }
        const childContext: ScriptContext = {
          maxSteps: stepRef.max,
          initialScope: fnScope,
          _stepRef: stepRef,
          _recursionDepth: recursionDepth + 1,
          _customFuncs: funcs
        }
        const childRes = executeScript(customFn.body.join('\n'), childContext)
        return new Decimal(childRes.returnValue || '0')
      }
    }

    try {
      const ast = parse(exprStr)
      const evaluator = new Evaluator({ scope, customFunctions })
      return evaluator.evaluate(ast)
    } catch (err) {
      if (err instanceof CalcError) throw err
      throw new CalcError(err instanceof Error ? err.message : String(err))
    }
  }

  const evalCondition = (condStr: string): boolean => {
    const ops = ['==', '!=', '>=', '<=', '>', '<']
    for (const op of ops) {
      if (condStr.includes(op)) {
        const [lStr, rStr] = condStr.split(op)
        const lVal = evalExpr(lStr)
        const rVal = evalExpr(rStr)
        switch (op) {
          case '==':
            return lVal.equals(rVal)
          case '!=':
            return !lVal.equals(rVal)
          case '>':
            return lVal.greaterThan(rVal)
          case '<':
            return lVal.lessThan(rVal)
          case '>=':
            return lVal.greaterThanOrEqualTo(rVal)
          case '<=':
            return lVal.lessThanOrEqualTo(rVal)
        }
      }
    }
    return !evalExpr(condStr).isZero()
  }

  const rawLines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'))

  let pc = 0
  let returnVal: string = '0'

  const incrementStep = () => {
    stepRef.count++
    if (stepRef.count > stepRef.max) {
      throw new CalcError(`Step limit exceeded (${stepRef.max} steps): possible infinite loop detected`)
    }
  }

  while (pc < rawLines.length) {
    incrementStep()

    const line = rawLines[pc]

    // Function declaration: fn name(param1, param2, ...) { ... }
    const fnDecl = line.match(/^fn\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*\{?$/)
    if (fnDecl) {
      const fnName = fnDecl[1].toLowerCase()
      const rawParams = fnDecl[2].trim()
      const params = rawParams.length === 0
        ? []
        : rawParams.split(',').map((p) => p.trim().toLowerCase())
      for (const p of params) {
        if (!/^[a-zA-Z_]\w*$/.test(p)) {
          throw new CalcError(`Syntax error: invalid parameter name "${p}" in function "${fnName}"`)
        }
      }
      const body: string[] = []
      pc++
      let depth = 1
      while (pc < rawLines.length) {
        if (rawLines[pc].includes('{')) depth++
        if (rawLines[pc] === '}' || rawLines[pc].startsWith('}')) {
          depth--
          if (depth === 0) break
        }
        body.push(rawLines[pc])
        pc++
      }
      funcs[fnName] = { params, body }
      pc++
      continue
    }

    // Return statement
    if (line.startsWith('return ')) {
      const expr = line.replace('return ', '').trim()
      returnVal = evalExpr(expr).toString()
      break
    }

    // If / else statement: if cond {
    if (line.startsWith('if ') || line === 'if' || line.startsWith('if{')) {
      const condMatch = line.match(/^if\s*(.+?)\s*\{?$/)
      const rawCond = condMatch ? condMatch[1].replace('{', '').trim() : ''
      if (!rawCond) throw new CalcError(`Syntax error on line "${line}": condition required in if statement`)
      const cond = evalCondition(rawCond)

      const ifBody: string[] = []
      const elseBody: string[] = []
      let inElse = false
      pc++

      while (pc < rawLines.length) {
        const cur = rawLines[pc]
        if (cur === '}' || cur.startsWith('} else')) {
          if (cur.includes('else')) {
            inElse = true
            pc++
            continue
          }
          break
        }
        if (inElse) elseBody.push(cur)
        else ifBody.push(cur)
        pc++
      }

      const blockToRun = cond ? ifBody : elseBody
      if (blockToRun.length > 0) {
        const subRes = executeScript(blockToRun.join('\n'), {
          maxSteps: stepRef.max,
          initialScope: Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()])),
          _stepRef: stepRef,
          _recursionDepth: recursionDepth,
          _customFuncs: funcs
        })
        for (const [k, v] of Object.entries(subRes.scope)) {
          scope[k.toLowerCase()] = new Decimal(v)
        }
        if (subRes.returnValue !== '0') {
          returnVal = subRes.returnValue
          break
        }
      }
      pc++
      continue
    }

    // While loop: while cond {
    if (line.startsWith('while ') || line === 'while' || line.startsWith('while{')) {
      const condMatch = line.match(/^while\s*(.+?)\s*\{?$/)
      const rawCond = condMatch ? condMatch[1].replace('{', '').trim() : ''
      if (!rawCond) throw new CalcError(`Syntax error on line "${line}": condition required in while loop`)
      const condStr = rawCond

      const body: string[] = []
      pc++
      while (pc < rawLines.length && rawLines[pc] !== '}') {
        body.push(rawLines[pc])
        pc++
      }

      while (evalCondition(condStr)) {
        incrementStep()
        const subRes = executeScript(body.join('\n'), {
          maxSteps: stepRef.max,
          initialScope: Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, v.toString()])),
          _stepRef: stepRef,
          _recursionDepth: recursionDepth,
          _customFuncs: funcs
        })
        for (const [k, v] of Object.entries(subRes.scope)) {
          scope[k.toLowerCase()] = new Decimal(v)
        }
        if (subRes.returnValue !== '0') {
          returnVal = subRes.returnValue
          break
        }
      }
      pc++
      continue
    }

    // Assignment: var = expr
    if (line.includes('=')) {
      const eqIdx = line.indexOf('=')
      const varName = line.slice(0, eqIdx).trim()
      const expr = line.slice(eqIdx + 1).trim()
      scope[varName.toLowerCase()] = evalExpr(expr)
      pc++
      continue
    }

    pc++
  }

  const finalScope: Record<string, string> = {}
  for (const [k, v] of Object.entries(scope)) {
    finalScope[k] = v.toString()
  }

  return {
    returnValue: returnVal,
    scope: finalScope,
    stepsCount: stepRef.count
  }
}

// Re-export the Phase 9 program tooling (two's complement views, program file
// import/export) so one import site serves the whole module.
export {
  WORD_SIZES, twosView, toSigned, parseProgValue,
  parseProgramFile, serializeProgramFile, programFileLimitBytes,
  type WordSize, type TwosView, type ExportedProgram, type ProgramFile
} from './progTools'
