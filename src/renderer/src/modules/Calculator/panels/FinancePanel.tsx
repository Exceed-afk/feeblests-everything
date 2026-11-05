import { useState } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  tvm,
  loanAmortization,
  markup,
  margin,
  discount,
  tax,
  tip,
  percentChange,
  positionSize,
  type AmortizationSchedule,
  type AmortizationRow,
  type PositionSizeResult
} from '../../../../../shared/calculator/modules/finance'
import { Decimal } from '../../../../../shared/calculator/numeric'

type FinanceSubTab = 'tvm' | 'loan' | 'percent' | 'position'

export function FinancePanel(_props: ModuleProps) {
  const [tab, setTab] = useState<FinanceSubTab>('tvm')

  // --- TVM State ---
  const [tvmNper, setTvmNper] = useState('360')
  const [tvmRate, setTvmRate] = useState('0.005')
  const [tvmPv, setTvmPv] = useState('200000')
  const [tvmPmt, setTvmPmt] = useState('')
  const [tvmFv, setTvmFv] = useState('0')
  const [tvmType, setTvmType] = useState<'0' | '1'>('0')
  const [tvmSolveFor, setTvmSolveFor] = useState<'pmt' | 'pv' | 'fv' | 'nper' | 'rate'>('pmt')
  const [tvmResult, setTvmResult] = useState<string | null>(null)
  const [tvmError, setTvmError] = useState<string | null>(null)

  const handleSolveTvm = () => {
    setTvmError(null)
    setTvmResult(null)
    try {
      const typeNum = (tvmType === '1' ? 1 : 0) as 0 | 1
      const p = {
        type: typeNum,
        nper: tvmSolveFor !== 'nper' && tvmNper ? new Decimal(tvmNper) : undefined,
        rate: tvmSolveFor !== 'rate' && tvmRate ? new Decimal(tvmRate) : undefined,
        pv: tvmSolveFor !== 'pv' && tvmPv ? new Decimal(tvmPv) : undefined,
        pmt: tvmSolveFor !== 'pmt' && tvmPmt ? new Decimal(tvmPmt) : undefined,
        fv: tvmSolveFor !== 'fv' && tvmFv ? new Decimal(tvmFv) : undefined
      }
      const res = tvm(p)
      const solved = res[tvmSolveFor]
      setTvmResult(solved.toDecimalPlaces(4).toString())
    } catch (err) {
      setTvmError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Loan Amortization State ---
  const [loanPrincipal, setLoanPrincipal] = useState('10000')
  const [loanAnnualRate, setLoanAnnualRate] = useState('6.0')
  const [loanMonths, setLoanMonths] = useState('12')
  const [loanExtra, setLoanExtra] = useState('0')
  const [amortization, setAmortization] = useState<AmortizationSchedule | null>(null)
  const [loanError, setLoanError] = useState<string | null>(null)

  const handleCalculateLoan = () => {
    setLoanError(null)
    setAmortization(null)
    try {
      const p = new Decimal(loanPrincipal)
      const r = new Decimal(loanAnnualRate).dividedBy(100)
      const n = parseInt(loanMonths, 10)
      const extra = loanExtra ? new Decimal(loanExtra) : new Decimal(0)
      const res = loanAmortization({ principal: p, annualRate: r, termMonths: n, extraPayment: extra })
      setAmortization(res)
    } catch (err) {
      setLoanError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Percentages State ---
  const [percentTool, setPercentTool] = useState<'markup' | 'margin' | 'discount' | 'tax' | 'tip' | 'change'>('markup')
  const [pVal1, setPVal1] = useState('100')
  const [pVal2, setPVal2] = useState('20')
  const [pPeople, setPPeople] = useState('1')
  const [percentOutput, setPercentOutput] = useState<string | null>(null)

  const handleCalculatePercent = () => {
    try {
      const v1 = new Decimal(pVal1)
      const v2 = new Decimal(pVal2)
      switch (percentTool) {
        case 'markup': {
          const res = markup(v1, v2.dividedBy(100))
          setPercentOutput(`Selling Price: $${res.sellingPrice.toDecimalPlaces(2)}, Profit: $${res.profit.toDecimalPlaces(2)}`)
          break
        }
        case 'margin': {
          const res = margin(v1, v2.dividedBy(100))
          setPercentOutput(`Selling Price: $${res.sellingPrice.toDecimalPlaces(2)}, Profit: $${res.profit.toDecimalPlaces(2)}`)
          break
        }
        case 'discount': {
          const res = discount(v1, v2.dividedBy(100))
          setPercentOutput(`Discounted Price: $${res.discountedPrice.toDecimalPlaces(2)}, You Save: $${res.savings.toDecimalPlaces(2)}`)
          break
        }
        case 'tax': {
          const res = tax(v1, v2.dividedBy(100))
          setPercentOutput(`Tax Amount: $${res.taxAmount.toDecimalPlaces(2)}, Total: $${res.total.toDecimalPlaces(2)}`)
          break
        }
        case 'tip': {
          const res = tip(v1, v2.dividedBy(100), parseInt(pPeople, 10) || 1)
          setPercentOutput(`Tip: $${res.tipAmount.toDecimalPlaces(2)}, Total: $${res.total.toDecimalPlaces(2)}, Per Person: $${res.perPerson.toDecimalPlaces(2)}`)
          break
        }
        case 'change': {
          const res = percentChange(v1, v2)
          setPercentOutput(`Change: ${res.toDecimalPlaces(2)}%`)
          break
        }
      }
    } catch (err) {
      setPercentOutput(err instanceof Error ? err.message : 'Calculation error')
    }
  }

  // --- Position Sizing State ---
  const [accountBal, setAccountBal] = useState('25000')
  const [riskPct, setRiskPct] = useState('2')
  const [entryPrice, setEntryPrice] = useState('150')
  const [stopPrice, setStopPrice] = useState('145')
  const [targetPrice, setTargetPrice] = useState('165')
  const [posResult, setPosResult] = useState<PositionSizeResult | null>(null)
  const [posError, setPosError] = useState<string | null>(null)

  const handlePositionSize = () => {
    setPosError(null)
    setPosResult(null)
    try {
      const res = positionSize({
        accountBalance: new Decimal(accountBal),
        riskPercent: new Decimal(riskPct),
        entryPrice: new Decimal(entryPrice),
        stopLossPrice: new Decimal(stopPrice),
        targetPrice: targetPrice ? new Decimal(targetPrice) : undefined
      })
      setPosResult(res)
    } catch (err) {
      setPosError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      {/* Sub tabs */}
      <div className="seg flex-wrap" role="group">
        {(['tvm', 'loan', 'percent', 'position'] as FinanceSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t} className="btn"
            onClick={() => setTab(t)}
          >
            {t === 'tvm' && 'TVM Solver'}
            {t === 'loan' && 'Loan & Mortgage'}
            {t === 'percent' && 'Percentages'}
            {t === 'position' && 'Position Sizing'}
          </button>
        ))}
      </div>

      {/* 1. TVM Solver */}
      {tab === 'tvm' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Solve For</label>
              <select
                className="field w-full text-xs"
                value={tvmSolveFor}
                onChange={(e) => setTvmSolveFor(e.target.value as any)}
              >
                <option value="pmt">Payment (PMT)</option>
                <option value="pv">Present Value (PV)</option>
                <option value="fv">Future Value (FV)</option>
                <option value="nper">Periods (NPER)</option>
                <option value="rate">Rate per period</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Timing</label>
              <select
                className="field w-full text-xs"
                value={tvmType}
                onChange={(e) => setTvmType(e.target.value as '0' | '1')}
              >
                <option value="0">End of Period (Ordinary)</option>
                <option value="1">Beginning (Annuity Due)</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Periods (NPER)</label>
              <input
                className="field w-full text-xs"
                disabled={tvmSolveFor === 'nper'}
                value={tvmNper}
                onChange={(e) => setTvmNper(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Periodic Rate (e.g. 0.05)</label>
              <input
                className="field w-full text-xs"
                disabled={tvmSolveFor === 'rate'}
                value={tvmRate}
                onChange={(e) => setTvmRate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Present Value (PV)</label>
              <input
                className="field w-full text-xs"
                disabled={tvmSolveFor === 'pv'}
                value={tvmPv}
                onChange={(e) => setTvmPv(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Payment (PMT)</label>
              <input
                className="field w-full text-xs"
                disabled={tvmSolveFor === 'pmt'}
                value={tvmPmt}
                onChange={(e) => setTvmPmt(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Future Value (FV)</label>
              <input
                className="field w-full text-xs"
                disabled={tvmSolveFor === 'fv'}
                value={tvmFv}
                onChange={(e) => setTvmFv(e.target.value)}
              />
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleSolveTvm}>
            Solve
          </button>

          {tvmError && <p className="text-xs text-neg">{tvmError}</p>}
          {tvmResult && (
            <div className="p-3 rounded border border-line bg-accent/5">
              <span className="text-xs text-muted">Solved {tvmSolveFor.toUpperCase()}: </span>
              <span className="text-lg font-bold font-mono text-accent-fg">{tvmResult}</span>
            </div>
          )}
        </div>
      )}

      {/* 2. Loan Amortization */}
      {tab === 'loan' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Principal ($)</label>
              <input className="field w-full text-xs" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Annual Rate (%)</label>
              <input className="field w-full text-xs" value={loanAnnualRate} onChange={(e) => setLoanAnnualRate(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Term (Months)</label>
              <input className="field w-full text-xs" value={loanMonths} onChange={(e) => setLoanMonths(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Extra Monthly ($)</label>
              <input className="field w-full text-xs" value={loanExtra} onChange={(e) => setLoanExtra(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleCalculateLoan}>
            Calculate Amortization
          </button>

          {loanError && <p className="text-xs text-neg">{loanError}</p>}

          {amortization && (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-3 gap-3 p-3 rounded border border-line bg-accent/5 text-xs">
                <div>
                  <div className="text-muted">Monthly Payment</div>
                  <div className="font-bold font-mono text-sm">${amortization.monthlyPayment.toDecimalPlaces(2).toString()}</div>
                </div>
                <div>
                  <div className="text-muted">Total Interest</div>
                  <div className="font-bold font-mono text-sm">${amortization.totalInterest.toDecimalPlaces(2).toString()}</div>
                </div>
                <div>
                  <div className="text-muted">Actual Payoff Months</div>
                  <div className="font-bold font-mono text-sm">{amortization.periodsCount}</div>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto border border-line rounded text-xs">
                <table className="w-full text-left">
                  <thead className="bg-accent/10 sticky top-0">
                    <tr>
                      <th className="p-1.5">Mo</th>
                      <th className="p-1.5">Payment</th>
                      <th className="p-1.5">Principal</th>
                      <th className="p-1.5">Interest</th>
                      <th className="p-1.5">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amortization.schedule.map((row: AmortizationRow) => (
                      <tr key={row.period} className="border-t border-line/20 font-mono">
                        <td className="p-1.5">{row.period}</td>
                        <td className="p-1.5">${row.payment.toDecimalPlaces(2).toString()}</td>
                        <td className="p-1.5">${row.principalPaid.toDecimalPlaces(2).toString()}</td>
                        <td className="p-1.5">${row.interestPaid.toDecimalPlaces(2).toString()}</td>
                        <td className="p-1.5">${row.remainingBalance.toDecimalPlaces(2).toString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Percentages */}
      {tab === 'percent' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Tool</label>
              <select className="field w-full text-xs" value={percentTool} onChange={(e) => setPercentTool(e.target.value as any)}>
                <option value="markup">Markup on Cost</option>
                <option value="margin">Gross Margin</option>
                <option value="discount">Discount</option>
                <option value="tax">Sales Tax</option>
                <option value="tip">Tip & Split</option>
                <option value="change">Percent Change</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">
                {percentTool === 'change' ? 'From Value' : 'Base / Cost / Bill ($)'}
              </label>
              <input className="field w-full text-xs" value={pVal1} onChange={(e) => setPVal1(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">
                {percentTool === 'change' ? 'To Value' : 'Rate (%)'}
              </label>
              <input className="field w-full text-xs" value={pVal2} onChange={(e) => setPVal2(e.target.value)} />
            </div>
            {percentTool === 'tip' && (
              <div>
                <label className="text-muted block text-xs mb-1">People</label>
                <input className="field w-full text-xs" value={pPeople} onChange={(e) => setPPeople(e.target.value)} />
              </div>
            )}
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleCalculatePercent}>
            Calculate
          </button>

          {percentOutput && (
            <div className="p-3 rounded border border-line bg-accent/5 font-mono text-sm font-semibold text-accent-fg">
              {percentOutput}
            </div>
          )}
        </div>
      )}

      {/* 4. Position Sizing */}
      {tab === 'position' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Account ($)</label>
              <input className="field w-full text-xs" value={accountBal} onChange={(e) => setAccountBal(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Risk (%)</label>
              <input className="field w-full text-xs" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Entry ($)</label>
              <input className="field w-full text-xs" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Stop Loss ($)</label>
              <input className="field w-full text-xs" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Target ($)</label>
              <input className="field w-full text-xs" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handlePositionSize}>
            Calculate Position Size
          </button>

          {posError && <p className="text-xs text-neg">{posError}</p>}

          {posResult && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded border border-line bg-accent/5 text-xs font-mono">
              <div>
                <div className="text-muted">Max Risk</div>
                <div className="font-bold text-sm">${posResult.riskAmount.toDecimalPlaces(2).toString()}</div>
              </div>
              <div>
                <div className="text-muted">Stop Distance</div>
                <div className="font-bold text-sm">${posResult.stopDistance.toDecimalPlaces(2).toString()}</div>
              </div>
              <div>
                <div className="text-muted">Units / Shares</div>
                <div className="font-bold text-sm text-accent-fg">{posResult.positionUnits.toDecimalPlaces(2).toString()}</div>
              </div>
              <div>
                <div className="text-muted">Position Value</div>
                <div className="font-bold text-sm">${posResult.positionValue.toDecimalPlaces(2).toString()}</div>
              </div>
              {posResult.rewardRiskRatio && (
                <>
                  <div>
                    <div className="text-muted">Reward / Risk Ratio</div>
                    <div className="font-bold text-sm">{posResult.rewardRiskRatio.toDecimalPlaces(2).toString()}R</div>
                  </div>
                  <div>
                    <div className="text-muted">Breakeven Win Rate</div>
                    <div className="font-bold text-sm">{posResult.breakevenWinRate?.toDecimalPlaces(1).toString()}%</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default FinancePanel
