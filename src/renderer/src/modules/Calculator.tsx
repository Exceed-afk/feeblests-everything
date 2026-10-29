import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { CURRENCIES, UNIT_OPTIONS, asPercentage, calculateAge, compoundInterest, convertCurrency, convertUnit, dateDifferenceDays, loanPayment, percentChange, percentOf, tipSplit, type CurrencyCode, type UnitCategory } from '../../../shared/calculators'
import type { ModuleProps } from '../lib/navigation'

type CalculatorId = 'loan' | 'interest' | 'tip' | 'percentage' | 'unit' | 'currency' | 'date' | 'age'
const CALCULATORS: { id: CalculatorId; label: string }[] = [
  { id: 'loan', label: 'Loan' },
  { id: 'interest', label: 'Interest' },
  { id: 'tip', label: 'Tip & split' },
  { id: 'percentage', label: 'Percentage' },
  { id: 'unit', label: 'Unit converter' },
  { id: 'currency', label: 'Currency' },
  { id: 'date', label: 'Date difference' },
  { id: 'age', label: 'Age' }
]

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const numberValue = (value: string): number => value.trim() === '' ? Number.NaN : Number(value)
const money = (value: number | null): string => value === null || !Number.isFinite(value)
  ? '—'
  : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimal = (value: number | null, digits = 4): string => value === null || !Number.isFinite(value)
  ? '—'
  : value.toLocaleString(undefined, { maximumFractionDigits: digits })

function NumberField({ label, value, onChange, min, step = 'any' }: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  step?: string
}) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <input className="field mt-1" type="number" min={min} step={step} value={value}
        onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <select className="field mt-1" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  )
}

function Result({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  return (
    <div className={`calc-result ${prominent ? 'calc-result-main' : ''}`}>
      <p className="text-sm text-muted">{label}</p>
      <p aria-live="polite" className={`mt-1 font-semibold tabular-nums ${prominent ? 'text-2xl' : 'text-lg'}`}>{value}</p>
    </div>
  )
}

export function Calculator(_props: ModuleProps) {
  const [active, setActive] = useState<CalculatorId>('loan')
  const [values, setValues] = useState({
    loanAmount: '10000', loanRate: '6.5', loanYears: '5',
    principal: '1000', interestRate: '5', interestYears: '5', compounding: '12',
    bill: '80', tipRate: '18', people: '2',
    percentageBase: '200', percentageRate: '15', percentageFrom: '80', percentageTo: '100', percentagePart: '30', percentageWhole: '200',
    unitCategory: 'length' as UnitCategory, unitValue: '1', unitFrom: 'km', unitTo: 'mi',
    currencyAmount: '100', currencyFrom: 'USD' as CurrencyCode, currencyTo: 'EUR' as CurrencyCode, currencyRate: '0.92',
    firstDate: today(), secondDate: today(), birthDate: '2000-01-01', ageAsOf: today()
  })

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }))
  const loanResult = useMemo(() => {
    const months = numberValue(values.loanYears) * 12
    const payment = loanPayment(numberValue(values.loanAmount), numberValue(values.loanRate), months)
    return payment === null ? null : { payment, total: payment * months, interest: payment * months - numberValue(values.loanAmount) }
  }, [values.loanAmount, values.loanRate, values.loanYears])
  const interestResult = useMemo(() => compoundInterest(
    numberValue(values.principal), numberValue(values.interestRate), numberValue(values.interestYears), numberValue(values.compounding)
  ), [values.principal, values.interestRate, values.interestYears, values.compounding])
  const tipResult = useMemo(() => tipSplit(numberValue(values.bill), numberValue(values.tipRate), numberValue(values.people)), [values.bill, values.tipRate, values.people])
  const unitOptions = UNIT_OPTIONS[values.unitCategory]
  const unitResult = useMemo(() => convertUnit(numberValue(values.unitValue), values.unitCategory, values.unitFrom, values.unitTo),
    [values.unitValue, values.unitCategory, values.unitFrom, values.unitTo])
  const currencyResult = useMemo(() => convertCurrency(numberValue(values.currencyAmount), numberValue(values.currencyRate)),
    [values.currencyAmount, values.currencyRate])
  const days = useMemo(() => dateDifferenceDays(values.firstDate, values.secondDate), [values.firstDate, values.secondDate])
  const age = useMemo(() => calculateAge(values.birthDate, values.ageAsOf), [values.birthDate, values.ageAsOf])
  const currencyOptions = CURRENCIES.map((code) => ({ id: code, label: code }))
  const dateInput = (label: string, value: string, onChange: (value: string) => void) => (
    <label className="block text-sm text-muted">
      {label}
      <input type="date" className="field mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )

  return (
    <div className="page page-lg calculator-page">
      <PageHeader title="Calculators" subtitle="Simple tools for everyday calculations." />
      <div className="calc-tabs" role="group" aria-label="Calculator type">
        {CALCULATORS.map((calculator) => (
          <button key={calculator.id} type="button" className="calc-tab" aria-pressed={active === calculator.id}
            onClick={() => setActive(calculator.id)}>{calculator.label}</button>
        ))}
      </div>

      <section className="calc-panel" aria-label={`${CALCULATORS.find((item) => item.id === active)?.label} calculator`}>
        {active === 'loan' && (
          <>
            <h2 className="text-lg font-semibold">Loan payment</h2>
            <p className="mb-5 text-sm text-muted">Estimate a fixed-rate loan with monthly payments.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Loan amount" value={values.loanAmount} min="0" onChange={(v) => set('loanAmount', v)} />
              <NumberField label="Annual interest rate (%)" value={values.loanRate} min="0" onChange={(v) => set('loanRate', v)} />
              <NumberField label="Term (years)" value={values.loanYears} min="0.5" step="0.5" onChange={(v) => set('loanYears', v)} />
            </div>
            <div className="calc-results mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <Result label="Monthly payment" value={money(loanResult?.payment ?? null)} prominent />
              <Result label="Total paid" value={money(loanResult?.total ?? null)} />
              <Result label="Total interest" value={money(loanResult?.interest ?? null)} />
            </div>
          </>
        )}

        {active === 'interest' && (
          <>
            <h2 className="text-lg font-semibold">Compound interest</h2>
            <p className="mb-5 text-sm text-muted">Estimate growth with a fixed rate and no additional contributions.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Starting amount" value={values.principal} min="0" onChange={(v) => set('principal', v)} />
              <NumberField label="Annual interest rate (%)" value={values.interestRate} min="0" onChange={(v) => set('interestRate', v)} />
              <NumberField label="Time (years)" value={values.interestYears} min="0" onChange={(v) => set('interestYears', v)} />
              <SelectField label="Compounding" value={values.compounding} onChange={(v) => set('compounding', v)}
                options={[{ id: '1', label: 'Annually' }, { id: '2', label: 'Semi-annually' }, { id: '4', label: 'Quarterly' }, { id: '12', label: 'Monthly' }, { id: '365', label: 'Daily' }]} />
            </div>
            <div className="calc-results mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Result label="Final balance" value={money(interestResult?.total ?? null)} prominent />
              <Result label="Interest earned" value={money(interestResult?.interest ?? null)} />
            </div>
          </>
        )}

        {active === 'tip' && (
          <>
            <h2 className="text-lg font-semibold">Tip & bill split</h2>
            <p className="mb-5 text-sm text-muted">Add a tip, then split the total evenly between people.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Bill amount" value={values.bill} min="0" onChange={(v) => set('bill', v)} />
              <NumberField label="Tip (%)" value={values.tipRate} min="0" onChange={(v) => set('tipRate', v)} />
              <NumberField label="People" value={values.people} min="1" step="1" onChange={(v) => set('people', v)} />
            </div>
            <div className="calc-results mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <Result label="Tip amount" value={money(tipResult?.tip ?? null)} />
              <Result label="Total bill" value={money(tipResult?.total ?? null)} />
              <Result label="Per person" value={money(tipResult?.perPerson ?? null)} prominent />
            </div>
          </>
        )}

        {active === 'percentage' && (
          <>
            <h2 className="text-lg font-semibold">Percentage</h2>
            <p className="mb-5 text-sm text-muted">Calculate a percentage, compare two values, or find what percent one is of another.</p>
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="What is (%)" value={values.percentageRate} onChange={(v) => set('percentageRate', v)} />
                <NumberField label="Of this value" value={values.percentageBase} onChange={(v) => set('percentageBase', v)} />
              </div>
              <Result label={`${values.percentageRate || '—'}% of ${values.percentageBase || '—'}`} value={decimal(percentOf(numberValue(values.percentageBase), numberValue(values.percentageRate)))} prominent />
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Change from" value={values.percentageFrom} onChange={(v) => set('percentageFrom', v)} />
                <NumberField label="Change to" value={values.percentageTo} onChange={(v) => set('percentageTo', v)} />
              </div>
              <Result label="Percentage change" value={`${decimal(percentChange(numberValue(values.percentageFrom), numberValue(values.percentageTo)))}%`} />
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Part" value={values.percentagePart} onChange={(v) => set('percentagePart', v)} />
                <NumberField label="Whole" value={values.percentageWhole} onChange={(v) => set('percentageWhole', v)} />
              </div>
              <Result label="Part as a percentage of whole" value={`${decimal(asPercentage(numberValue(values.percentagePart), numberValue(values.percentageWhole)))}%`} />
            </div>
          </>
        )}

        {active === 'unit' && (
          <>
            <h2 className="text-lg font-semibold">Unit converter</h2>
            <p className="mb-5 text-sm text-muted">Convert common measurements. Volume units use US customary measures.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Category" value={values.unitCategory} onChange={(v) => {
                const category = v as UnitCategory
                const options = UNIT_OPTIONS[category]
                setValues((current) => ({ ...current, unitCategory: category, unitFrom: options[0].id, unitTo: options[1].id }))
              }} options={Object.entries(UNIT_OPTIONS).map(([id, options]) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))} />
              <NumberField label="Value" value={values.unitValue} onChange={(v) => set('unitValue', v)} />
              <SelectField label="From" value={values.unitFrom} onChange={(v) => set('unitFrom', v)} options={unitOptions} />
              <SelectField label="To" value={values.unitTo} onChange={(v) => set('unitTo', v)} options={unitOptions} />
            </div>
            <div className="calc-results mt-6">
              <Result label="Converted value" value={`${decimal(unitResult)} ${unitOptions.find((unit) => unit.id === values.unitTo)?.id ?? ''}`} prominent />
            </div>
          </>
        )}

        {active === 'currency' && (
          <>
            <h2 className="text-lg font-semibold">Currency converter</h2>
            <p className="mb-5 text-sm text-muted">Enter the exchange rate yourself. Rates are not fetched or updated online.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Amount" value={values.currencyAmount} min="0" onChange={(v) => set('currencyAmount', v)} />
              <NumberField label={`Rate (${values.currencyTo} for 1 ${values.currencyFrom})`} value={values.currencyRate} min="0" onChange={(v) => set('currencyRate', v)} />
              <SelectField label="From" value={values.currencyFrom} onChange={(v) => set('currencyFrom', v as CurrencyCode)} options={currencyOptions} />
              <SelectField label="To" value={values.currencyTo} onChange={(v) => set('currencyTo', v as CurrencyCode)} options={currencyOptions} />
            </div>
            <div className="calc-results mt-6">
              <Result label="Converted amount" value={`${money(currencyResult)} ${values.currencyTo}`} prominent />
            </div>
          </>
        )}

        {active === 'date' && (
          <>
            <h2 className="text-lg font-semibold">Date difference</h2>
            <p className="mb-5 text-sm text-muted">Count the days between two dates, regardless of which comes first.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {dateInput('First date', values.firstDate, (v) => set('firstDate', v))}
              {dateInput('Second date', values.secondDate, (v) => set('secondDate', v))}
            </div>
            <div className="calc-results mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Result label="Days between" value={days === null ? '—' : days.toLocaleString()} prominent />
              <Result label="Weeks (approx.)" value={days === null ? '—' : decimal(days / 7, 2)} />
            </div>
          </>
        )}

        {active === 'age' && (
          <>
            <h2 className="text-lg font-semibold">Age calculator</h2>
            <p className="mb-5 text-sm text-muted">Calculate age on a chosen date, defaulting to today.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {dateInput('Date of birth', values.birthDate, (v) => set('birthDate', v))}
              {dateInput('Age on', values.ageAsOf, (v) => set('ageAsOf', v))}
            </div>
            <div className="calc-results mt-6">
              <Result label="Age" value={age ? `${age.years} years, ${age.months} months, ${age.days} days` : '—'} prominent />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
