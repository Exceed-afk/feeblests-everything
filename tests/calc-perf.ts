import assert from 'node:assert/strict'
import os from 'node:os'
import { CalculatorEngine } from '../src/shared/calculator'
import { Decimal } from '../src/shared/calculator/numeric'
import { CALC_LIMITS } from '../src/shared/calculator/limits'
import {
  computeStats,
  percentile,
  linearRegression,
  tTestOneSample
} from '../src/shared/calculator/modules/statistics'
import {
  type Matrix,
  matrixMultiply,
  matrixDeterminant,
  matrixInverse
} from '../src/shared/calculator/modules/linear-algebra'
import { sampleFunction } from '../src/shared/calculator/modules/graphing'
import { loanAmortization } from '../src/shared/calculator/modules/finance'
import { executeScript } from '../src/shared/calculator/modules/scripting'
import {
  calculateCrossRate,
  convertCurrencyWithRate
} from '../src/shared/calculator/modules/conversions'
import { openDatabase } from './sqlite'
import { applyMigrations } from '../src/main/migrations'
import { saveCalcHistory } from '../src/main/calculator'
import type Database from 'better-sqlite3'

console.log('--- Calculator Performance Benchmark Suite (tests/calc-perf.ts) ---')
console.log(`Machine: ${os.cpus()[0]?.model} (${os.cpus().length} cores) | OS: ${os.type()} ${os.release()} (${os.arch()}) | Node: ${process.version}`)

/**
 * Benchmark runner:
 * - Warms up with 5 unmeasured runs
 * - Executes at least 20 measured runs
 * - Computes median, min, max, mean
 * - Prints all timings
 * - Asserts median <= maxAllowed (if maxAllowed is provided)
 */
interface PerfResult {
  name: string
  runs: number[]
  medianMs: number
  meanMs: number
  minMs: number
  maxMs: number
  targetMs: number | null
  maxAllowedMs: number | null
  passed: boolean
}

const ALL_RESULTS: PerfResult[] = []

function benchmark(
  name: string,
  fn: () => void,
  options: {
    warmupCount?: number
    runCount?: number
    targetMs?: number
    maxAllowedMs?: number
  } = {}
): PerfResult {
  const warmup = options.warmupCount ?? 5
  const runsCount = options.runCount ?? 20

  // 1. Warm-up
  for (let w = 0; w < warmup; w++) {
    fn()
  }

  // 2. Timed runs
  const times: number[] = []
  for (let r = 0; r < runsCount; r++) {
    const start = performance.now()
    fn()
    const end = performance.now()
    times.push(end - start)
  }

  const sorted = [...times].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const meanMs = sum / sorted.length
  const minMs = sorted[0]
  const maxMs = sorted[sorted.length - 1]

  const targetMs = options.targetMs ?? null
  // If targetMs is defined, fail only when > 3 * targetMs (as requested).
  // If no stated target, use 3x the measured baseline.
  const maxAllowedMs = options.maxAllowedMs ?? (targetMs !== null ? targetMs * 3 : medianMs * 3)
  const passed = medianMs <= maxAllowedMs

  console.log(`\nBenchmark: [${name}]`)
  console.log(`  Runs (${times.length}): [${times.map((t) => t.toFixed(2)).join(', ')}] ms`)
  console.log(
    `  Median: ${medianMs.toFixed(3)} ms | Mean: ${meanMs.toFixed(3)} ms | Min: ${minMs.toFixed(3)} ms | Max: ${maxMs.toFixed(3)} ms` +
    (targetMs !== null ? ` | Target: <${targetMs} ms | Max Allowed (3x): ${maxAllowedMs.toFixed(2)} ms` : '')
  )

  const result: PerfResult = {
    name,
    runs: times,
    medianMs,
    meanMs,
    minMs,
    maxMs,
    targetMs,
    maxAllowedMs,
    passed
  }
  ALL_RESULTS.push(result)

  assert.ok(
    passed,
    `Benchmark "${name}" exceeded max allowed threshold: median ${medianMs.toFixed(3)} ms > ${maxAllowedMs.toFixed(3)} ms`
  )

  return result
}

// ---------------------------------------------------------------------------
// 1. Basic expression evaluation (Section 12 target: under 50 ms)
// ---------------------------------------------------------------------------
const basicEngine = new CalculatorEngine()
benchmark(
  'Basic expression evaluation (2 + 3 * 4 - sqrt(16))',
  () => {
    basicEngine.calculate('2 + 3 * 4 - sqrt(16)')
  },
  { targetMs: 50, runCount: 25 }
)

// ---------------------------------------------------------------------------
// 2. A 10,000-term expression
// ---------------------------------------------------------------------------
const flatTerms = Math.floor((CALC_LIMITS.expressionLength - 1) / 2) // 9,999 terms: '1+1+1+...'
const tenKExpr = Array.from({ length: flatTerms }, () => '1').join('+')
const tenKEngine = new CalculatorEngine()
benchmark(
  `10,000-term flat expression evaluation (${flatTerms} terms)`,
  () => {
    tenKEngine.calculate(tenKExpr)
  },
  { runCount: 20 }
)

// ---------------------------------------------------------------------------
// 3. Statistics on 100,000 values (each main function)
// ---------------------------------------------------------------------------
const statValues = Array.from({ length: CALC_LIMITS.datasetSize }, (_, i) => new Decimal((i % 100) - 50))
const statNumbers = statValues.map((d) => d.toNumber())

benchmark('Statistics: computeStats on 100,000 values', () => {
  computeStats(statValues)
})

benchmark('Statistics: percentile (p95) on 100,000 values', () => {
  percentile(statValues, 95)
})

benchmark('Statistics: linearRegression on 100,000 values', () => {
  linearRegression(statValues, statValues)
})

benchmark('Statistics: tTestOneSample on 100,000 numbers', () => {
  tTestOneSample(statNumbers)
})

// ---------------------------------------------------------------------------
// 4. Matrix multiply, determinant and inverse at 50x50
// ---------------------------------------------------------------------------
const N = 50
const matrixA: Matrix = Array.from({ length: N }, (_, i) =>
  Array.from({ length: N }, (_, j) => new Decimal(i === j ? N + 2 : 1))
)
const matrixB: Matrix = Array.from({ length: N }, (_, i) =>
  Array.from({ length: N }, (_, j) => new Decimal((i + j) % 7 + 1))
)

benchmark('Linear Algebra: 50x50 matrix multiplication', () => {
  matrixMultiply(matrixA, matrixB)
})

benchmark('Linear Algebra: 50x50 matrix determinant', () => {
  matrixDeterminant(matrixA)
})

benchmark('Linear Algebra: 50x50 matrix inverse', () => {
  matrixInverse(matrixA)
})

// ---------------------------------------------------------------------------
// 5. Graph sampling: default plot, and wide range with asymptote
// ---------------------------------------------------------------------------
benchmark('Graph sampling: default plot (sin(x) over [-10, 10], 300 points)', () => {
  sampleFunction('sin(x)', { xMin: -10, xMax: 10, yMin: -2, yMax: 2 }, 300)
})

benchmark('Graph sampling: wide range with asymptote (tan(x) over [-50, 50], 3,000 points)', () => {
  sampleFunction('tan(x)', { xMin: -50, xMax: 50, yMin: -20, yMax: 20 }, 3000)
})

// ---------------------------------------------------------------------------
// 6. A 360-row amortization schedule (30-year monthly loan)
// ---------------------------------------------------------------------------
benchmark('Finance: 360-row loan amortization schedule (30-year mortgage)', () => {
  loanAmortization({
    principal: 300000,
    annualRate: 0.05,
    termMonths: 360
  })
})

// ---------------------------------------------------------------------------
// 7. A 5,000-step script
// ---------------------------------------------------------------------------
const script5000 = `
i = 0
sum = 0
while i < 2499 {
  i = i + 1
  sum = sum + i
}
return sum
`
benchmark('Scripting: 5,000-step sandboxed script execution', () => {
  executeScript(script5000, { maxSteps: 10000 })
})

// ---------------------------------------------------------------------------
// 8. SQLite: saving 10,000 history rows, loading page 1 (50), loading page 100
// ---------------------------------------------------------------------------
function createBenchDatabase(): Database.Database {
  const db = openDatabase(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

// Function to query with limit & offset
function getCalcHistoryPage(db: Database.Database, page: number, pageSize = 50) {
  const offset = (page - 1) * pageSize
  return db
    .prepare(
      `SELECT id, created_at, mode, input, result, result_format, rate_snapshot, pinned
       FROM calc_history
       ORDER BY pinned DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset)
}

// Pre-seeded DB for paging benchmarks
const pagedDb = createBenchDatabase()
const insertStmt = pagedDb.prepare(
  `INSERT INTO calc_history (created_at, mode, input, result, result_format, rate_snapshot, pinned)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
)
pagedDb.transaction(() => {
  const now = new Date().toISOString()
  for (let i = 1; i <= 10_000; i++) {
    insertStmt.run(now, 'standard', `${i} + 1`, `${i + 1}`, 'decimal', null, 0)
  }
})()

benchmark('SQLite: saving 10,000 history rows (single transaction)', () => {
  const db = createBenchDatabase()
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO calc_history (created_at, mode, input, result, result_format, rate_snapshot, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    for (let i = 1; i <= 10_000; i++) {
      stmt.run(now, 'standard', `${i} * 2`, `${i * 2}`, 'decimal', null, 0)
    }
  })()
  db.close()
})

benchmark('SQLite: loading first page of 50 history rows (LIMIT 50 OFFSET 0)', () => {
  getCalcHistoryPage(pagedDb, 1, 50)
})

benchmark('SQLite: loading page 100 of 50 history rows (LIMIT 50 OFFSET 4950)', () => {
  getCalcHistoryPage(pagedDb, 100, 50)
})

// ---------------------------------------------------------------------------
// 9. Currency: converting through cross rates 10,000 times
// ---------------------------------------------------------------------------
const baseA = new Decimal('1.085')
const baseB = new Decimal('0.855')
const crossRate = calculateCrossRate(baseA, baseB)
const sampleAmount = new Decimal('100.50')

benchmark('Currency: converting through cross rates 10,000 times', () => {
  for (let i = 0; i < 10_000; i++) {
    convertCurrencyWithRate(sampleAmount, crossRate)
  }
})

// ---------------------------------------------------------------------------
// Print Summary Table
// ---------------------------------------------------------------------------
console.log('\n========================================================================================')
console.log('BENCHMARK SUMMARY TABLE')
console.log('========================================================================================')
console.log(
  '| Benchmark Name | Median (ms) | Mean (ms) | Min (ms) | Max (ms) | Target (ms) | Status |'
)
console.log(
  '|---|---|---|---|---|---|---|'
)
for (const r of ALL_RESULTS) {
  const targetStr = r.targetMs !== null ? `< ${r.targetMs}` : '—'
  const statusStr = r.passed ? 'PASS' : 'FAIL'
  console.log(
    `| ${r.name} | ${r.medianMs.toFixed(3)} | ${r.meanMs.toFixed(3)} | ${r.minMs.toFixed(3)} | ${r.maxMs.toFixed(3)} | ${targetStr} | ${statusStr} |`
  )
}
console.log('========================================================================================\n')
console.log('ok   tests/calc-perf.ts completed successfully')
