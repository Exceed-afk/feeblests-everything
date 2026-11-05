import assert from 'node:assert/strict'
import {
  tvm,
  loanAmortization,
  compoundInterest,
  simpleInterest,
  npv,
  irr,
  xnpv,
  xirr,
  paybackPeriod,
  markup,
  margin,
  discount,
  tax,
  tip,
  percentChange,
  positionSize
} from '../src/shared/calculator/modules/finance'
import { Decimal } from '../src/shared/calculator/numeric'

const dec = (n: number | string): Decimal => new Decimal(n)
const close = (actual: Decimal | number, expected: number, tol = 1e-4, label?: string) => {
  const a = typeof actual === 'number' ? actual : actual.toNumber()
  assert.ok(
    Math.abs(a - expected) <= tol,
    `${label || ''} expected ${expected}, got ${a} (diff ${Math.abs(a - expected)})`
  )
}

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Time Value of Money (TVM) ----------
// Standard scenario: PV = -10000, r = 5% per year, n = 5 years (annual), PMT = 0 -> FV = 10000 * (1.05)^5 = 12762.8156
const fv1 = tvm({ pv: dec(-10000), rate: dec(0.05), nper: dec(5), pmt: dec(0) })
close(fv1.fv, 12762.8156, 1e-2, 'TVM FV'); ok()

// Solve for PV: FV = 12762.8156, r = 0.05, n = 5, PMT = 0 -> PV = -10000
const pv1 = tvm({ fv: dec(12762.8156), rate: dec(0.05), nper: dec(5), pmt: dec(0) })
close(pv1.pv, -10000, 1e-2, 'TVM PV'); ok()

// Solve for PMT: Loan 200,000 at 6% annual (0.005/mo) for 360 months -> PMT = -1199.10
const pmtLoan = tvm({ pv: dec(200000), rate: dec(0.06 / 12), nper: dec(360), fv: dec(0) })
close(pmtLoan.pmt, -1199.10, 0.02, 'TVM PMT mortgage'); ok()

// Solve for nper: PV = -1000, FV = 2000, rate = 0.07, pmt = 0 -> nper = ln(2)/ln(1.07) ~ 10.2447
const nper1 = tvm({ pv: dec(-1000), fv: dec(2000), rate: dec(0.07), pmt: dec(0) })
close(nper1.nper, 10.2447, 1e-3, 'TVM NPER'); ok()

// Solve for rate: PV = -1000, FV = 2000, nper = 10, pmt = 0 -> rate = 2^(0.1) - 1 ~ 0.071773
const rate1 = tvm({ pv: dec(-1000), fv: dec(2000), nper: dec(10), pmt: dec(0) })
close(rate1.rate, 0.071773, 1e-4, 'TVM Rate'); ok()

// Annuity Due (type = 1: beginning of period)
const annuityDue = tvm({ pv: dec(0), rate: dec(0.05), nper: dec(10), pmt: dec(-1000), type: 1 })
// FV of annuity due: 1000 * ((1.05^10 - 1)/0.05) * 1.05 = 12577.8925 * 1.05 = 13206.787
close(annuityDue.fv, 13206.787, 1e-2, 'TVM Annuity Due FV'); ok()

// ---------- 2. Loan Amortization ----------
// $10,000 loan, 6% annual, 12 months, monthly payments
const sched = loanAmortization({
  principal: dec(10000),
  annualRate: dec(0.06),
  termMonths: 12
})
assert.equal(sched.schedule.length, 12, '12 payments'); ok()
// Monthly payment for 10000 at 0.5% for 12 mos = 860.66
close(sched.monthlyPayment, 860.664, 1e-2, 'Monthly payment'); ok()
// Final balance must be 0
close(sched.schedule[11].remainingBalance, 0, 1e-2, 'Final balance 0'); ok()
// Total principal paid equals initial principal
const totalPrin = sched.schedule.reduce((acc, row) => acc.plus(row.principalPaid), dec(0))
close(totalPrin, 10000, 1e-2, 'Total principal paid'); ok()
// Total interest ~ 327.97
close(sched.totalInterest, 327.97, 0.1, 'Total interest'); ok()

// Loan amortization with extra monthly payment
const schedExtra = loanAmortization({
  principal: dec(10000),
  annualRate: dec(0.06),
  termMonths: 12,
  extraPayment: dec(100)
})
assert.ok(schedExtra.schedule.length < 12, 'Loan paid off early with extra payment'); ok()
assert.ok(schedExtra.totalInterest.lessThan(sched.totalInterest), 'Extra payment saves interest'); ok()

// ---------- 3. Compound & Simple Interest ----------
// Simple interest: I = P * r * t = 5000 * 0.04 * 3 = 600
const simp = simpleInterest(dec(5000), dec(0.04), dec(3))
close(simp.interest, 600, 1e-4, 'Simple interest'); ok()
close(simp.total, 5600, 1e-4, 'Simple total'); ok()

// Compound interest: $10,000 at 5% compounded quarterly (m=4) for 5 years
// A = 10000 * (1 + 0.05/4)^(20) = 10000 * (1.0125)^20 = 12820.3723
const comp = compoundInterest(dec(10000), dec(0.05), dec(5), 4)
close(comp.total, 12820.3723, 1e-2, 'Compound interest total'); ok()
close(comp.interest, 2820.3723, 1e-2, 'Compound interest accrued'); ok()

// ---------- 4. NPV & IRR ----------
// Textbook cash flows: -1000, 300, 400, 400, 300 at rate = 10%
// NPV = -1000 + 300/1.1 + 400/1.1^2 + 400/1.1^3 + 300/1.1^4 = 108.7357
const cfs = [dec(-1000), dec(300), dec(400), dec(400), dec(300)]
const npvVal = npv(dec(0.10), cfs)
close(npvVal, 108.7357, 0.01, 'NPV at 10%'); ok()

// IRR for same cash flows ~ 14.895%
const irrVal = irr(cfs)
close(irrVal, 0.14895, 1e-4, 'IRR'); ok()

// When evaluated at IRR, NPV must be virtually zero
const npvAtIrr = npv(irrVal, cfs)
close(npvAtIrr, 0, 1e-2, 'NPV at IRR is 0'); ok()

// Payback period for above cash flows:
// Year 0: -1000, Year 1: +300 (cum -700), Year 2: +400 (cum -300), Year 3: +400 (turns pos at Year 2 + 300/400 = 2.75 yrs)
const pb = paybackPeriod(cfs)
assert.ok(pb !== null, 'Payback period exists'); ok()
close(pb!, 2.75, 1e-2, 'Payback period'); ok()

// ---------- 5. XNPV & XIRR (Exact-date cash flows) ----------
// Cash flows with irregular dates:
// 2024-01-01: -1000
// 2024-07-01: 500  (182 days)
// 2025-01-01: 600  (366 days, leap year)
const dates = ['2024-01-01', '2024-07-01', '2025-01-01']
const xCfs = [dec(-1000), dec(500), dec(600)]
const xnpvVal = xnpv(dec(0.10), xCfs, dates)
assert.ok(xnpvVal.isFinite(), 'XNPV finite'); ok()

const xirrVal = xirr(xCfs, dates)
assert.ok(xirrVal !== null, 'XIRR converged'); ok()
const checkXnpvAtIrr = xnpv(xirrVal!, xCfs, dates)
close(checkXnpvAtIrr, 0, 1e-1, 'XNPV at XIRR is ~0'); ok()

// ---------- 6. Percentage Tools ----------
// Markup: cost 80, markup 25% -> price 100, profit 20
const mUp = markup(dec(80), dec(0.25))
close(mUp.sellingPrice, 100, 1e-4, 'Markup selling price'); ok()
close(mUp.profit, 20, 1e-4, 'Markup profit'); ok()

// Margin: cost 80, margin 20% -> price = 80 / (1 - 0.20) = 100
const mIn = margin(dec(80), dec(0.20))
close(mIn.sellingPrice, 100, 1e-4, 'Margin selling price'); ok()

// Discount: original 120, discount 15% -> discounted price 102, saved 18
const disc = discount(dec(120), dec(0.15))
close(disc.discountedPrice, 102, 1e-4, 'Discounted price'); ok()
close(disc.savings, 18, 1e-4, 'Discount savings'); ok()

// Tax: subtotal 150, tax rate 8.5% -> tax 12.75, total 162.75
const tx = tax(dec(150), dec(0.085))
close(tx.taxAmount, 12.75, 1e-4, 'Tax amount'); ok()
close(tx.total, 162.75, 1e-4, 'Tax total'); ok()

// Tip: bill 85, tip rate 18%, 3 people -> tip 15.30, total 100.30, perPerson 33.4333
const tp = tip(dec(85), dec(0.18), 3)
close(tp.tipAmount, 15.30, 1e-4, 'Tip amount'); ok()
close(tp.total, 100.30, 1e-4, 'Tip total'); ok()
close(tp.perPerson, 33.4333, 1e-2, 'Tip per person'); ok()

// Percent change: from 80 to 100 -> +25%
close(percentChange(dec(80), dec(100)), 25, 1e-4, 'Percent change +'); ok()
// Percent change: from 100 to 80 -> -20%
close(percentChange(dec(100), dec(80)), -20, 1e-4, 'Percent change -'); ok()

// ---------- 7. Position Sizing & Risk-Reward (Trading) ----------
// Account: $25,000, risk: 2% ($500), entry: 150, stop: 145 ($5 stop distance)
// Position size = 500 / 5 = 100 shares. Total value = 15,000.
// Target: 165 ($15 reward) -> R:R = 15 / 5 = 3.0 -> Break-even win rate = 1 / (1 + 3) = 25%
const pos = positionSize({
  accountBalance: dec(25000),
  riskPercent: dec(2),
  entryPrice: dec(150),
  stopLossPrice: dec(145),
  targetPrice: dec(165)
})
close(pos.riskAmount, 500, 1e-4, 'Risk amount'); ok()
close(pos.stopDistance, 5, 1e-4, 'Stop distance'); ok()
close(pos.positionUnits, 100, 1e-4, 'Position units'); ok()
close(pos.positionValue, 15000, 1e-4, 'Position value'); ok()
close(pos.rewardRiskRatio!, 3.0, 1e-4, 'R:R ratio'); ok()
close(pos.breakevenWinRate!, 25, 1e-4, 'Break-even win rate %'); ok()

console.log(`ok   ${checks} finance known-answers and reference tests passed`)
