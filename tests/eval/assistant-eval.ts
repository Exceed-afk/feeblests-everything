import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ASSISTANT_SYSTEM_PROMPT, ASSISTANT_USER_PROMPT, cleanModelText, parseAssistantReply } from '../../src/shared/assistant'

type EvalCase = {
  category: string
  question: string
  expected: {
    function: string
    range?: string | { kind: string; n?: number }
    filters?: Record<string, string>
    compare?: 'previous' | null
    limit?: number
  }
}

type CategorySummary = { passed: number; total: number }

const cases = JSON.parse(readFileSync(resolve(__dirname, 'cases.json'), 'utf8')) as EvalCase[]
const requiredEnv = ['EVAL_URL', 'EVAL_MODEL', 'EVAL_KEY'] as const
const missingEnv = requiredEnv.filter((key) => !process.env[key])
if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}.`)
  console.error('Example: EVAL_URL=https://api.openai.com/v1 EVAL_MODEL=gpt-4o-mini EVAL_KEY=... npm run eval:assistant')
  process.exit(1)
}

const summarizeRange = (expectedRange: EvalCase['expected']['range']): string | undefined => {
  if (!expectedRange) return undefined
  if (typeof expectedRange === 'string') return expectedRange
  return expectedRange.kind
}

const categoryTotals = new Map<string, CategorySummary>()
for (const item of cases) {
  const previous = categoryTotals.get(item.category) ?? { passed: 0, total: 0 }
  previous.total += 1
  categoryTotals.set(item.category, previous)
}

const endpoint = process.env.EVAL_URL!.replace(/\/+$/, '')
let overallPasses = 0
let overallTotal = 0

for (const item of cases) {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.EVAL_KEY!}`
    },
    body: JSON.stringify({
      model: process.env.EVAL_MODEL!,
      messages: [
        { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
        { role: 'user', content: ASSISTANT_USER_PROMPT(item.question, '2026-10-15') }
      ],
      temperature: 0
    }),
    redirect: 'error'
  })

  if (!response.ok) {
    console.error(`${item.category}: provider request failed (${response.status} ${response.statusText})`)
    process.exitCode = 1
    break
  }

  const data = await response.json() as { choices?: { message?: { content?: unknown } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    console.error(`${item.category}: provider returned no text`)
    process.exitCode = 1
    break
  }

  const cleaned = cleanModelText(content)
  if (!cleaned.ok) {
    console.error(`${item.category}: model text could not be cleaned (${cleaned.error})`)
    process.exitCode = 1
    break
  }

  const parsed = parseAssistantReply(cleaned.text)
  if (!parsed.ok) {
    console.error(`${item.category}: parse failed (${parsed.error})`)
    process.exitCode = 1
    break
  }

  const call = parsed.call
  const expected = item.expected
  let pass = true
  const reasons: string[] = []

  if (call.kind === 'none') {
    if (expected.function !== 'cannot_answer') {
      pass = false
      reasons.push(`expected ${expected.function}, received cannot_answer`)
    }
  } else {
    if (call.functionName !== expected.function) {
      pass = false
      reasons.push(`function ${call.functionName} !== ${expected.function}`)
    }
    const expectedRange = summarizeRange(expected.range)
    if (expectedRange && call.rangeSpec.kind !== expectedRange) {
      pass = false
      reasons.push(`range ${call.rangeSpec.kind} !== ${expectedRange}`)
    }
    if (typeof expected.range !== 'string' && expected.range && 'n' in expected.range) {
      if (call.rangeSpec.kind === 'last_n_days' && call.rangeSpec.n !== expected.range.n) {
        pass = false
        reasons.push(`last_n_days ${call.rangeSpec.n} !== ${expected.range.n}`)
      }
    }
    const expectedFilters = expected.filters ?? {}
    const actualFilters = call.filters ?? {}
    const actualKeys = Object.keys(actualFilters)
    const expectedKeys = Object.keys(expectedFilters)
    if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => actualFilters[key as keyof typeof actualFilters] !== expectedFilters[key])) {
      pass = false
      reasons.push(`filters ${JSON.stringify(actualFilters)} !== ${JSON.stringify(expectedFilters)}`)
    }
    if (expected.compare !== undefined && call.compare !== expected.compare) {
      pass = false
      reasons.push(`compare ${call.compare ?? 'null'} !== ${expected.compare ?? 'null'}`)
    }
    if (expected.limit !== undefined && (call.limit ?? 3) !== expected.limit) {
      pass = false
      reasons.push(`limit ${(call.limit ?? 3)} !== ${expected.limit}`)
    }
  }

  overallTotal += 1
  const currentCategory = categoryTotals.get(item.category)!
  if (pass) {
    currentCategory.passed += 1
    overallPasses += 1
  } else {
    console.error(`${item.category}: ${item.question}`)
    console.error(`  ${reasons.join('; ')}`)
  }
}

for (const [category, summary] of [...categoryTotals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const rate = summary.total === 0 ? 0 : (summary.passed / summary.total) * 100
  console.log(`${category}: ${summary.passed}/${summary.total} (${rate.toFixed(1)}%)`)
}

const overallRate = overallTotal === 0 ? 0 : (overallPasses / overallTotal) * 100
console.log(`overall: ${overallPasses}/${overallTotal} (${overallRate.toFixed(1)}%)`)

if (process.exitCode) {
  process.exit(process.exitCode)
}
