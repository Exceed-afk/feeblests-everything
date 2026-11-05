// Micro-timing probe: how long do the limits test's timed operations take on this machine now?
import { CalculatorEngine } from '../src/shared/calculator'
import { computeStats } from '../src/shared/calculator/modules/statistics'
import { Decimal } from '../src/shared/calculator/numeric'

const engine = new CalculatorEngine()
const t0 = performance.now()
engine.calculate('9^9^9^9')
console.log('9^9^9^9:', (performance.now() - t0).toFixed(1), 'ms (limit 50)')

const t1 = performance.now()
try {
  computeStats(Array.from({ length: 100_001 }, () => new Decimal(1)))
} catch { /* expected */ }
console.log('100,001 dataset:', (performance.now() - t1).toFixed(1), 'ms (limit 50)')
