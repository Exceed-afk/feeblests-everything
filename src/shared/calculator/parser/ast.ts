import { CalcError } from '../errors'

export type ASTNode =
  | NumberNode
  | IdentifierNode
  | UnaryOpNode
  | BinaryOpNode
  | FunctionCallNode
  | AssignmentNode

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
