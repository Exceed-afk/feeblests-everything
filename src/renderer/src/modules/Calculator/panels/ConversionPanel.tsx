import { useState, useMemo, useEffect } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  UNIT_CATEGORIES,
  convertUnit,
  convertBase,
  formatBaseWithGrouping,
  type UnitDef,
  type UnitCategoryDef
} from '../../../../../shared/calculator/modules/conversions'
import { Decimal } from '../../../../../shared/calculator/numeric'
import { CurrencyPanel } from './CurrencyPanel'

type ConversionTab = 'units' | 'bases' | 'currency'

interface ConversionPanelProps extends ModuleProps {
  /** Set when a currency history row was clicked: pre-fill the currency tab. */
  currencySeed?: { amount: string; from: string; to: string; set: string } | null
  onCurrencySeedUsed?: () => void
}

export function ConversionPanel({ currencySeed, onCurrencySeedUsed, ...props }: ConversionPanelProps) {
  const [tab, setTab] = useState<ConversionTab>(currencySeed ? 'currency' : 'units')

  // A history click arrives after mount, so follow it into the currency tab.
  useEffect(() => {
    if (currencySeed) setTab('currency')
  }, [currencySeed])

  // --- Units State ---
  const [unitCategory, setUnitCategory] = useState('length')
  const [fromUnit, setFromUnit] = useState('km')
  const [toUnit, setToUnit] = useState('mi')
  const [unitValue, setUnitValue] = useState('1')
  const [unitResult, setUnitResult] = useState<string | null>(null)
  const [unitError, setUnitError] = useState<string | null>(null)

  const currentCategoryUnits = useMemo(() => {
    return UNIT_CATEGORIES[unitCategory]?.units || []
  }, [unitCategory])

  useEffect(() => {
    if (currentCategoryUnits.length >= 2) {
      setFromUnit(currentCategoryUnits[0].id)
      setToUnit(currentCategoryUnits[1].id)
    }
  }, [currentCategoryUnits])

  const handleConvertUnit = () => {
    setUnitError(null)
    try {
      const v = new Decimal(unitValue)
      const res = convertUnit(v, unitCategory, fromUnit, toUnit)
      setUnitResult(res.toDecimalPlaces(8).toString())
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Number Bases State ---
  const [baseInput, setBaseInput] = useState('255')
  const [fromBase, setFromBase] = useState('10')
  const [toBase, setToBase] = useState('16')
  const [baseResult, setBaseResult] = useState<string | null>(null)
  const [baseError, setBaseError] = useState<string | null>(null)

  const handleConvertBase = () => {
    setBaseError(null)
    try {
      const fb = parseInt(fromBase, 10)
      const tb = parseInt(toBase, 10)
      const res = convertBase(baseInput, fb, tb)
      const grouped = formatBaseWithGrouping(res, tb)
      setBaseResult(grouped)
    } catch (err) {
      setBaseError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Currency conversions live in their own panel (CurrencyPanel). ---

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="seg flex-wrap" role="group">
        {(['units', 'bases', 'currency'] as ConversionTab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t} className="btn"
            onClick={() => setTab(t)}
          >
            {t === 'units' && 'Unit Converter'}
            {t === 'bases' && 'Number Bases'}
            {t === 'currency' && 'Offline Currency Rates'}
          </button>
        ))}
      </div>

      {/* 1. Unit Converter */}
      {tab === 'units' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Category</label>
              <select
                className="field w-full text-xs"
                value={unitCategory}
                onChange={(e) => setUnitCategory(e.target.value)}
              >
                {(Object.values(UNIT_CATEGORIES) as UnitCategoryDef[]).map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Value</label>
              <input
                className="field w-full text-xs font-mono"
                value={unitValue}
                onChange={(e) => setUnitValue(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">From</label>
              <select className="field w-full text-xs" value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
                {currentCategoryUnits.map((u: UnitDef) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">To</label>
              <select className="field w-full text-xs" value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
                {currentCategoryUnits.map((u: UnitDef) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleConvertUnit}>
            Convert Unit
          </button>

          {unitError && <p className="text-xs text-neg">{unitError}</p>}
          {unitResult && (
            <div className="p-3 rounded border border-line bg-accent/5">
              <span className="text-xs text-muted">Result: </span>
              <span className="text-lg font-bold font-mono text-accent-fg">
                {unitValue} {fromUnit} = {unitResult} {toUnit}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 2. Number Bases */}
      {tab === 'bases' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Value</label>
              <input
                className="field w-full text-xs font-mono"
                placeholder="e.g. 255 or 101010 or FF"
                value={baseInput}
                onChange={(e) => setBaseInput(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">From Base</label>
              <select className="field w-full text-xs" value={fromBase} onChange={(e) => setFromBase(e.target.value)}>
                <option value="2">Binary (2)</option>
                <option value="8">Octal (8)</option>
                <option value="10">Decimal (10)</option>
                <option value="16">Hexadecimal (16)</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">To Base</label>
              <select className="field w-full text-xs" value={toBase} onChange={(e) => setToBase(e.target.value)}>
                <option value="2">Binary (2)</option>
                <option value="8">Octal (8)</option>
                <option value="10">Decimal (10)</option>
                <option value="16">Hexadecimal (16)</option>
              </select>
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleConvertBase}>
            Convert Base
          </button>

          {baseError && <p className="text-xs text-neg">{baseError}</p>}
          {baseResult && (
            <div className="p-3 rounded border border-line bg-accent/5">
              <span className="text-xs text-muted">Base {toBase} Output: </span>
              <span className="text-lg font-bold font-mono text-accent-fg tracking-wider">{baseResult}</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Offline Currency Rates */}
      {tab === 'currency' && (
        <CurrencyPanel
          {...props}
          seed={currencySeed ?? null}
          onSeedUsed={onCurrencySeedUsed}
        />
      )}
    </div>
  )
}
export default ConversionPanel
