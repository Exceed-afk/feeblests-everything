import assert from 'node:assert/strict'
import { tokenize } from '../src/shared/calculator/parser/tokenizer'
import { parse } from '../src/shared/calculator/parser/parser'

function testTokenizer() {
  const tokens = tokenize('12.5 + 3.14e-2 * (x - 7)')
  assert.equal(tokens[0].type, 'NUMBER')
  assert.equal(tokens[0].value, '12.5')
  assert.equal(tokens[1].type, 'PLUS')
  assert.equal(tokens[2].type, 'NUMBER')
  assert.equal(tokens[2].value, '3.14e-2')
  assert.equal(tokens[3].type, 'STAR')
  assert.equal(tokens[4].type, 'LPAREN')
  assert.equal(tokens[5].type, 'IDENTIFIER')
  assert.equal(tokens[5].value, 'x')
  assert.equal(tokens[6].type, 'MINUS')
  assert.equal(tokens[7].type, 'NUMBER')
  assert.equal(tokens[8].type, 'RPAREN')
  assert.equal(tokens[9].type, 'EOF')
}

function testParserAST() {
  // Precedence: 2 + 3 * 4 -> 2 + (3 * 4)
  const ast1 = parse('2 + 3 * 4')
  assert.equal(ast1.type, 'BinaryOp')
  if (ast1.type === 'BinaryOp') {
    assert.equal(ast1.operator, '+')
    assert.equal(ast1.left.type, 'Number')
    assert.equal(ast1.right.type, 'BinaryOp')
  }

  // Implicit multiplication: 2(3 + 4)
  const ast2 = parse('2(3 + 4)')
  assert.equal(ast2.type, 'BinaryOp')
  if (ast2.type === 'BinaryOp') {
    assert.equal(ast2.operator, '*')
  }

  // Right-associative exponent: 2 ^ 3 ^ 2 -> 2 ^ (3 ^ 2)
  const ast3 = parse('2 ^ 3 ^ 2')
  assert.equal(ast3.type, 'BinaryOp')
  if (ast3.type === 'BinaryOp') {
    assert.equal(ast3.operator, '^')
    assert.equal(ast3.right.type, 'BinaryOp')
  }

  // Variable assignment: a = 42
  const ast4 = parse('a = 42')
  assert.equal(ast4.type, 'Assignment')
  if (ast4.type === 'Assignment') {
    assert.equal(ast4.name, 'a')
    assert.equal(ast4.value.type, 'Number')
  }

  // Unary minus binds looser than ^ but tighter than * and /
  // -2^2 -> -(2^2)
  const ast5 = parse('-2^2')
  assert.equal(ast5.type, 'UnaryOp')
  if (ast5.type === 'UnaryOp') {
    assert.equal(ast5.operator, '-')
    assert.equal(ast5.operand.type, 'BinaryOp')
    if (ast5.operand.type === 'BinaryOp') {
      assert.equal(ast5.operand.operator, '^')
    }
  }

  // (-2)^2 -> (-2)^2
  const ast6 = parse('(-2)^2')
  assert.equal(ast6.type, 'BinaryOp')
  if (ast6.type === 'BinaryOp') {
    assert.equal(ast6.operator, '^')
    assert.equal(ast6.left.type, 'UnaryOp')
  }
}

testTokenizer()
testParserAST()
console.log('ok   calc-parser tests passed')
