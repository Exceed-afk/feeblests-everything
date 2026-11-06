import { CalcError } from '../errors'

export type ASTNode =
  | NumberNode
  | IdentifierNode
  | UnaryOpNode
  | BinaryOpNode
  | PercentSuffixNode
  | FunctionCallNode
  | AssignmentNode
  | CurrencyConversionNode

/**
 * `100 USD to EUR` / `100 usd in eur`: convert the value of `amount` from one
 * currency to another. `to` and `in` are only keywords in this position (after a
 * value and a 3-5 character code), so they never clash with function or variable
 * names. The conversion itself is the Convert panel's own code (rates.ts).
 */
export interface CurrencyConversionNode {
  type: 'CurrencyConversion'
  amount: ASTNode
  from: string
  to: string
  pos: number
}

/**
 * A postfix percent, e.g. `50%` in `50%` or in `200 + 10%`.
 * Google-style semantics are applied at evaluation time (see the evaluator):
 * - standalone or after * /: divides by 100 (50% = 0.5, 50 * 10% = 5)
 * - after `a + b%`: adds a x b/100 (200 + 10% = 220)
 * - after `a - b%`: subtracts a x b/100 (200 - 10% = 180)
 */
export interface PercentSuffixNode {
  type: 'PercentSuffix'
  operand: ASTNode
  pos: number
}

export interface NumberNode {
  type: 'Number'
  value: string
  pos: number
}

export interface IdentifierNode {
  type: 'Identifier'
  name: string
  pos: number
}

export interface UnaryOpNode {
  type: 'UnaryOp'
  operator: '+' | '-'
  operand: ASTNode
  pos: number
}

export interface BinaryOpNode {
  type: 'BinaryOp'
  operator: '+' | '-' | '*' | '/' | '^' | '%'
  left: ASTNode
  right: ASTNode
  pos: number
}

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: ASTNode[]
  pos: number
}

export interface AssignmentNode {
  type: 'Assignment'
  name: string
  value: ASTNode
  pos: number
}

export class ParserError extends CalcError {
  constructor(message: string, public pos: number) {
    super(`${message} at position ${pos}`, 'CALC_PARSE')
    this.name = 'ParserError'
  }
}
