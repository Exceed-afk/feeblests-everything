import { useState } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  dateDifference,
  addDateInterval,
  subtractDateInterval,
  calculateAgeDetailed,
  businessDaysBetween,
  addBusinessDays,
  durationArithmetic,
  timeZoneConvert
} from '../../../../../shared/calculator/modules/datetime'

type DateSubTab = 'diff' | 'calc' | 'age' | 'duration' | 'tz'

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function DateTimePanel(_props: ModuleProps) {
  const [tab, setTab] = useState<DateSubTab>('diff')

  // --- Difference State ---
  const [date1, setDate1] = useState(today())
  const [date2, setDate2] = useState(today())
  const [diffResult, setDiffResult] = useState<string | null>(null)

  const handleComputeDiff = () => {
    try {
      const res = dateDifference(date1, date2)
      const bDays = businessDaysBetween(date1, date2)
      setDiffResult(
        `${res.days} total days (${res.years}y, ${res.months}m, ${res.daysRemainder}d) | Working days: ${bDays}`
      )
    } catch {
      setDiffResult('Invalid date format')
    }
  }

  // --- Add / Subtract Days ---
  const [baseDate, setBaseDate] = useState(today())
  const [daysAmount, setDaysAmount] = useState('30')
  const [calcOp, setCalcOp] = useState<'add' | 'sub'>('add')
  const [calcResult, setCalcResult] = useState<string | null>(null)

  const handleCalcDate = () => {
    try {
      const n = parseInt(daysAmount, 10) || 0
      const out =
        calcOp === 'add'
          ? addDateInterval(baseDate, { days: n })
          : subtractDateInterval(baseDate, { days: n })
      setCalcResult(out)
    } catch {
      setCalcResult('Date error')
    }
  }

  // --- Age State ---
  const [birthDate, setBirthDate] = useState('2000-01-01')
  const [asOfDate, setAsOfDate] = useState(today())
  const [ageResult, setAgeResult] = useState<string | null>(null)

  const handleCalcAge = () => {
    try {
      const res = calculateAgeDetailed(birthDate, asOfDate)
      setAgeResult(`${res.years} years, ${res.months} months, ${res.days} days`)
    } catch {
      setAgeResult('Invalid date')
    }
  }

  // --- Duration Arithmetic ---
  const [dur1, setDur1] = useState('2h 30m')
  const [durOp, setDurOp] = useState<'+' | '-'>('+')
  const [dur2, setDur2] = useState('45m')
  const [durResult, setDurResult] = useState<string | null>(null)

  const handleCalcDuration = () => {
    try {
      const res = durationArithmetic(dur1, durOp, dur2)
      setDurResult(`${res.formatted} (${res.totalSeconds}s)`)
    } catch {
      setDurResult('Duration error')
    }
  }

  // --- Time Zone Conversion ---
  const [tzDateTime, setTzDateTime] = useState(`${today()} 12:00`)
  const [tzFrom, setTzFrom] = useState('0')
  const [tzTo, setTzTo] = useState('3')
  const [tzResult, setTzResult] = useState<string | null>(null)

  const handleCalcTz = () => {
    try {
      const out = timeZoneConvert(tzDateTime, parseFloat(tzFrom) || 0, parseFloat(tzTo) || 0)
      setTzResult(out)
    } catch {
      setTzResult('Time zone error')
    }
  }

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-theme pb-2 text-sm">
        {(['diff', 'calc', 'age', 'duration', 'tz'] as DateSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`px-3 py-1.5 rounded-md font-medium ${tab === t ? 'bg-theme text-white' : 'btn-subtle text-muted'
              }`}
            onClick={() => setTab(t)}
          >
            {t === 'diff' && 'Date Difference'}
            {t === 'calc' && 'Add / Subtract Days'}
            {t === 'age' && 'Age Calculator'}
            {t === 'duration' && 'Duration (2h 30m)'}
            {t === 'tz' && 'Time Zone Shift'}
          </button>
        ))}
      </div>

      {/* 1. Difference */}
      {tab === 'diff' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Start Date</label>
              <input type="date" className="field w-full text-xs" value={date1} onChange={(e) => setDate1(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">End Date</label>
              <input type="date" className="field w-full text-xs" value={date2} onChange={(e) => setDate2(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleComputeDiff}>
            Calculate Difference
          </button>

          {diffResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              {diffResult}
            </div>
          )}
        </div>
      )}

      {/* 2. Add / Subtract Days */}
      {tab === 'calc' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Base Date</label>
              <input type="date" className="field w-full text-xs" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Operation</label>
              <select className="field w-full text-xs" value={calcOp} onChange={(e) => setCalcOp(e.target.value as any)}>
                <option value="add">Add (+)</option>
                <option value="sub">Subtract (-)</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Days</label>
              <input className="field w-full text-xs font-mono" value={daysAmount} onChange={(e) => setDaysAmount(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleCalcDate}>
            Calculate Date
          </button>

          {calcResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              Result Date: {calcResult}
            </div>
          )}
        </div>
      )}

      {/* 3. Age */}
      {tab === 'age' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Birth Date</label>
              <input type="date" className="field w-full text-xs" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">As Of Date</label>
              <input type="date" className="field w-full text-xs" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleCalcAge}>
            Calculate Age
          </button>

          {ageResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              Age: {ageResult}
            </div>
          )}
        </div>
      )}

      {/* 4. Duration Arithmetic */}
      {tab === 'duration' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Duration 1 (e.g. 2h 30m)</label>
              <input className="field w-full text-xs font-mono" value={dur1} onChange={(e) => setDur1(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Operation</label>
              <select className="field w-full text-xs" value={durOp} onChange={(e) => setDurOp(e.target.value as any)}>
                <option value="+">Plus (+)</option>
                <option value="-">Minus (-)</option>
              </select>
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">Duration 2 (e.g. 45m)</label>
              <input className="field w-full text-xs font-mono" value={dur2} onChange={(e) => setDur2(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleCalcDuration}>
            Calculate Duration
          </button>

          {durResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              Result: {durResult}
            </div>
          )}
        </div>
      )}

      {/* 5. Time Zone Shift */}
      {tab === 'tz' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">DateTime (YYYY-MM-DD HH:mm)</label>
              <input className="field w-full text-xs font-mono" value={tzDateTime} onChange={(e) => setTzDateTime(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">From UTC Offset (Hours)</label>
              <input className="field w-full text-xs font-mono" value={tzFrom} onChange={(e) => setTzFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-muted block text-xs mb-1">To UTC Offset (Hours)</label>
              <input className="field w-full text-xs font-mono" value={tzTo} onChange={(e) => setTzTo(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleCalcTz}>
            Shift Time Zone
          </button>

          {tzResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              Converted Time: {tzResult}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default DateTimePanel
