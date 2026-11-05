import { useState, useCallback, useEffect, useMemo, Suspense, useRef } from 'react'
import { History, HelpCircle, Copy, Check, X, Pin, PinOff, Trash2, ChevronDown } from 'lucide-react'
import type { ModuleProps } from '../../lib/navigation'
import {
  CalculatorEngine,
  type OutputFormat,
  type CalcHistoryItem,
  registry,
  toLatexResult,
  readCurrencyHistoryItem
} from '../../../../shared/calculator'
import { defaultStorageAdapter } from './adapters/storage'
import { useModalDialog } from './useModalDialog'
import { CurrencyPanel } from './panels/CurrencyPanel'
import {
  Statistics as StatisticsPanel,
  Finance as FinancePanel,
  Conversion as ConversionPanel,
  Graph as GraphPanel,
  Matrix as MatrixPanel,
  CAS as CASPanel,
  Programming as ProgrammingPanel,
  DateTime as DateTimePanel
} from './panelChunks'

type CalcMode =
  | 'basic'
  | 'scientific'
  | 'statistics'
  | 'finance'
  | 'conversion'
  | 'graph'
  | 'matrix'
  | 'cas'
  | 'programming'
  | 'datetime'

const MODES: { id: CalcMode; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'scientific', label: 'Scientific' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'finance', label: 'Finance' },
  { id: 'conversion', label: 'Convert' },
  { id: 'graph', label: 'Graph' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'cas', label: 'CAS' },
  { id: 'programming', label: 'Program' },
  { id: 'datetime', label: 'Date/Time' }
]

export function Calculator(props: ModuleProps) {
  const [engine] = useState(() => new CalculatorEngine())
  const [mode, setMode] = useState<CalcMode>('basic')
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [format, setFormat] = useState<OutputFormat>('decimal')
  const [angleMode, setAngleMode] = useState<'deg' | 'rad' | 'grad'>('deg')
  const [history, setHistory] = useState<CalcHistoryItem[]>([])
  const [historyLimit, setHistoryLimit] = useState(50)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [showHistory, setShowHistory] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [helpSearch, setHelpSearch] = useState('')
  const [copiedKind, setCopiedKind] = useState<'text' | 'latex' | null>(null)
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  // Set when a currency history row is clicked: the currency panel opens with these values.
  const [currencySeed, setCurrencySeed] = useState<{ amount: string; from: string; to: string; set: string } | null>(null)

  // Autocomplete matching
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const allRegistryItems = useMemo(() => {
    return registry.listFunctions()
  }, [])

  const currentToken = useMemo(() => {
    const match = expression.match(/([a-zA-Z_]\w*)$/)
    return match ? match[1] : ''
  }, [expression])

  const suggestions = useMemo(() => {
    if (!currentToken || currentToken.length < 2) return []
    const lower = currentToken.toLowerCase()
    return allRegistryItems
      .filter((fn) => fn.name.toLowerCase().startsWith(lower) || fn.name.toLowerCase().includes(lower))
      .slice(0, 5)
  }, [currentToken, allRegistryItems])

  const copyToClipboard = (text: string, kind: 'text' | 'latex') => {
    void navigator.clipboard.writeText(text)
    setCopiedKind(kind)
    setTimeout(() => setCopiedKind(null), 1500)
  }

  const applySuggestion = (fnName: string) => {
    const newExpr = expression.slice(0, expression.length - currentToken.length) + fnName + '('
    setExpression(newExpr)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const loadHistory = useCallback(async (limit = historyLimit) => {
    const items = await defaultStorageAdapter.loadHistory(limit)
    setHistory(items)
    // The adapter returns exactly `limit` rows when more exist; a shorter page means
    // everything stored is on screen and the "Load more" control can be hidden.
    setHistoryTotal(items.length < limit ? items.length : limit + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const loadMoreHistory = async () => {
    const next = historyLimit + 50
    setHistoryLimit(next)
    await loadHistory(next)
  }

  const togglePin = async (item: CalcHistoryItem) => {
    await defaultStorageAdapter.togglePinHistory(item.id)
    setHistory((prev) => prev.map((i) => (i.id === item.id ? { ...i, pinned: !i.pinned } : i)))
  }

  const deleteHistoryItem = async (item: CalcHistoryItem) => {
    await defaultStorageAdapter.deleteHistoryItem(item.id)
    setHistory((prev) => prev.filter((i) => i.id !== item.id))
    setHistoryTotal((t) => Math.max(0, t - 1))
  }

  const handleAngleModeChange = (mode: 'deg' | 'rad' | 'grad') => {
    setAngleMode(mode)
    engine.setAngleMode(mode)
  }

  const handleCalculate = useCallback(async () => {
    if (!expression.trim()) return

    const res = engine.calculate(expression, format)
    if (res.error) {
      setError(res.error)
      setResult('')
    } else {
      setError(null)
      setResult(res.formatted)

      const saved = await defaultStorageAdapter.saveHistory({
        // Standard for the shared keypad in both basic and scientific mode; the
        // scientific keypad only adds function keys, so the row reads the same.
        mode: 'standard',
        input: expression,
        result: res.formatted,
        resultFormat: format
      })
      setHistory((prev) => [saved, ...prev.filter((i) => i.id !== saved.id)])
    }
  }, [engine, expression, format, mode])

  // Re-show a stored currency conversion: open the Convert tab on the currency view
  // with the amount and both codes filled in. The stored snapshot stays on the row.
  const openHistoryItem = (item: CalcHistoryItem) => {
    const currency = readCurrencyHistoryItem(item)
    if (currency) {
      setMode('conversion')
      setCurrencySeed({ amount: currency.amount, from: currency.from, to: currency.to, set: currency.set })
      setExpression(item.input)
      setResult(item.result)
      return
    }
    // Panel rows with their own engine (statistics/finance/…) save through the panel.
    setExpression(item.input)
    setResult(item.result)
  }

  const append = (str: string) => {
    setExpression((prev) => prev + str)
  }

  const clear = () => {
    setExpression('')
    setResult('')
    setError(null)
  }

  const deleteChar = () => {
    setExpression((prev) => prev.slice(0, -1))
  }

  const keypadButtons = useMemo(() => [
    ['C', '(', ')', '/'],
    ['7', '8', '9', '*'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '^', '=']
  ], [])

  // Scientific mode adds the common function keys above the digits.
  const scientificKeys = ['sin', 'cos', 'tan', 'ln', 'log10', 'sqrt', 'fact', 'pi']

  const helpDialog = useModalDialog(showHelp, () => setShowHelp(false))

  return (
    <div className="page page-lg calculator-module">
      {/* Header: row 1 title + subtitle, row 2 toolbar. No absolute positioning: the toolbar wraps. */}
      <header className="calc-head">
        <div className="calc-head-title">
          <h1 className="page-title">Calculator</h1>
          <p className="page-sub">Mathematical engine with exact arithmetic and scientific functions</p>
        </div>

        <div className="calc-toolbar">
          <div className="seg calc-modes" role="tablist" aria-label="Calculator mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="calc-tools">
            <div className="seg" role="group" aria-label="Angle mode">
              <button type="button" aria-pressed={angleMode === 'deg'} onClick={() => handleAngleModeChange('deg')}>
                DEG
              </button>
              <button type="button" aria-pressed={angleMode === 'rad'} onClick={() => handleAngleModeChange('rad')}>
                RAD
              </button>
              <button type="button" aria-pressed={angleMode === 'grad'} onClick={() => handleAngleModeChange('grad')}>
                GRAD
              </button>
            </div>

            <label className="sr-only" htmlFor="calc-output-format">Output format</label>
            <select
              id="calc-output-format"
              className="field calc-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as OutputFormat)}
            >
              <option value="decimal">Decimal</option>
              <option value="fraction">Fraction</option>
              <option value="scientific">Scientific</option>
              <option value="engineering">Engineering</option>
            </select>

            <button type="button" className="btn btn-sm" onClick={() => setShowHelp(true)} ref={helpDialog.triggerRef}>
              <HelpCircle aria-hidden="true" className="calc-ico" />
              <span className="calc-btn-label">Help / Reference</span>
              <span className="calc-btn-label-short">Help</span>
            </button>

            <button type="button" className="btn btn-sm" onClick={() => setShowHistory((h) => !h)} aria-pressed={showHistory}>
              <History aria-hidden="true" className="calc-ico" />
              <span className="calc-btn-label">History ({history.length})</span>
              <span className="calc-btn-label-short">History</span>
            </button>
          </div>
        </div>
      </header>

      {mode === 'statistics' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-statistics">
          <Suspense fallback={<p className="text-sm text-muted">Loading statistics…</p>}>
            <StatisticsPanel {...props} onClose={() => setMode('basic')} />
          </Suspense>
        </div>
      ) : mode === 'finance' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-finance">
          <Suspense fallback={<p className="text-sm text-muted">Loading finance tools…</p>}>
            <FinancePanel {...props} />
          </Suspense>
        </div>
      ) : mode === 'conversion' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-conversion">
          <Suspense fallback={<p className="text-sm text-muted">Loading conversion tools…</p>}>
            <ConversionPanel {...props} currencySeed={currencySeed} onCurrencySeedUsed={() => setCurrencySeed(null)} />
          </Suspense>
        </div>
      ) : mode === 'graph' ? (
        <div className="mt-4" data-testid="panel-graph">
          <Suspense fallback={<p className="text-sm text-muted">Loading 2D graphing engine…</p>}>
            <GraphPanel {...props} angleMode={angleMode} />
          </Suspense>
        </div>
      ) : mode === 'matrix' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-matrix">
          <Suspense fallback={<p className="text-sm text-muted">Loading matrix engine…</p>}>
            <MatrixPanel {...props} />
          </Suspense>
        </div>
      ) : mode === 'cas' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-cas">
          <Suspense fallback={<p className="text-sm text-muted">Loading CAS symbolic math…</p>}>
            <CASPanel {...props} />
          </Suspense>
        </div>
      ) : mode === 'programming' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-programming">
          <Suspense fallback={<p className="text-sm text-muted">Loading programming tools…</p>}>
            <ProgrammingPanel {...props} />
          </Suspense>
        </div>
      ) : mode === 'datetime' ? (
        <div className="mt-4 max-w-3xl" data-testid="panel-datetime">
          <Suspense fallback={<p className="text-sm text-muted">Loading date & time tools…</p>}>
            <DateTimePanel {...props} />
          </Suspense>
        </div>
      ) : (
      <div className="calc-basic mt-4" data-testid={`panel-${mode}`}>
        <div className="calc-main space-y-4">
          <div className="rounded-lg border border-line bg-card p-4 shadow-card relative">
            <input
              ref={inputRef}
              type="text"
              className="field text-lg font-mono calc-expr"
              placeholder="e.g. 2(3 + 4) or sin(45) or sqrt(144)"
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setShowSuggestions(false)
                  void handleCalculate()
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false)
                } else if (e.key === 'ArrowUp') {
                  if (history.length > 0) {
                    e.preventDefault()
                    const nextIdx = Math.min(history.length - 1, historyIndex + 1)
                    setHistoryIndex(nextIdx)
                    setExpression(history[nextIdx].input)
                  }
                } else if (e.key === 'ArrowDown') {
                  if (historyIndex > 0) {
                    e.preventDefault()
                    const nextIdx = historyIndex - 1
                    setHistoryIndex(nextIdx)
                    setExpression(history[nextIdx].input)
                  } else if (historyIndex === 0) {
                    e.preventDefault()
                    setHistoryIndex(-1)
                    setExpression('')
                  }
                } else if (e.key === 'Tab' && suggestions.length > 0) {
                  e.preventDefault()
                  applySuggestion(suggestions[0].name)
                }
              }}
              autoFocus
            />

            {/* Autocomplete Suggestions Menu */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-4 right-4 z-20 mt-1 rounded-md border border-line bg-card shadow-card overflow-hidden text-xs">
                {suggestions.map((fn) => (
                  <div
                    key={fn.name}
                    className="p-2 hover:bg-fg/10 cursor-pointer flex items-center justify-between gap-3 border-b border-line/40 last:border-0"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applySuggestion(fn.name)
                    }}
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-accent-fg">{fn.name}(...)</span>
                      <span className="text-muted ml-2">{fn.description}</span>
                    </div>
                    {fn.examples?.[0] && (
                      <span className="text-[11px] font-mono text-muted shrink-0">{fn.examples[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 min-h-[1.75rem]">
              <div className="text-sm min-w-0">
                {error && <span className="text-neg font-medium break-words">{error}</span>}
              </div>
              <div className="flex items-center gap-3 min-w-0">
                {result && (
                  <>
                    <span className="text-2xl font-bold font-mono tracking-tight text-fg break-all text-right">
                      = {result}
                    </span>
                    <div className="flex items-center gap-1 border-l border-line pl-3">
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Copy plain result"
                        onClick={() => copyToClipboard(result, 'text')}
                      >
                        {copiedKind === 'text' ? <Check aria-hidden="true" className="calc-ico text-pos" /> : <Copy aria-hidden="true" className="calc-ico" />}
                        {copiedKind === 'text' ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm font-mono"
                        title="Copy LaTeX format"
                        onClick={() => copyToClipboard(toLatexResult(result), 'latex')}
                      >
                        {copiedKind === 'latex' ? <Check aria-hidden="true" className="calc-ico text-pos" /> : null}
                        {copiedKind === 'latex' ? 'Copied' : 'LaTeX'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Scientific function keys (Scientific mode only) */}
          {mode === 'scientific' && (
            <div className="calc-keypad grid grid-cols-4 gap-2">
              {scientificKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn btn-sm font-mono"
                  onClick={() => (k === 'pi' ? append('pi') : append(`${k}(`))}
                >
                  {k === 'pi' ? 'π' : k}
                </button>
              ))}
            </div>
          )}

          {/* Keypad */}
          <div className="calc-keypad grid grid-cols-4 gap-2">
            {keypadButtons.map((row, rIdx) =>
              row.map((btn, cIdx) => (
                <button
                  key={`${rIdx}-${cIdx}`}
                  type="button"
                  className={`btn py-3 text-base font-semibold ${
                    btn === '=' ? 'btn-primary' : btn === 'C' ? 'btn-danger' : ''
                  }`}
                  onClick={() => {
                    if (btn === '=') void handleCalculate()
                    else if (btn === 'C') clear()
                    else append(btn)
                  }}
                >
                  {btn}
                </button>
              ))
            )}
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
        <aside className="calc-history rounded-lg border border-line bg-card p-4 shadow-card flex flex-col">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-line">
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <History aria-hidden="true" className="calc-ico text-muted" /> Calculation History
            </h2>
            {history.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await defaultStorageAdapter.clearHistory()
                  setHistory([])
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto mt-2 space-y-2">
            {history.length === 0 ? (
              <div className="calc-history-empty">
                <p className="text-xs text-muted">No calculations yet.</p>
                <p className="text-[11px] text-muted/80 mt-1">
                  Results you evaluate appear here. Press <kbd className="calc-kbd">↑</kbd> in the input to
                  recall the last one.
                </p>
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="calc-history-row"
                  data-pinned={item.pinned === true}
                  data-testid={`calc-history-row-${item.id}`}
                >
                  <button
                    type="button"
                    className="calc-history-main w-full text-left p-2 rounded border border-line hover:bg-fg/5 cursor-pointer text-xs"
                    onClick={() => openHistoryItem(item)}
                  >
                    <div className="text-muted font-mono break-all">{item.input}</div>
                    <div className="font-semibold font-mono mt-0.5 text-right text-fg break-all">
                      = {item.result}
                    </div>
                    {item.mode === 'currency' && (
                      <div className="calc-cur-history-tags">
                        <span className="badge badge-muted">currency</span>
                        {readCurrencyHistoryItem(item)?.override && <span className="badge badge-open">override</span>}
                        {readCurrencyHistoryItem(item)?.stale && <span className="badge badge-neg">stale rate</span>}
                      </div>
                    )}
                  </button>
                  <div className="calc-history-row-actions">
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={item.pinned ? `Unpin ${item.input}` : `Pin ${item.input}`}
                      aria-pressed={item.pinned === true}
                      data-testid={`calc-history-pin-${item.id}`}
                      onClick={() => void togglePin(item)}
                    >
                      {item.pinned ? (
                        <PinOff aria-hidden="true" className="calc-ico text-accent-fg" />
                      ) : (
                        <Pin aria-hidden="true" className="calc-ico" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`Delete ${item.input}`}
                      data-testid={`calc-history-delete-${item.id}`}
                      onClick={() => void deleteHistoryItem(item)}
                    >
                      <Trash2 aria-hidden="true" className="calc-ico" />
                    </button>
                  </div>
                </div>
              ))
            )}
            {history.length > 0 && historyTotal > history.length && (
              <button
                type="button"
                className="btn btn-sm w-full"
                data-testid="calc-history-load-more"
                onClick={() => void loadMoreHistory()}
              >
                <ChevronDown aria-hidden="true" className="calc-ico" />
                Load more
              </button>
            )}
          </div>
        </aside>
        )}
      </div>
      )}
      {/* Function Reference / Help Modal */}
      {showHelp && (
        <div
          className="calc-help-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Function reference and help"
          tabIndex={-1}
          ref={helpDialog.overlayRef}
          onKeyDown={helpDialog.onKeyDown}
        >
          <div className="w-full max-w-2xl max-h-[80vh] rounded-lg border border-line bg-card shadow-card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-4 border-b border-line">
              <div className="flex items-center gap-2 min-w-0">
                <HelpCircle aria-hidden="true" className="calc-ico text-accent-fg" />
                <h2 className="font-semibold text-sm">Function Reference &amp; Help</h2>
              </div>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Close help"
                data-testid="calc-help-close"
                onClick={() => setShowHelp(false)}
              >
                <X aria-hidden="true" className="calc-ico" />
              </button>
            </div>

            <div className="p-3 border-b border-line">
              <input
                className="field text-xs font-mono"
                placeholder="Search functions, constants, or formulas..."
                value={helpSearch}
                onChange={(e) => setHelpSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {allRegistryItems
                .filter(
                  (fn) =>
                    !helpSearch ||
                    fn.name.toLowerCase().includes(helpSearch.toLowerCase()) ||
                    fn.description.toLowerCase().includes(helpSearch.toLowerCase()) ||
                    fn.category.toLowerCase().includes(helpSearch.toLowerCase())
                )
                .map((fn) => (
                  <div key={fn.name} className="p-2.5 rounded border border-line text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-sm text-accent-fg">{fn.name}(...)</span>
                      <span className="text-[10px] uppercase font-semibold text-muted tracking-wider">
                        {fn.category}
                      </span>
                    </div>
                    <p className="text-muted mt-1">{fn.description}</p>
                    {fn.examples && fn.examples.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted">Try:</span>
                        {fn.examples.map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            className="btn btn-sm font-mono"
                            onClick={() => {
                              setExpression(ex)
                              setShowHelp(false)
                              inputRef.current?.focus()
                            }}
                          >
                            {ex}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default Calculator
