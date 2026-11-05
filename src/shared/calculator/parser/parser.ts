import { tokenize, type Token, type TokenType } from './tokenizer'
import { CALC_LIMITS, limitMessage } from '../limits'
import {
  ParserError,
  type ASTNode,
  type AssignmentNode,
  type BinaryOpNode,
  type FunctionCallNode,
  type IdentifierNode,
  type NumberNode,
  type UnaryOpNode
} from './ast'

// Precedence levels for Pratt parsing
const PRECEDENCE = {
  NONE: 0,
  ASSIGNMENT: 1,
  SUM: 2,       // + -
  PRODUCT: 3,   // * / %
  UNARY: 4,     // - + (binds looser than ^ but tighter than * and /)
  EXPONENT: 5,  // ^
  CALL: 6       // f(x)
} as const

export class Parser {
  private tokens: Token[]
  private cursor = 0
  private depth = 0

  constructor(input: string) {
    this.tokens = tokenize(input)
  }

  private peek(): Token {
    return this.tokens[this.cursor] || { type: 'EOF', value: '', pos: this.tokens[this.tokens.length - 1]?.pos || 0 }
  }

  private advance(): Token {
    const t = this.peek()
    if (t.type !== 'EOF') this.cursor++
    return t
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) {
      this.advance()
      return true
    }
    return false
  }

  private expect(type: TokenType, msg?: string): Token {
    const t = this.peek()
    if (t.type !== type) {
      throw new ParserError(msg || `Expected ${type} but got ${t.type}`, t.pos)
    }
    return this.advance()
  }

  parse(): ASTNode {
    if (this.peek().type === 'EOF') {
      throw new ParserError('Empty expression', 0)
    }

    const expr = this.parseExpression(PRECEDENCE.NONE)

    if (this.peek().type !== 'EOF') {
      throw new ParserError(`Unexpected token "${this.peek().value}"`, this.peek().pos)
    }

    return expr
  }

  private parseExpression(rbp: number): ASTNode {
    this.depth++
    try {
      if (this.depth > CALC_LIMITS.nestingDepth) {
        throw new ParserError(limitMessage('nestingDepth', '(the expression is nested too deeply)'), this.peek().pos)
      }
      return this.parseExpressionInner(rbp)
    } finally {
      this.depth--
    }
  }

  private parseExpressionInner(rbp: number): ASTNode {
    let left = this.parsePrefix()

    // Handle implicit multiplication when followed immediately by '(' or an IDENTIFIER or NUMBER
    while (rbp < this.getInfixPrecedence() || this.canImplicitMultiply()) {
      if (this.canImplicitMultiply()) {
        const next = this.peek()
        const right = this.parseExpression(PRECEDENCE.PRODUCT)
        left = {
          type: 'BinaryOp',
          operator: '*',
          left,
          right,
          pos: next.pos
        } as BinaryOpNode
        continue
      }

      left = this.parseInfix(left)
    }

    return left
  }

  private canImplicitMultiply(): boolean {
    const next = this.peek().type
    // If next is LPAREN or NUMBER or IDENTIFIER, we have implicit multiplication (e.g. 2(3), 2x, (2)(3))
    return next === 'LPAREN' || next === 'NUMBER' || next === 'IDENTIFIER'
  }

  private parsePrefix(): ASTNode {
    const token = this.advance()

    switch (token.type) {
      case 'NUMBER':
        return { type: 'Number', value: token.value, pos: token.pos } as NumberNode

      case 'IDENTIFIER': {
        // Check if this is an assignment: variable = expr
        if (this.peek().type === 'EQUALS') {
          this.advance() // consume '='
          const value = this.parseExpression(PRECEDENCE.ASSIGNMENT)
          return {
            type: 'Assignment',
            name: token.value,
            value,
            pos: token.pos
          } as AssignmentNode
        }

        // Check if this is a function call: fn(arg1, arg2)
        if (this.peek().type === 'LPAREN') {
          this.advance() // consume '('
          const args: ASTNode[] = []
          if (this.peek().type !== 'RPAREN') {
            do {
              args.push(this.parseExpression(PRECEDENCE.NONE))
            } while (this.match('COMMA'))
          }
          this.expect('RPAREN', `Expected ')' after function arguments`)
          return {
            type: 'FunctionCall',
            name: token.value,
            args,
            pos: token.pos
          } as FunctionCallNode
        }

        return { type: 'Identifier', name: token.value, pos: token.pos } as IdentifierNode
      }

      case 'PLUS':
      case 'MINUS': {
        const operand = this.parseExpression(PRECEDENCE.UNARY)
        return {
          type: 'UnaryOp',
          operator: token.type === 'PLUS' ? '+' : '-',
          operand,
          pos: token.pos
        } as UnaryOpNode
      }

      case 'LPAREN': {
        const expr = this.parseExpression(PRECEDENCE.NONE)
        this.expect('RPAREN', `Expected ')' to close parenthesis`)
        return expr
      }

      default:
        throw new ParserError(`Unexpected token "${token.value}"`, token.pos)
    }
  }

  private getInfixPrecedence(): number {
    switch (this.peek().type) {
      case 'PLUS':
      case 'MINUS':
        return PRECEDENCE.SUM
      case 'STAR':
      case 'SLASH':
      case 'PERCENT':
        return PRECEDENCE.PRODUCT
      case 'CARET':
        return PRECEDENCE.EXPONENT
      default:
        return PRECEDENCE.NONE
    }
  }

  private parseInfix(left: ASTNode): ASTNode {
    const token = this.advance()
    const op = token.value as '+' | '-' | '*' | '/' | '^' | '%'

    // Exponentiation (^) is right-associative; all others are left-associative
    const nextPrecedence = op === '^' ? PRECEDENCE.EXPONENT - 1 : this.getInfixPrecedenceFor(op)
    const right = this.parseExpression(nextPrecedence)

    return {
      type: 'BinaryOp',
      operator: op,
      left,
      right,
      pos: token.pos
    } as BinaryOpNode
  }

  private getInfixPrecedenceFor(op: string): number {
    switch (op) {
      case '+':
      case '-':
        return PRECEDENCE.SUM
      case '*':
      case '/':
      case '%':
        return PRECEDENCE.PRODUCT
      case '^':
        return PRECEDENCE.EXPONENT
      default:
        return PRECEDENCE.NONE
    }
  }
}

export function parse(input: string): ASTNode {
  if (input.length > CALC_LIMITS.expressionLength) {
    throw new ParserError(
      `${limitMessage('expressionLength', 'characters')} (this one has ${input.length.toLocaleString('en-US')})`,
      CALC_LIMITS.expressionLength
    )
  }
  return new Parser(input).parse()
}
