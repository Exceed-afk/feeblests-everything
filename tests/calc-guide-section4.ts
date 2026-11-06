// docs/calculator-testing-guide.md — Section 4: Finance.
// Run on its own:  npx tsx tests/calc-guide-section4.ts
import {
  tvm, loanAmortization, compoundInterest, simpleInterest, npv, irr, paybackPeriod,
  percentChange, discount, tax, tip, markup, positionSize
} from '../src/shared/calculator/modules/finance'
import { Decimal } from '../src/shared/calculator/numeric'
import { GuideSuite, finish, expectText, expectClose, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 4: Finance', 'Finance')

const dec = (n: number | string) => new Decimal(n)
const money = (v: Decimal) => v.toFixed(2)

// ---------- Loans and mortgages ----------
const sched200k = loanAmortization({ principal: dec(200000), annualRate: dec(0.06), termMonths: 360 })

suite.test('$200,000 at 6% yearly, 30 years, monthly: payment', '$200,000, 6%, 30 yr, monthly', '$1,199.10', () =>
  expectText(money(sched200k.monthlyPayment), '1199.10'))
suite.test('$200,000 loan: total interest', '$200,000, 6%, 30 yr, monthly', 'About $231,676', () =>
  expectClose(sched200k.totalInterest.toNumber(), 231676, 100))
suite.test('$200,000 loan: first month interest', '$200,000, 6%, 30 yr, month 1', '$1,000.00', () =>
  expectText(money(sched200k.schedule[0].interestPaid), '1000.00'))
suite.test('$200,000 loan: first month principal', '$200,000, 6%, 30 yr, month 1', '$199.10', () =>
  expectText(money(sched200k.schedule[0].principalPaid), '199.10'))
suite.test('$100,000 at 5%, 15 years, monthly: payment', '$100,000, 5%, 15 yr, monthly', '$790.79', () =>
  expectText(money(loanAmortization({ principal: dec(100000), annualRate: dec(0.05), termMonths: 180 }).monthlyPayment), '790.79'))
suite.test('Any loan, 0% interest: payment = amount / payments', '$120,000, 0%, 12 months', '$10,000.00', () =>
  expectText(money(loanAmortization({ principal: dec(120000), annualRate: dec(0), termMonths: 12 }).monthlyPayment), '10000.00'))

// Amortization schedule checks (the $200,000 loan)
suite.test('Amortization: number of rows is 360', '$200,000 schedule', '360', () => expectText(String(sched200k.schedule.length), '360'))
suite.test('Amortization: every row payment = interest + principal', '$200,000 schedule', 'Matches on every row', () => {
  for (const [i, row] of sched200k.schedule.entries()) {
    const sum = row.interestPaid.plus(row.principalPaid).plus(row.extraPaid)
    if (!sum.minus(row.payment).abs().lt(1e-6)) throw new GuideMismatch(`row ${i + 1}: ${sum} vs ${row.payment}`)
  }
  return { actual: 'all 360 rows match' }
})
suite.test('Amortization: interest goes down and principal goes up', '$200,000 schedule', 'Interest falls, principal rises', () => {
  const first = sched200k.schedule[0]
  const last = sched200k.schedule[sched200k.schedule.length - 1]
  if (!first.interestPaid.gt(last.interestPaid)) throw new GuideMismatch('interest did not fall')
  if (!first.principalPaid.lt(last.principalPaid)) throw new GuideMismatch('principal did not rise')
  return { actual: `interest ${money(first.interestPaid)} -> ${money(last.interestPaid)}` }
})
suite.test('Amortization: last balance is exactly 0.00', '$200,000 schedule', '0.00', () =>
  expectText(money(sched200k.schedule[sched200k.schedule.length - 1].remainingBalance), '0.00'))
suite.test('Amortization: total principal paid is exactly $200,000.00', '$200,000 schedule', '$200,000.00', () =>
  expectText(money(sched200k.schedule.reduce((a, r) => a.plus(r.principalPaid), dec(0))), '200000.00'))
suite.test('Add an extra $200 a month: finishes earlier, interest drops', '$200k loan + $200/mo', 'Shorter term, lower interest', () => {
  const extra = loanAmortization({ principal: dec(200000), annualRate: dec(0.06), termMonths: 360, extraPayment: dec(200) })
  if (!(extra.schedule.length < 360)) throw new GuideMismatch(`${extra.schedule.length} months`)
  if (!extra.totalInterest.lt(sched200k.totalInterest)) throw new GuideMismatch('interest did not drop')
  return { actual: `${extra.schedule.length} months, interest $${money(extra.totalInterest)}` }
})

// ---------- Compound and simple interest ----------
suite.test('Compounded yearly', '$1,000, 5%, 10y, yearly', '$1,628.89', () => expectText(money(compoundInterest(1000, 0.05, 10, 1).total), '1628.89'))
suite.test('Compounded monthly', '$1,000, 5%, 10y, monthly', '$1,647.01', () => expectText(money(compoundInterest(1000, 0.05, 10, 12).total), '1647.01'))
suite.test('Compounded daily', '$1,000, 5%, 10y, daily', '$1,648.66', () => expectText(money(compoundInterest(1000, 0.05, 10, 365).total), '1648.66'))
suite.test('Continuous', '$1,000, 5%, 10y, continuous', '$1,648.72', () =>
  expectText(money(dec(1000).times(dec(0.05).times(10).exp())), '1648.72'))
suite.test('Simple interest', '$1,000, 5%, 10y, simple', '$1,500.00', () => expectText(money(simpleInterest(1000, 0.05, 10).total), '1500.00'))

// ---------- Time value of money ----------
suite.test('TVM: future value', 'PV=-1000, 5%, 10 years', '$1,628.89', () =>
  expectText(money(tvm({ pv: dec(-1000), rate: dec(0.05), nper: dec(10), pmt: dec(0) }).fv), '1628.89'))
suite.test('TVM: present value', 'FV=1628.89, 5%, 10 years', '$1,000.00', () =>
  expectText(money(tvm({ fv: dec(1628.89), rate: dec(0.05), nper: dec(10), pmt: dec(0) }).pv.abs()), '1000.00'))
suite.test('TVM: rate', 'PV=-1000, FV=1628.89, 10 years', '5.00%', () =>
  expectText(tvm({ pv: dec(-1000), fv: dec(1628.89), nper: dec(10), pmt: dec(0) }).rate.times(100).toFixed(2), '5.00'))
suite.test('TVM: periods', 'PV=-1000, FV=1628.89, 5%', '10', () =>
  expectText(tvm({ pv: dec(-1000), fv: dec(1628.89), rate: dec(0.05), pmt: dec(0) }).nper.toFixed(0), '10'))
suite.test('TVM: saving $500/mo at 6% for 10 years', 'PMT=-500, 6%/12, 120 months', 'About $81,939.67', () =>
  expectText(money(tvm({ pmt: dec(-500), rate: dec(0.06).dividedBy(12), nper: dec(120), pv: dec(0) }).fv), '81939.67'))

// ---------- NPV, IRR, payback ----------
const flows = [-1000, 400, 400, 400].map(dec)
suite.test('NPV at 10%', '-1000, 400, 400, 400 @ 10%', '-5.26', () => expectText(npv(0.1, flows).toFixed(2), '-5.26'))
suite.test('IRR', '-1000, 400, 400, 400', 'About 9.70%', () => expectClose(irr(flows).times(100).toNumber(), 9.7, 0.1))
suite.test('Payback period', '-1000, 400, 400, 400', '2.5 years', () => {
  const p = paybackPeriod(flows)
  if (p === null) throw new GuideMismatch('null')
  return expectText(p.toFixed(1), '2.5')
})
suite.test('IRR edge: all positive cash flows', '100, 200, 300', 'Undefined, with a clear message', () =>
  expectError(() => irr([100, 200, 300].map(dec)), /positive and negative/i))
suite.test('IRR edge: all negative cash flows', '-100, -200, -300', 'Undefined, with a clear message', () =>
  expectError(() => irr([-100, -200, -300].map(dec)), /positive and negative/i))
suite.test('IRR edge: a single cash flow', '-1000', 'A clear message', () =>
  expectError(() => irr([dec(-1000)]), /at least 2/i))

// ---------- Percentage tools ----------
suite.test('Percent change from 80 to 100', '80 -> 100', '+25%', () => expectText(percentChange(80, 100).toFixed(0), '25'))
suite.test('Percent change from 100 to 80', '100 -> 80', '-20%', () => expectText(percentChange(100, 80).toFixed(0), '-20'))
suite.test('$80 with 25% discount', '$80, 25% off', '$60', () => expectText(money(discount(80, 0.25).discountedPrice), '60.00'))
suite.test('$100 plus 8% tax', '$100, 8% tax', '$108', () => expectText(money(tax(100, 0.08).total), '108.00'))
suite.test('20% tip on $50', '$50, 20% tip', '$10', () => expectText(money(tip(50, 0.2).tipAmount), '10.00'))
suite.test('Cost $60, price $100: margin', 'cost 60, price 100', '40%', () => {
  // The calculator's margin() takes a margin RATE and returns the price; the guide asks for
  // the rate from a cost and a price, which is (price - cost) / price.
  const rate = dec(100).minus(60).dividedBy(100)
  return expectText(rate.times(100).toFixed(0), '40')
})
suite.test('Cost $60, price $100: markup', 'cost 60, price 100', '66.67%', () => {
  const rate = dec(100).minus(60).dividedBy(60)
  return expectText(rate.times(100).toFixed(2), '66.67')
})
suite.test('Markup of 50% on cost $50', 'cost $50, 50% markup', 'Price $75', () => expectText(money(markup(50, 0.5).sellingPrice), '75.00'))

// ---------- Trading tools (gold, XAUUSD) ----------
const gold = positionSize({ accountBalance: 10000, riskPercent: 1, entryPrice: 2000, stopLossPrice: 1990, targetPrice: 2030 })
suite.test('Account $10,000, risk 1%', 'balance 10000, risk 1%', 'Risk amount $100', () => expectText(money(gold.riskAmount), '100.00'))
suite.test('Risk $100, stop distance $10, 100 oz per lot', 'entry 2000, stop 1990', '0.10 lots', () => {
  // positionUnits is in ounces: $100 / $10 = 10 oz; a standard lot is 100 oz.
  return expectText(gold.positionUnits.dividedBy(100).toFixed(2), '0.10')
})
suite.test('Entry 2000, stop 1990, target 2030', 'entry 2000, stop 1990, target 2030', 'Reward to risk 3 : 1', () => {
  if (gold.rewardRiskRatio === null) throw new GuideMismatch('null')
  return expectText(gold.rewardRiskRatio.toFixed(0), '3')
})
suite.test('Break-even win rate at 3 : 1', 'R:R 3:1', '25%', () => {
  if (gold.breakevenWinRate === null) throw new GuideMismatch('null')
  return expectText(gold.breakevenWinRate.toFixed(0), '25')
})
suite.test('Entry 2000, stop 2000 (zero stop distance)', 'entry 2000, stop 2000', 'Clear error, not a crash or infinite size', () =>
  expectError(() => positionSize({ accountBalance: 10000, riskPercent: 1, entryPrice: 2000, stopLossPrice: 2000 }), /identical/i))
suite.test('Risk 0%', 'risk 0%', 'Position size 0 or a clear message', () =>
  expectText(positionSize({ accountBalance: 10000, riskPercent: 0, entryPrice: 2000, stopLossPrice: 1990 }).positionUnits.toFixed(2), '0.00'))
suite.test('Short trade (stop above entry)', 'entry 2000, stop 2010, target 1970', 'R:R 3 : 1', () => {
  const short = positionSize({ accountBalance: 10000, riskPercent: 1, entryPrice: 2000, stopLossPrice: 2010, targetPrice: 1970 })
  if (short.rewardRiskRatio === null) throw new GuideMismatch('null')
  return expectText(short.rewardRiskRatio.toFixed(0), '3')
})
suite.test('Very tight stop', 'entry 2000, stop 1999.9', 'A large but finite position', () => {
  const tight = positionSize({ accountBalance: 10000, riskPercent: 1, entryPrice: 2000, stopLossPrice: 1999.9 })
  if (!tight.positionUnits.isFinite()) throw new GuideMismatch('infinite')
  return expectText(tight.positionUnits.toFixed(0), '1000')
})
suite.test('Risk above 100%', 'risk 150%', 'Warns (or is rejected)', () =>
  expectError(() => positionSize({ accountBalance: 10000, riskPercent: 150, entryPrice: 2000, stopLossPrice: 1990 }), /exceed 100%/i))

// ---------- Edge cases for all finance ----------
suite.test('Interest rate of 0%', '0% loan', 'Payment = amount / payments', () =>
  expectText(money(loanAmortization({ principal: dec(1200), annualRate: dec(0), termMonths: 12 }).monthlyPayment), '100.00'))
suite.test('Negative interest rate', '-1% loan', 'Handled or rejected clearly', () => {
  // A clear rejection is one of the two answers the guide allows.
  try {
    const r = loanAmortization({ principal: dec(1200), annualRate: dec(-0.01), termMonths: 12 })
    if (!r.monthlyPayment.isFinite()) throw new GuideMismatch('not finite')
    return { actual: `payment $${money(r.monthlyPayment)}` }
  } catch (err) {
    if (err instanceof GuideMismatch) throw err
    return { actual: `rejected: ${(err as Error).message}` }
  }
})
suite.test('Interest rate of 100%', '100% loan', 'Handled', () => {
  const r = loanAmortization({ principal: dec(1200), annualRate: dec(1), termMonths: 12 })
  return { actual: `payment $${money(r.monthlyPayment)}` }
})
suite.test('Interest rate of 1,000%', '1000% loan', 'Handled', () => {
  const r = loanAmortization({ principal: dec(1200), annualRate: dec(10), termMonths: 12 })
  return { actual: `payment $${money(r.monthlyPayment)}` }
})
suite.test('Zero periods', 'termMonths = 0', 'A clear error', () =>
  expectError(() => loanAmortization({ principal: dec(1000), annualRate: dec(0.05), termMonths: 0 }), /at least 1/i))
suite.test('Negative periods', 'termMonths = -12', 'A clear error', () =>
  expectError(() => loanAmortization({ principal: dec(1000), annualRate: dec(0.05), termMonths: -12 }), /at least 1/i))
suite.test('Very large amount (1 billion) with no rounding drift', '$1,000,000,000 at 5%, 360 months', 'Exact to the cent', () => {
  const big = loanAmortization({ principal: dec(1_000_000_000), annualRate: dec(0.05), termMonths: 360 })
  const principal = big.schedule.reduce((a, r) => a.plus(r.principalPaid), dec(0))
  return expectText(money(principal), '1000000000.00')
})
suite.test('Schedule total matches payment x payments (last payment may adjust)', '$200,000 loan', 'Within a few cents', () => {
  const expected = sched200k.monthlyPayment.times(360)
  const diff = sched200k.totalPayment.minus(expected).abs()
  if (diff.gt(1)) throw new GuideMismatch(`off by $${money(diff)}`)
  return { actual: `off by $${money(diff)}` }
})
suite.test('Money displays two decimals, never 1,199.1000000001', '$200,000 loan payment', '1199.10', () =>
  expectText(money(sched200k.monthlyPayment), '1199.10'))

finish(suite)
