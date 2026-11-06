import { Decimal } from '../../numeric'
import { registry } from '../../registry'
import {
  toDecimalInput,
  toPositiveInput,
  toNonNegativeInput,
  toIntegerInput,
  toStringInput,
  describe
} from '../../inputs'
import { CalcError } from '../../errors'

/** Loan terms beyond 100 years are a typo, and an amortization table that long is unusable. */
const MAX_LOAN_MONTHS = 1_200

function toCount(value: unknown, what: string, max = Number.MAX_SAFE_INTEGER): number {
  return toIntegerInput(value, what, { min: 0, max })
}

function toTermMonths(value: unknown): number {
  const n = toIntegerInput(value, 'termMonths', { min: 1 })
  if (n > MAX_LOAN_MONTHS) {
    throw new CalcError(`termMonths is limited to ${MAX_LOAN_MONTHS.toLocaleString('en-US')} months`)
  }
  return n
}

/** ISO dates only, so "2024-13-45" or a locale string is rejected instead of becoming NaN. */
function toDateString(value: unknown, what: string): string {
  const text = toStringInput(value, what)
  const ms = new Date(text).getTime()
  if (!Number.isFinite(ms)) throw new CalcError(`${what} must be a date (got "${text}")`)
  return text
}

// Time Value of Money parameters
export interface TvmParams {
  nper?: Decimal | string | number
  rate?: Decimal | string | number // periodic interest rate (e.g. 0.05 for 5%)
  pv?: Decimal | string | number
  pmt?: Decimal | string | number
  fv?: Decimal | string | number
  type?: 0 | 1 | string | number // 0 = end of period (ordinary annuity, default), 1 = beginning (annuity due)
}

export interface TvmResult {
  nper: Decimal
  rate: Decimal
  pv: Decimal
  pmt: Decimal
  fv: Decimal
}

/**
 * Standard TVM equation:
 * PV * (1 + r)^n + PMT * (1 + r * type) * ((1 + r)^n - 1) / r + FV = 0 (when r != 0)
 * When r == 0: PV + PMT * n + FV = 0
 */
export function tvm(params: TvmParams): TvmResult {
  if (!params || typeof params !== 'object') {
    throw new CalcError(`tvm expects an object of known values (got ${describe(params)})`)
  }
  // Every supplied value is checked up front: the solver itself then only sees Decimals.
  const number = (value: unknown, what: string): Decimal | undefined =>
    value === undefined ? undefined : toDecimalInput(value, what)
  const known = {
    nper: number(params.nper, 'nper'),
    rate: number(params.rate, 'rate'),
    pv: number(params.pv, 'pv'),
    pmt: number(params.pmt, 'pmt'),
    fv: number(params.fv, 'fv')
  }
  if (known.nper !== undefined && (known.nper.isNegative() || !known.nper.isFinite())) {
    throw new CalcError('nper must be zero or greater')
  }
  if (known.rate !== undefined && known.rate.lte(-1)) {
    throw new CalcError('rate must be greater than -100% (the balance never reaches zero below that)')
  }
  const rawType = params.type === undefined ? 0 : toIntegerInput(params.type, 'type', { min: 0, max: 1 })
  const type = (rawType === 1 ? 1 : 0) as 0 | 1
  const typeDec = new Decimal(type)

  const hasNper = known.nper !== undefined
  const hasRate = known.rate !== undefined
  const hasPv = known.pv !== undefined
  const hasPmt = known.pmt !== undefined
  const hasFv = known.fv !== undefined

  const countProvided = [hasNper, hasRate, hasPv, hasPmt, hasFv].filter(Boolean).length
  if (countProvided < 4) {
    throw new CalcError('TVM solver requires at least 4 known values out of NPER, RATE, PV, PMT, FV')
  }

  // 1. Solve for FV
  if (!hasFv) {
    const n = known.nper!
    const r = known.rate!
    const p = known.pv!
    const m = known.pmt!

    let f: Decimal
    if (r.isZero()) {
      f = p.plus(m.times(n)).neg()
    } else {
      const rn = r.plus(1).pow(n)
      const pmtFactor = m.times(r.times(typeDec).plus(1)).times(rn.minus(1)).dividedBy(r)
      f = p.times(rn).plus(pmtFactor).neg()
    }
    return { nper: n, rate: r, pv: p, pmt: m, fv: f }
  }

  // 2. Solve for PV
  if (!hasPv) {
    const n = known.nper!
    const r = known.rate!
    const m = known.pmt!
    const f = known.fv!

    let p: Decimal
    if (r.isZero()) {
      p = f.plus(m.times(n)).neg()
    } else {
      const rn = r.plus(1).pow(n)
      const pmtFactor = m.times(r.times(typeDec).plus(1)).times(rn.minus(1)).dividedBy(r)
      p = f.plus(pmtFactor).neg().dividedBy(rn)
    }
    return { nper: n, rate: r, pv: p, pmt: m, fv: f }
  }

  // 3. Solve for PMT
  if (!hasPmt) {
    const n = known.nper!
    const r = known.rate!
    const p = known.pv!
    const f = known.fv!

    let m: Decimal
    if (r.isZero()) {
      m = p.plus(f).neg().dividedBy(n)
    } else {
      const rn = r.plus(1).pow(n)
      const denom = r.times(typeDec).plus(1).times(rn.minus(1)).dividedBy(r)
      m = p.times(rn).plus(f).neg().dividedBy(denom)
    }
    return { nper: n, rate: r, pv: p, pmt: m, fv: f }
  }

  // 4. Solve for NPER
  if (!hasNper) {
    const r = known.rate!
    const p = known.pv!
    const m = known.pmt!
    const f = known.fv!

    let n: Decimal
    if (r.isZero()) {
      if (m.isZero()) throw new Error('Cannot solve for NPER when PMT and RATE are both zero')
      n = p.plus(f).neg().dividedBy(m)
    } else {
      const z = m.times(r.times(typeDec).plus(1)).dividedBy(r)
      const num = z.minus(f)
      const den = p.plus(z)
      if (num.dividedBy(den).isNegative() || num.dividedBy(den).isZero()) {
        throw new Error('No real solution for NPER with these values')
      }
      n = num.dividedBy(den).ln().dividedBy(r.plus(1).ln())
    }
    return { nper: n, rate: r, pv: p, pmt: m, fv: f }
  }

  // 5. Solve for RATE (Newton-Raphson method)
  if (!hasRate) {
    const n = known.nper!
    const p = known.pv!
    const m = known.pmt!
    const f = known.fv!

    // Function f(r)
    const evalTvm = (r: Decimal): Decimal => {
      if (r.isZero()) return p.plus(m.times(n)).plus(f)
      const rn = r.plus(1).pow(n)
      const pmtFactor = m.times(r.times(typeDec).plus(1)).times(rn.minus(1)).dividedBy(r)
      return p.times(rn).plus(pmtFactor).plus(f)
    }

    let r = new Decimal(0.05) // initial guess 5%
    for (let iter = 0; iter < 100; iter++) {
      const y = evalTvm(r)
      if (y.abs().lessThan('1e-12')) break
      const dr = new Decimal('1e-6')
      const dy = evalTvm(r.plus(dr)).minus(y).dividedBy(dr)
      if (dy.isZero()) break
      const nextR = r.minus(y.dividedBy(dy))
      if (nextR.minus(r).abs().lessThan('1e-14')) {
        r = nextR
        break
      }
      r = nextR
    }
    return { nper: n, rate: r, pv: p, pmt: m, fv: f }
  }

  return {
    nper: known.nper!,
    rate: known.rate!,
    pv: known.pv!,
    pmt: known.pmt!,
    fv: known.fv!
  }
}

// ---------- Loan & Mortgage Amortization ----------

export interface AmortizationRow {
  period: number
  payment: Decimal
  principalPaid: Decimal
  interestPaid: Decimal
  extraPaid: Decimal
  remainingBalance: Decimal
}

export interface AmortizationSchedule {
  monthlyPayment: Decimal
  totalPayment: Decimal
  totalInterest: Decimal
  periodsCount: number
  schedule: AmortizationRow[]
}

export interface LoanParams {
  principal: Decimal | string | number
  annualRate: Decimal | string | number // e.g. 0.06 for 6%
  termMonths: number | string
  extraPayment?: Decimal | string | number
}

export function loanAmortization(params: LoanParams): AmortizationSchedule {
  if (!params || typeof params !== 'object') {
    throw new CalcError(`loanAmortization expects an object (got ${describe(params)})`)
  }
  const p = toPositiveInput(params.principal, 'principal')
  const rAnnual = toNonNegativeInput(params.annualRate, 'annualRate')
  const n = toTermMonths(params.termMonths)
  const extra = params.extraPayment === undefined ? new Decimal(0) : toNonNegativeInput(params.extraPayment, 'extraPayment')

  const monthlyRate = rAnnual.dividedBy(12)

  let pmt: Decimal
  if (monthlyRate.isZero()) {
    pmt = p.dividedBy(n)
  } else {
    const factor = monthlyRate.plus(1).pow(n)
    pmt = p.times(monthlyRate).times(factor).dividedBy(factor.minus(1))
  }

  let balance = p
  const schedule: AmortizationRow[] = []
  let totalInterest = new Decimal(0)
  let totalPayment = new Decimal(0)

  for (let month = 1; month <= n; month++) {
    if (balance.isZero() || balance.isNegative()) break

    const interest = balance.times(monthlyRate)
    let principalPaid = pmt.minus(interest)
    let extraPaid = extra

    if (principalPaid.plus(extraPaid).greaterThan(balance)) {
      const needed = balance.minus(principalPaid)
      if (needed.isPositive()) {
        extraPaid = needed
      } else {
        extraPaid = new Decimal(0)
        principalPaid = balance
      }
    }

    const actualPayment = principalPaid.plus(interest).plus(extraPaid)
    balance = balance.minus(principalPaid.plus(extraPaid))
    if (balance.isNegative() || balance.lessThan('1e-9')) balance = new Decimal(0)

    totalInterest = totalInterest.plus(interest)
    totalPayment = totalPayment.plus(actualPayment)

    schedule.push({
      period: month,
      payment: actualPayment,
      principalPaid,
      interestPaid: interest,
      extraPaid,
      remainingBalance: balance
    })

    if (balance.isZero()) break
  }

  return {
    monthlyPayment: pmt,
    totalPayment,
    totalInterest,
    periodsCount: schedule.length,
    schedule
  }
}

// ---------- Simple & Compound Interest ----------

export function simpleInterest(
  principal: Decimal | string | number,
  annualRate: Decimal | string | number,
  years: Decimal | string | number
): { interest: Decimal; total: Decimal } {
  const p = toDecimalInput(principal, 'principal')
  const r = toDecimalInput(annualRate, 'annualRate')
  const y = toNonNegativeInput(years, 'years')
  const interest = p.times(r).times(y)
  return { interest, total: p.plus(interest) }
}

export function compoundInterest(
  principal: Decimal | string | number,
  annualRate: Decimal | string | number,
  years: Decimal | string | number,
  periodsPerYear: number | string = 12
): { interest: Decimal; total: Decimal } {
  const p = toPositiveInput(principal, 'principal')
  const r = toDecimalInput(annualRate, 'annualRate')
  const y = toNonNegativeInput(years, 'years')
  const m = new Decimal(toIntegerInput(periodsPerYear, 'periodsPerYear', { min: 1 }))
  const ratePerPeriod = r.dividedBy(m)
  const totalPeriods = m.times(y)
  const total = p.times(ratePerPeriod.plus(1).pow(totalPeriods))
  return { interest: total.minus(p), total }
}

// ---------- NPV, IRR, XNPV, XIRR, Payback ----------

export function npv(rate: Decimal | string | number, cashFlows: readonly (Decimal | string | number)[]): Decimal {
  const r = toDecimalInput(rate, 'rate')
  if (r.lte(-1)) throw new CalcError('rate must be greater than -100%')
  const flows = cashFlowsInput(cashFlows)
  let val = new Decimal(0)
  const rPlus1 = r.plus(1)
  for (let t = 0; t < flows.length; t++) {
    val = val.plus(flows[t].dividedBy(rPlus1.pow(t)))
  }
  return val
}

/** Cash-flow lists: at least two values, every one a finite number. */
function cashFlowsInput(cashFlows: unknown): Decimal[] {
  if (!Array.isArray(cashFlows)) {
    throw new CalcError(`cashFlows must be a list of numbers (got ${describe(cashFlows)})`)
  }
  const flows = cashFlows.map((cf, i) => toDecimalInput(cf, `cashFlows[${i}]`))
  if (flows.length < 2) throw new CalcError('At least 2 cash flows are required')
  return flows
}

export function irr(cashFlows: readonly (Decimal | string | number)[]): Decimal {
  const flows = cashFlowsInput(cashFlows)
  if (flows.length < 2) throw new CalcError('IRR requires at least 2 cash flows')

  // Check that there is at least one sign change
  const hasPos = flows.some((cf) => cf.isPositive())
  const hasNeg = flows.some((cf) => cf.isNegative())
  if (!hasPos || !hasNeg) throw new CalcError('IRR requires both positive and negative cash flows')

  let rate = new Decimal(0.1) // 10% guess
  for (let iter = 0; iter < 100; iter++) {
    const y = npv(rate, flows)
    if (y.abs().lessThan('1e-10')) return rate

    // Derivative: dNPV/dr = sum -t * CF_t / (1 + r)^(t + 1)
    let dy = new Decimal(0)
    const rPlus1 = rate.plus(1)
    for (let t = 1; t < flows.length; t++) {
      dy = dy.minus(new Decimal(t).times(flows[t]).dividedBy(rPlus1.pow(t + 1)))
    }

    if (dy.isZero()) break
    const nextRate = rate.minus(y.dividedBy(dy))
    if (nextRate.minus(rate).abs().lessThan('1e-12')) return nextRate
    rate = nextRate
  }
  return rate
}

export function xnpv(
  rate: Decimal | string | number,
  cashFlows: readonly (Decimal | string | number)[],
  dates: readonly string[]
): Decimal {
  const r = toDecimalInput(rate, 'rate')
  if (r.lte(-1)) throw new CalcError('rate must be greater than -100%')
  const flows = cashFlowsInput(cashFlows)
  const days = dateListInput(dates)
  if (flows.length !== days.length) {
    throw new CalcError(`cashFlows and dates must have the same length (got ${flows.length} and ${days.length})`)
  }
  const baseTime = new Date(days[0]).getTime()
  let val = new Decimal(0)
  const rPlus1 = r.plus(1)

  for (let i = 0; i < flows.length; i++) {
    const tDays = (new Date(days[i]).getTime() - baseTime) / (1000 * 60 * 60 * 24)
    const tYears = new Decimal(tDays).dividedBy(365)
    val = val.plus(flows[i].dividedBy(rPlus1.pow(tYears)))
  }
  return val
}

/** Date lists must be text, parseable, and the same length as the values they pair with. */
function dateListInput(dates: unknown): string[] {
  if (!Array.isArray(dates)) throw new CalcError(`dates must be a list of dates (got ${describe(dates)})`)
  if (dates.length < 2) throw new CalcError('At least 2 dates are required')
  return dates.map((d, i) => toDateString(d, `dates[${i}]`))
}

export function xirr(cashFlows: readonly (Decimal | string | number)[], dates: readonly string[]): Decimal | null {
  const flows = cashFlowsInput(cashFlows)
  const days = dateListInput(dates)
  if (flows.length !== days.length || flows.length < 2) return null
  let rate = new Decimal(0.1)

  for (let iter = 0; iter < 100; iter++) {
    const y = xnpv(rate, flows, days)
    if (y.abs().lessThan('1e-10')) return rate

    const dr = new Decimal('1e-6')
    const dy = xnpv(rate.plus(dr), flows, days).minus(y).dividedBy(dr)
    if (dy.isZero()) break
    const nextRate = rate.minus(y.dividedBy(dy))
    if (nextRate.minus(rate).abs().lessThan('1e-12')) return nextRate
    rate = nextRate
  }
  return rate
}

export function paybackPeriod(cashFlows: readonly (Decimal | string | number)[]): Decimal | null {
  const flows = cashFlowsInput(cashFlows)
  if (flows.length === 0 || !flows[0].isNegative()) return null
  let cumulative = flows[0]

  for (let t = 1; t < flows.length; t++) {
    const nextCum = cumulative.plus(flows[t])
    if (nextCum.greaterThanOrEqualTo(0)) {
      // Fraction of the year
      const fraction = cumulative.abs().dividedBy(flows[t])
      return new Decimal(t - 1).plus(fraction)
    }
    cumulative = nextCum
  }
  return null
}

// ---------- Percentage Tools ----------

export function markup(cost: Decimal | string | number, markupRate: Decimal | string | number): { sellingPrice: Decimal; profit: Decimal } {
  const c = toNonNegativeInput(cost, 'cost')
  const profit = c.times(toDecimalInput(markupRate, 'markupRate'))
  return { sellingPrice: c.plus(profit), profit }
}

export function margin(cost: Decimal | string | number, marginRate: Decimal | string | number): { sellingPrice: Decimal; profit: Decimal } {
  const c = toNonNegativeInput(cost, 'cost')
  const rate = toDecimalInput(marginRate, 'marginRate')
  if (rate.gte(1)) throw new CalcError('Margin must be strictly less than 100%')
  const sellingPrice = c.dividedBy(new Decimal(1).minus(rate))
  return { sellingPrice, profit: sellingPrice.minus(c) }
}

export function discount(price: Decimal | string | number, discountRate: Decimal | string | number): { discountedPrice: Decimal; savings: Decimal } {
  const p = toDecimalInput(price, 'price')
  const savings = p.times(toDecimalInput(discountRate, 'discountRate'))
  return { discountedPrice: p.minus(savings), savings }
}

export function tax(amount: Decimal | string | number, taxRate: Decimal | string | number): { taxAmount: Decimal; total: Decimal } {
  const a = toDecimalInput(amount, 'amount')
  const taxAmount = a.times(toDecimalInput(taxRate, 'taxRate'))
  return { taxAmount, total: a.plus(taxAmount) }
}

export function tip(bill: Decimal | string | number, tipRate: Decimal | string | number, people: number | string = 1): { tipAmount: Decimal; total: Decimal; perPerson: Decimal } {
  const b = toDecimalInput(bill, 'bill')
  const tipAmount = b.times(toDecimalInput(tipRate, 'tipRate'))
  const total = b.plus(tipAmount)
  const perPerson = total.dividedBy(Math.max(1, toIntegerInput(people, 'people', { min: 1 })))
  return { tipAmount, total, perPerson }
}

export function percentChange(from: Decimal | string | number, to: Decimal | string | number): Decimal {
  const a = toDecimalInput(from, 'from')
  const b = toDecimalInput(to, 'to')
  if (a.isZero()) throw new CalcError('Cannot calculate percent change from zero')
  return b.minus(a).dividedBy(a.abs()).times(100)
}

// ---------- Position Sizing & Risk-Reward (Trading) ----------

export interface PositionSizeParams {
  accountBalance: Decimal | string | number
  riskPercent: Decimal | string | number // e.g. 2 for 2%
  entryPrice: Decimal | string | number
  stopLossPrice: Decimal | string | number
  targetPrice?: Decimal | string | number
}

export interface PositionSizeResult {
  riskAmount: Decimal
  stopDistance: Decimal
  positionUnits: Decimal
  positionValue: Decimal
  rewardRiskRatio: Decimal | null
  breakevenWinRate: Decimal | null // in %
}

export function positionSize(params: PositionSizeParams): PositionSizeResult {
  if (!params || typeof params !== 'object') {
    throw new CalcError(`positionSize expects an object (got ${describe(params)})`)
  }
  const balance = toNonNegativeInput(params.accountBalance, 'accountBalance')
  const riskPercent = toNonNegativeInput(params.riskPercent, 'riskPercent')
  if (riskPercent.gt(100)) {
    throw new CalcError('riskPercent cannot exceed 100%')
  }
  const entry = toPositiveInput(params.entryPrice, 'entryPrice')
  const stop = toPositiveInput(params.stopLossPrice, 'stopLossPrice')
  const target = params.targetPrice === undefined ? undefined : toPositiveInput(params.targetPrice, 'targetPrice')

  const riskAmount = balance.times(riskPercent).dividedBy(100)
  const stopDistance = entry.minus(stop).abs()

  if (stopDistance.isZero()) throw new CalcError('Entry price and stop loss price cannot be identical')

  const positionUnits = riskAmount.dividedBy(stopDistance)
  const positionValue = positionUnits.times(entry)

  let rewardRiskRatio: Decimal | null = null
  let breakevenWinRate: Decimal | null = null

  if (target) {
    const rewardDistance = target.minus(entry).abs()
    rewardRiskRatio = rewardDistance.dividedBy(stopDistance)
    breakevenWinRate = new Decimal(1).dividedBy(rewardRiskRatio.plus(1)).times(100)
  }

  return {
    riskAmount,
    stopDistance,
    positionUnits,
    positionValue,
    rewardRiskRatio,
    breakevenWinRate
  }
}

// ---------- Registry Integration ----------

export function registerFinanceFunctions(): void {
  registry.registerFunction({
    name: 'pmt',
    category: 'finance',
    description: 'Loan payment per period given rate, periods, and present value',
    examples: ['pmt(0.005, 360, 200000)'],
    minArity: 3,
    maxArity: 4,
    impl: (args) => {
      const rate = args[0]
      const nper = args[1]
      const pv = args[2]
      const fv = args[3] ?? new Decimal(0)
      return tvm({ rate, nper, pv, fv }).pmt
    }
  })

  registry.registerFunction({
    name: 'pv',
    category: 'finance',
    description: 'Present value of an investment or loan',
    examples: ['pv(0.05, 5, 0, 12762.82)'],
    minArity: 4,
    maxArity: 5,
    impl: (args) => {
      const rate = args[0]
      const nper = args[1]
      const pmt = args[2]
      const fv = args[3]
      const type = (args[4]?.toNumber() ?? 0) as 0 | 1
      return tvm({ rate, nper, pmt, fv, type }).pv
    }
  })

  registry.registerFunction({
    name: 'fv',
    category: 'finance',
    description: 'Future value of an investment',
    examples: ['fv(0.05, 5, 0, -10000)'],
    minArity: 4,
    maxArity: 5,
    impl: (args) => {
      const rate = args[0]
      const nper = args[1]
      const pmt = args[2]
      const pv = args[3]
      const type = (args[4]?.toNumber() ?? 0) as 0 | 1
      return tvm({ rate, nper, pmt, pv, type }).fv
    }
  })

  registry.registerFunction({
    name: 'nper',
    category: 'finance',
    description: 'Number of periods for an investment or loan',
    examples: ['nper(0.07, 0, -1000, 2000)'],
    minArity: 4,
    maxArity: 5,
    impl: (args) => {
      const rate = args[0]
      const pmt = args[1]
      const pv = args[2]
      const fv = args[3]
      const type = (args[4]?.toNumber() ?? 0) as 0 | 1
      return tvm({ rate, pmt, pv, fv, type }).nper
    }
  })

  registry.registerFunction({
    name: 'npv',
    category: 'finance',
    description: 'Net present value given rate and periodic cash flows',
    examples: ['npv(0.10, -1000, 300, 400, 400, 300)'],
    minArity: 2,
    maxArity: 999,
    impl: (args) => npv(args[0], args.slice(1))
  })

  registry.registerFunction({
    name: 'irr',
    category: 'finance',
    description: 'Internal rate of return for a series of cash flows',
    examples: ['irr(-1000, 300, 400, 400, 300)'],
    minArity: 2,
    maxArity: 999,
    impl: (args) => irr(args)
  })

  registry.registerFunction({
    name: 'compound',
    category: 'finance',
    description: 'Compound interest future value (principal, annualRate, years, compoundingPeriodsPerYear)',
    examples: ['compound(10000, 0.05, 5, 4)'],
    minArity: 3,
    maxArity: 4,
    impl: (args) => compoundInterest(args[0], args[1], args[2], args[3]?.toNumber() ?? 12).total
  })
}

registerFinanceFunctions()
