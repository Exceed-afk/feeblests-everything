// Compare the old Tools-hub calculators (src/shared/calculators.ts, tools-math.ts)
// with the new calculator core (src/shared/calculator/modules/*).
import { loanPayment, compoundInterest, tipSplit, percentOf, percentChange, asPercentage, convertUnit, convertCurrency, dateDifferenceDays, calculateAge } from '../src/shared/calculators'
import { calculateLoan, monthlyPayment } from '../src/shared/tools-math'
import { tvm, compoundInterest as newCompound } from '../src/shared/calculator/modules/finance/index'
import { convertUnit as newConvert, UNIT_CATEGORIES } from '../src/shared/calculator/modules/conversions/index'
import { dateDifference, calculateAgeDetailed } from '../src/shared/calculator/modules/datetime/index'
import { CalculatorEngine } from '../src/shared/calculator'
import { Decimal } from '../src/shared/calculator/numeric'

const eq = (a: unknown, b: unknown, dp = 10): boolean => {
  const na = Number(a); const nb = Number(b)
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b)
  return na.toFixed(dp) === nb.toFixed(dp)
}

console.log('=== loanPayment vs tvm(pmt) vs monthlyPayment ===')
for (const [p, r, n] of [[200000, 5.25, 360], [10000, 0, 24], [5000, 12, 12], [150000, 6.75, 300]] as const) {
  const old = loanPayment(p, r, n)
  const t = tvm({ pv: new Decimal(p), rate: new Decimal(r / 100 / 12), nper: new Decimal(n), fv: new Decimal(0) })
  const tm = monthlyPayment(Math.round(p * 100), r, n)
  console.log(`loan ${p} @ ${r}% / ${n}mo | old=${old} | new tvm pmt=${t.pmt.toString()} | tools-math cents=${tm} ($${(tm / 100).toFixed(2)}) | same(old,tvm)=${eq(old, t.pmt)}`)
}

console.log('\n=== compoundInterest old vs new ===')
for (const [p, r, y, m] of [[1000, 5, 10, 12], [2500, 3.75, 7, 4], [10000, 6, 5, 1]] as const) {
  const o = compoundInterest(p, r, y, m)
  const n = newCompound(p, r / 100, y, m)
  console.log(`${p} @ ${r}% / ${y}y / ${m}/y | old total=${o!.total} | new total=${n.total.toString()} | same=${eq(o!.total, n.total)} | diff=${Number(n.total) - o!.total}`)
}

console.log('\n=== tipSplit / percentOf / percentChange / asPercentage vs expression bar ===')
const engine = new CalculatorEngine()
console.log('tipSplit(85.40, 18, 3):', tipSplit(85.40, 18, 3))
console.log('percentOf(250, 15) =', percentOf(250, 15), '| expr "250 * 15%" =', engine.calculate('250 * 15%').value?.toString())
console.log('percentChange(80, 100) =', percentChange(80, 100), '| expr "(100-80)/80*100" =', engine.calculate('(100-80)/80*100').value?.toString())
console.log('asPercentage(3, 8) =', asPercentage(3, 8), '| expr "3/8*100" =', engine.calculate('3/8*100').value?.toString())

console.log('\n=== convertUnit old vs new ===')
const catMap: Record<string, string> = { length: 'length', mass: 'mass', volume: 'volume', area: 'area', speed: 'speed' }
const unitMap: Record<string, Record<string, string>> = {
  length: { m: 'm', km: 'km', ft: 'ft', mi: 'mi', in: 'in' },
  mass: { kg: 'kg', lb: 'lb', g: 'g', oz: 'oz' },
  volume: { l: 'l', gal: 'gal', cup: 'cup' },
  area: { m2: 'm2', sqft: 'sqft', acre: 'acre' },
}
for (const [cat, pairs] of Object.entries(unitMap)) {
  for (const [oid, nid] of Object.entries(pairs)) {
    if (oid === nid) continue
    const o = convertUnit(1, cat as any, oid, nid)
    const n = newConvert(1, cat, nid, oid) // new converts TO base; compute inverse manually
    // do direct both directions instead:
    const nDirect = newConvert(1, cat, nid, oid)
    console.log(`1 ${nid} -> ${oid} [${cat}] | old=${o} | new=${nDirect} | same=${eq(o, nDirect)}`)
    void n
  }
}
console.log('categories only in new:', Object.keys(UNIT_CATEGORIES).join(', '))

console.log('\n=== convertCurrency old vs new ===')
console.log('old convertCurrency(100, 1.0875):', convertCurrency(100, 1.0875))
console.log('new convertCurrencyWithRate(100, 1.0875):', new (Decimal)(100).times(new Decimal('1.0875')).toString())

console.log('\n=== date difference old vs new ===')
for (const [a, b] of [['2024-01-01', '2024-12-31'], ['2020-02-29', '2021-02-28'], ['1990-06-15', '2026-11-05']] as const) {
  const o = dateDifferenceDays(a, b)
  const n = dateDifference(a, b)
  console.log(`${a} .. ${b} | old days=${o} | new days=${n.days} (y=${n.years} m=${n.months} d=${n.daysRemainder}) | daysSame=${o === n.days}`)
}

console.log('\n=== age old vs new ===')
for (const [b, a] of [['1990-06-15', '2026-11-05'], ['2000-02-29', '2024-02-28'], ['2000-02-29', '2024-03-01']] as const) {
  const o = calculateAge(b, a)
  const n = calculateAgeDetailed(b, a)
  const same = o && o.years === n.years && o.months === n.months && o.days === n.days
  console.log(`born ${b} as of ${a} | old=${o.years}y ${o.months}m ${o.days}d | new=${n.years}y ${n.months}m ${n.days}d | same=${same}`)
}

console.log('\n=== tools-math amortize vs finance tvm/loan ===')
const loan = calculateLoan({ principalCents: 20000000, annualRatePercent: 5.25, termMonths: 360 }, '2026-01-01')
console.log('tools-math monthlyPaymentCents:', loan.monthlyPaymentCents, 'totalInterestCents:', loan.totalInterestCents)
const t = tvm({ pv: 200000, rate: 5.25 / 100 / 12, nper: 360, fv: 0 })
console.log('new tvm pmt:', t.pmt.toString(), '=> cents', t.pmt.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString())

console.log('\n=== validation differences (invalid inputs) ===')
console.log('old loanPayment(-1, 5, 12):', loanPayment(-1, 5, 12), '(null)')
try { tvm({ pv: -1, rate: 0.05 / 12, nper: 12 }) } catch (e: any) { console.log('  new tvm pv=-1 throws:', e.message) }
console.log('old convertUnit(1, "length", "mi", "nmi"):', convertUnit(1, 'length', 'mi', 'nmi'), '(null)')
try { newConvert(1, 'length', 'mi', 'nmi') } catch (e: any) { console.log('  new convertUnit mi->nmi throws:', e.message) }
console.log('old convertUnit(1, temperature, f, k) -50F:', convertUnit(-50, 'temperature', 'f', 'k'), '(null, below 0K)')
