export type TokenType =
  | 'NUMBER'
  | 'IDENTIFIER'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'CARET'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EQUALS'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  pos: number
}

export class TokenizerError extends Error {
  constructor(message: string, public pos: number) {
    super(`${message} at position ${pos}`)
    this.name = 'TokenizerError'
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    const pos = i

    // Number literal: digits, optional decimal point, optional scientific exponent
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      let numStr = ''
      while (i < input.length && /[0-9]/.test(input[i])) {
        numStr += input[i++]
      }
      if (i < input.length && input[i] === '.') {
        numStr += input[i++]
        while (i < input.length && /[0-9]/.test(input[i])) {
          numStr += input[i++]
        }
      }
      if (i < input.length && (input[i] === 'e' || input[i] === 'E')) {
        const nextChar = input[i + 1]
        if (/[0-9]/.test(nextChar) || ((nextChar === '+' || nextChar === '-') && /[0-9]/.test(input[i + 2]))) {
          numStr += input[i++] // e
          if (input[i] === '+' || input[i] === '-') {
            numStr += input[i++]
          }
          while (i < input.length && /[0-9]/.test(input[i])) {
            numStr += input[i++]
          }
        }
      }
      tokens.push({ type: 'NUMBER', value: numStr, pos })
      continue
    }

    // Identifier / word (function, variable, or constant)
    if (/[a-zA-Z_π]/.test(ch)) {
      let idStr = ''
      while (i < input.length && /[a-zA-Z0-9_π]/.test(input[i])) {
        idStr += input[i++]
      }
      tokens.push({ type: 'IDENTIFIER', value: idStr, pos })
      continue
    }

    switch (ch) {
      case '+':
        tokens.push({ type: 'PLUS', value: '+', pos })
        i++
        break
      case '-':
        tokens.push({ type: 'MINUS', value: '-', pos })
        i++
        break
      case '*':
      case '×':
        tokens.push({ type: 'STAR', value: '*', pos })
        i++
        break
      case '/':
      case '÷':
        tokens.push({ type: 'SLASH', value: '/', pos })
        i++
        break
      case '%':
        tokens.push({ type: 'PERCENT', value: '%', pos })
        i++
        break
      case '^':
        tokens.push({ type: 'CARET', value: '^', pos })
        i++
        break
      case '(':
        tokens.push({ type: 'LPAREN', value: '(', pos })
        i++
        break
      case ')':
        tokens.push({ type: 'RPAREN', value: ')', pos })
        i++
        break
      case ',':
        tokens.push({ type: 'COMMA', value: ',', pos })
        i++
        break
      case '=':
        tokens.push({ type: 'EQUALS', value: '=', pos })
        i++
        break
      default:
        throw new TokenizerError(`Unexpected character "${ch}"`, pos)
    }
  }

  tokens.push({ type: 'EOF', value: '', pos: input.length })
  return tokens
}
