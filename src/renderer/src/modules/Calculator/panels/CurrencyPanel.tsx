// Currency conversion UI for the Calculator's Convert tab (Section 7).
//
// Everything here is presentation plus calls into:
//   - the pure logic in src/shared/calculator/rates.ts (effective rates, validation,
//     staleness, CSV/JSON parsing and validation),
//   - the storage adapter (which is the SQLite-backed IPC bridge in the app).
//
// Rules honoured in this file:
//   - Theme tokens / shared classes only. No literal colours, no invented utilities.
//   - Stored rates are never rounded: they live as the exact strings the logic layer gave us.
//     Only the *displayed* conversion result is rounded (currencyDisplayDecimals setting).
//   - A save/update never creates a duplicate row: new codes go through saveRate (which
//     upserts by code), edits go through updateRate (which updates the row in place).
//   - Import is PREVIEW first, then applied transactionally by the main process.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileUp,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { ModuleProps } from '../../../lib/navigation'
import { Decimal } from '../../../../../shared/calculator/numeric'
// Import straight from the logic module: the conversions barrel re-exports these
// names, and importing both barrels would make the names ambiguous.
import {
  performCurrencyConversion,
  validateCurrencyCode,
  checkRateStaleness,
  exportRateSetToCsv,
  exportRateSetToJson,
  parseAndValidateRatesCsv,
  parseAndValidateRatesJson,
  type CurrencyConversionOutput
} from '../../../../../shared/calculator/rates'
import {
  buildCurrencyHistoryItem,
  describeDays,
  formatRateDate,
  isDefaultRateSet,
  sortRatesForDisplay,
  DEFAULT_DISPLAY_DECIMALS,
  DISPLAY_DECIMALS_OPTIONS
} from '../../../../../shared/calculator/currencyUi'
import { defaultStorageAdapter } from '../adapters/storage'
import { useModalDialog } from '../useModalDialog'
import type {
  CalcRate,
  CalcRateOverride,
  CalcRateSet,
  CalcSettings,
  RateSetImportRow
} from '../../../../../shared/calculator/types'

interface Props extends ModuleProps {
  onClose?: () => void
  /** From a currency history row: amount, both codes and the rate set to reopen. */
  seed?: { amount: string; from: string; to: string; set: string } | null
  onSeedUsed?: () => void
}

type ImportMode = 'merge' | 'replace'
type ImportFormat = 'auto' | 'csv' | 'json'

interface ImportDraft {
  format: ImportFormat
  text: string
  fileName: string
  mode: ImportMode
  applyTo: string
}

interface ImportPreviewState extends ImportDraft {
  rows: RateSetImportRow[]
  error: string | null
  duplicateCodes: string[]
}

const emptyDraft: ImportDraft = { format: 'auto', text: '', fileName: '', mode: 'merge', applyTo: '' }

/** Detect the format of pasted text so a spreadsheet paste and a JSON file both work. */
function detectFormat(text: string): 'csv' | 'json' {
  const first = text.trim().slice(0, 1)
  return first === '{' || first === '[' ? 'json' : 'csv'
}

function parseImportRows(text: string, format: ImportFormat): RateSetImportRow[] {
  const chosen = format === 'auto' ? detectFormat(text) : format
  return chosen === 'json' ? parseAndValidateRatesJson(text) : parseAndValidateRatesCsv(text)
}

/**
 * Duplicate codes are already a hard error in the logic layer, so this only reports
 * what the parser would have rejected — used to show "duplicates" in the preview.
 */
function findDuplicateCodes(text: string, format: ImportFormat): string[] {
  try {
    parseImportRows(text, format)
    return []
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    const dupes = message.match(/duplicate currency code "([A-Z0-9]{3,5})"/g) ?? []
    return [...new Set(dupes.map((m) => m.replace(/.*"([A-Z0-9]{3,5})".*/, '$1')))]
  }
}

function parseRateNumber(value: string): Decimal | null {
  try {
    const d = new Decimal(value.trim())
    return d.isFinite() && d.isPositive() ? d : null
  } catch {
    return null
  }
}

/**
 * Which currency a "Missing rate" message blames.
 * performCurrencyConversion reports only the pair, so look the codes up in the set and
 * name the one that has no rate. Picks the destination when both are missing, which is
 * the more common "I am converting into X I have never set up" case.
 */
export function missingCurrencyCode(message: string, from: string, to: string, present: Set<string>): string | null {
  if (!/Missing rate/i.test(message)) return null
  if (!present.has(to)) return to
  if (!present.has(from)) return from
  const quoted = message.match(/\b([A-Z0-9]{3,5})\b/g)
  return quoted ? quoted[quoted.length - 1] : null
}

export function CurrencyPanel({ onClose: _onClose, seed, onSeedUsed }: Props) {
  const [settings, setSettings] = useState<CalcSettings | null>(null)
  const [rateSets, setRateSets] = useState<CalcRateSet[]>([])
  const [activeSetId, setActiveSetId] = useState('default')
  const [rates, setRates] = useState<CalcRate[]>([])
  const [overrides, setOverrides] = useState<CalcRateOverride[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const activeSet = useMemo(
    () => rateSets.find((s) => s.id === activeSetId) ?? rateSets[0] ?? null,
    [rateSets, activeSetId]
  )
  const baseCurrency = activeSet?.baseCurrency ?? 'USD'

  // ---------------------------------------------------------------- conversion
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('EUR')
  const [missing, setMissing] = useState<string | null>(null)
  const [conversion, setConversion] = useState<{
    output: CurrencyConversionOutput
    rounded: string
    amount: string
    from: string
    to: string
  } | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [savedToHistory, setSavedToHistory] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)

  // ---------------------------------------------------------------- rate form
  const [newCode, setNewCode] = useState('')
  const [newRate, setNewRate] = useState('')
  const [newNote, setNewNote] = useState('')
  const [rateFormError, setRateFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRate, setEditRate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const editFirstFieldRef = useRef<HTMLInputElement | null>(null)

  // ---------------------------------------------------------------- rate sets
  const [setName, setSetName] = useState('')
  const [setError, setSetError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ---------------------------------------------------------------- overrides
  const [ovFrom, setOvFrom] = useState('')
  const [ovTo, setOvTo] = useState('')
  const [ovRate, setOvRate] = useState('')
  const [ovError, setOvError] = useState<string | null>(null)

  // ---------------------------------------------------------------- import
  const [draft, setDraft] = useState<ImportDraft>(emptyDraft)
  const [preview, setPreview] = useState<ImportPreviewState | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const displayDecimals = settings?.currencyDisplayDecimals ?? DEFAULT_DISPLAY_DECIMALS
  const staleDays = settings?.staleRateDays ?? 7

  const deleteDialog = useModalDialog(!!confirmDeleteId, () => setConfirmDeleteId(null))
  const previewDialog = useModalDialog(!!preview, () => setPreview(null))

  // ---------------------------------------------------------------- loading
  const loadSetData = useCallback(async (setId: string) => {
    try {
      const [loadedRates, loadedOverrides] = await Promise.all([
        defaultStorageAdapter.loadRates(setId),
        defaultStorageAdapter.listRateOverrides(setId)
      ])
      setRates(loadedRates)
      setOverrides(loadedOverrides)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load rates. Are you inside the desktop app?')
    }
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [allSettings, sets] = await Promise.all([
        defaultStorageAdapter.getAllSettings(),
        defaultStorageAdapter.loadRateSets()
      ])
      setSettings(allSettings)
      setRateSets(sets)
      const chosen = sets.find((s) => s.id === activeSetId) ?? sets.find((s) => s.isActive) ?? sets[0]
      if (chosen) {
        setActiveSetId(chosen.id)
        await loadSetData(chosen.id)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load currency settings.')
    }
    // activeSetId intentionally read once: the picker re-runs this itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSetData])

  const applySeed = useCallback(
    (next: { amount: string; from: string; to: string; set: string }) => {
      setAmount(next.amount)
      setFrom(next.from)
      setTo(next.to)
      setConversion(null)
      setMissing(null)
      setConvertError(null)
      onSeedUsed?.()
    },
    [onSeedUsed]
  )

  useEffect(() => {
    void (async () => {
      await loadAll()
      if (seed) applySeed(seed)
    })()
    // Runs once on mount: a seed that arrives later is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A history click arrives by prop after mount, or as the initial seed.
  const lastSeed = useRef<string | null>(null)
  useEffect(() => {
    if (!seed) return
    const key = `${seed.amount}|${seed.from}|${seed.to}|${seed.set}`
    if (lastSeed.current === key) return
    lastSeed.current = key
    void (async () => {
      if (seed.set && seed.set !== activeSetId && rateSets.some((s) => s.id === seed.set)) {
        await pickSet(seed.set)
      }
      applySeed(seed)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  const pickSet = async (id: string) => {
    setActiveSetId(id)
    setConversion(null)
    setMissing(null)
    setPreview(null)
    setConfirmDeleteId(null)
    await loadSetData(id)
    try {
      await defaultStorageAdapter.selectRateSet(id)
      setRateSets((prev) => prev.map((s) => ({ ...s, isActive: s.id === id })))
    } catch {
      // Selecting is a convenience; the panel already shows the picked set.
    }
  }

  const saveSetting = async <K extends keyof CalcSettings>(key: K, value: CalcSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    try {
      await defaultStorageAdapter.setSetting(key, value)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not save the setting.')
    }
  }

  // ---------------------------------------------------------------- conversion
  const doConvert = async () => {
    setConvertError(null)
    setMissing(null)
    setSavedToHistory(false)
    if (!activeSet) return
    try {
      const fromCode = validateCurrencyCode(from)
      const toCode = validateCurrencyCode(to)
      const amt = new Decimal(amount.trim())
      if (!amt.isFinite()) throw new Error(`Amount "${amount}" is not a number`)

      const output = performCurrencyConversion({
        amount: amt,
        from: fromCode,
        to: toCode,
        targetSet: activeSet,
        rates,
        overrides,
        baseCurrency: validateCurrencyCode(baseCurrency),
        staleRateDays: staleDays,
        today: new Date()
      })
      const rounded = new Decimal(output.result).toDecimalPlaces(displayDecimals, Decimal.ROUND_HALF_UP).toString()
      setConversion({ output, rounded, amount: amount.trim(), from: fromCode, to: toCode })
      setFrom(fromCode)
      setTo(toCode)

      const history = buildCurrencyHistoryItem({
        amount: amount.trim(),
        from: fromCode,
        to: toCode,
        set: activeSet.id,
        rate: output.rate,
        rates: output.snapshot.ratesUsed,
        override: output.isDirectOverride,
        stale: output.isStale,
        age: output.oldestRateAgeDays,
        result: output.result,
        decimals: displayDecimals
      })
      await defaultStorageAdapter.saveHistory(history)
      setSavedToHistory(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Currency conversion error'
      setConversion(null)
      // Codes may not have parsed yet when validation itself failed, so read the raw input.
      const missingCode = missingCurrencyCode(
        message,
        from.trim().toUpperCase(),
        to.trim().toUpperCase(),
        new Set([baseCurrency.trim().toUpperCase(), ...rates.map((r) => r.currencyCode)])
      )
      if (missingCode) {
        setMissing(missingCode)
      } else {
        setConvertError(message)
      }
    }
  }

  /** "Add it below": put the missing code in the rate form and focus it. */
  const startAddingMissing = () => {
    if (!missing) return
    setNewCode(missing)
    setRateFormError(null)
    document.getElementById('calc-currency-new-code')?.focus()
  }

  // ---------------------------------------------------------------- rate form
  const submitNewRate = async () => {
    setRateFormError(null)
    if (!activeSet) return
    try {
      const code = validateCurrencyCode(newCode)
      const value = parseRateNumber(newRate)
      if (!value) throw new Error(`Rate must be a positive number (got "${newRate}")`)
      const existing = rates.find((r) => r.currencyCode === code)
      const saved = existing
        ? await defaultStorageAdapter.updateRate(existing.id, newRate.trim(), newNote.trim())
        : await defaultStorageAdapter.saveRate({
          rateSetId: activeSet.id,
          currencyCode: code,
          rateToBase: newRate.trim(),
          note: newNote.trim()
        })
      setRates((prev) => {
        const without = prev.filter((r) => r.id !== saved.id)
        return [...without, saved]
      })
      setNewCode('')
      setNewRate('')
      setNewNote('')
      setMissing(null)
      setRateFormError(null)
    } catch (err) {
      setRateFormError(err instanceof Error ? err.message : 'Could not save the rate')
    }
  }

  const beginEdit = (rate: CalcRate) => {
    setEditingId(rate.id)
    setEditRate(rate.rateToBase)
    setEditNote(rate.note ?? '')
    setEditError(null)
    requestAnimationFrame(() => editFirstFieldRef.current?.focus())
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setEditError(null)
    try {
      if (!parseRateNumber(editRate)) throw new Error(`Rate must be a positive number (got "${editRate}")`)
      const updated = await defaultStorageAdapter.updateRate(editingId, editRate.trim(), editNote.trim())
      setRates((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setEditingId(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not update the rate')
    }
  }

  // ---------------------------------------------------------------- rate sets
  const createSet = async () => {
    setSetError(null)
    const name = setName.trim()
    if (!name) {
      setSetError('Give the rate set a name.')
      return
    }
    try {
      const base = validateCurrencyCode(baseCurrency)
      const created = await defaultStorageAdapter.saveRateSet({ name, baseCurrency: base, isActive: false })
      setRateSets((prev) => [...prev, created])
      setSetName('')
      await pickSet(created.id)
    } catch (err) {
      setSetError(err instanceof Error ? err.message : 'Could not create the rate set')
    }
  }

  const saveRename = async () => {
    if (!renamingId) return
    setSetError(null)
    const name = renameValue.trim()
    if (!name) {
      setSetError('Give the rate set a name.')
      return
    }
    try {
      const renamed = await defaultStorageAdapter.renameRateSet(renamingId, name)
      setRateSets((prev) => prev.map((s) => (s.id === renamed.id ? renamed : s)))
      setRenamingId(null)
    } catch (err) {
      setSetError(err instanceof Error ? err.message : 'Could not rename the rate set')
    }
  }

  const confirmDeleteSet = async () => {
    if (!confirmDeleteId) return
    setSetError(null)
    try {
      await defaultStorageAdapter.deleteRateSet(confirmDeleteId)
      const remaining = rateSets.filter((s) => s.id !== confirmDeleteId)
      setRateSets(remaining)
      setConfirmDeleteId(null)
      if (confirmDeleteId === activeSetId) {
        const next = remaining.find((s) => s.id === 'default') ?? remaining[0]
        if (next) await pickSet(next.id)
      }
    } catch (err) {
      setSetError(err instanceof Error ? err.message : 'Could not delete the rate set')
    }
  }

  // ---------------------------------------------------------------- overrides
  const addOverride = async () => {
    setOvError(null)
    if (!activeSet) return
    try {
      const fromCode = validateCurrencyCode(ovFrom)
      const toCode = validateCurrencyCode(ovTo)
      if (fromCode === toCode) throw new Error('The two codes must differ.')
      if (!parseRateNumber(ovRate)) throw new Error(`Rate must be a positive number (got "${ovRate}")`)
      const saved = await defaultStorageAdapter.saveRateOverride({
        rateSetId: activeSet.id,
        fromCode,
        toCode,
        rate: ovRate.trim()
      })
      setOverrides((prev) => [...prev.filter((o) => o.id !== saved.id), saved])
      setOvFrom('')
      setOvTo('')
      setOvRate('')
    } catch (err) {
      setOvError(err instanceof Error ? err.message : 'Could not save the override')
    }
  }

  const removeOverride = async (id: string) => {
    setOvError(null)
    try {
      await defaultStorageAdapter.deleteRateOverride(id)
      setOverrides((prev) => prev.filter((o) => o.id !== id))
    } catch (err) {
      setOvError(err instanceof Error ? err.message : 'Could not delete the override')
    }
  }

  // ---------------------------------------------------------------- import / export
  const exportSet = (format: 'csv' | 'json') => {
    if (!activeSet) return
    const text =
      format === 'json'
        ? exportRateSetToJson(activeSet, rates, overrides)
        : exportRateSetToCsv(rates)
    try {
      const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeSet.name.replace(/[^\w -]+/g, '').trim() || 'rates'}.${format}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportNote(`Exported ${rates.length} rate${rates.length === 1 ? '' : 's'} as ${format.toUpperCase()}.`)
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'Could not export the rate set')
    }
  }

  const readFile = async (file: File) => {
    try {
      const text = await file.text()
      setDraft((d) => ({ ...d, text, fileName: file.name, format: 'auto' }))
      setPreview(null)
      setImportError(null)
      setImportDone(null)
    } catch {
      setImportError(`Could not read "${file.name}".`)
    }
  }

  const buildPreview = () => {
    setImportError(null)
    setImportDone(null)
    if (!draft.text.trim()) {
      setPreview({ ...draft, rows: [], error: 'Paste some rows or choose a file first.', duplicateCodes: [] })
      return
    }
    try {
      const rows = parseImportRows(draft.text, draft.format)
      setPreview({ ...draft, rows, error: null, duplicateCodes: [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The file could not be read'
      setPreview({
        ...draft,
        rows: [],
        error: message,
        duplicateCodes: findDuplicateCodes(draft.text, draft.format)
      })
    }
  }

  const applyImport = async () => {
    if (!preview || preview.error || preview.rows.length === 0) return
    setImportError(null)
    try {
      const target = preview.applyTo || activeSetId
      const applied = await defaultStorageAdapter.importRates(target, preview.rows, preview.mode)
      setImportDone(
        `Imported ${applied.count} rate${applied.count === 1 ? '' : 's'} into "${rateSets.find((s) => s.id === target)?.name ?? target
        }" (${preview.mode}).`
      )
      setPreview(null)
      setDraft(emptyDraft)
      if (fileRef.current) fileRef.current.value = ''
      await loadSetData(target)
      const sets = await defaultStorageAdapter.loadRateSets()
      setRateSets(sets)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'The import was rejected')
    }
  }

  // ---------------------------------------------------------------- render data
  const orderedRates = useMemo(() => sortRatesForDisplay(rates, baseCurrency), [rates, baseCurrency])
  const displayed = conversion
    ? sortRatesForDisplay(
      conversion.output.snapshot.ratesUsed.map((r, i) => ({
        id: `used-${i}`,
        rateSetId: activeSet?.id ?? '',
        currencyCode: r.currencyCode,
        rateToBase: r.rateToBase,
        updatedAt: r.updatedAt
      })),
      baseCurrency
    )
    : []

  const staleList = orderedRates.filter((r) => checkRateStaleness(r.updatedAt, new Date(), staleDays).isStale)

  const stateClass = (name: 'stale' | 'override' | 'ok' | 'error') =>
    name === 'stale'
      ? 'calc-cur-state calc-cur-state-stale'
      : name === 'override'
        ? 'calc-cur-state calc-cur-state-override'
        : name === 'ok'
          ? 'calc-cur-state calc-cur-state-ok'
          : 'calc-cur-state calc-cur-state-error'

  return (
    <div className="calc-cur space-y-4">
      {loadError && (
        <div className="calc-cur-result calc-cur-result-error" role="alert">
          <AlertTriangle aria-hidden="true" className="calc-ico" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ---------------- Rate set picker + settings ---------------- */}
      <section className="calc-cur-card" aria-labelledby="calc-cur-set-label">
        <div className="calc-cur-card-head">
          <h4 id="calc-cur-set-label" className="calc-cur-title">Rate set</h4>
          <span className="text-xs text-muted">Base currency: {baseCurrency}</span>
        </div>

        <div className="calc-cur-row">
          <label className="calc-cur-label" htmlFor="calc-cur-set">Active set</label>
          <select
            id="calc-cur-set"
            className="field calc-cur-grow"
            value={activeSetId}
            onChange={(e) => void pickSet(e.target.value)}
          >
            {rateSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.baseCurrency})
              </option>
            ))}
          </select>

          {activeSet && (
            <>
              {renamingId === activeSet.id ? (
                <span className="calc-cur-inline">
                  <label className="sr-only" htmlFor="calc-cur-rename">New name</label>
                  <input
                    id="calc-cur-rename"
                    className="field calc-cur-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    autoFocus
                  />
                  <button type="button" className="btn btn-sm" onClick={() => void saveRename()}>
                    Save name
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="calc-cur-inline">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setRenamingId(activeSet.id)
                      setRenameValue(activeSet.name)
                      setSetError(null)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={isDefaultRateSet(activeSet)}
                    title={isDefaultRateSet(activeSet) ? 'The default rate set cannot be deleted' : undefined}
                    onClick={() => setConfirmDeleteId(activeSet.id)}
                  >
                    <Trash2 aria-hidden="true" className="calc-ico" />
                    Delete set
                  </button>
                </span>
              )}
            </>
          )}
        </div>

        {confirmDeleteId && (
          <div
            className="calc-cur-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm deleting the rate set"
            ref={deleteDialog.overlayRef}
            onKeyDown={deleteDialog.onKeyDown}
            data-testid="calc-cur-confirm-delete"
          >
            <p className="text-xs">
              Delete “{rateSets.find((s) => s.id === confirmDeleteId)?.name}”? Its rates and pair overrides are
              removed too. This cannot be undone.
            </p>
            <div className="calc-cur-inline">
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void confirmDeleteSet()}>
                Yes, delete it
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmDeleteId(null)}>
                Keep it
              </button>
            </div>
          </div>
        )}

        <div className="calc-cur-row">
          <label className="calc-cur-label" htmlFor="calc-cur-new-set">New set</label>
          <input
            id="calc-cur-new-set"
            className="field calc-cur-input"
            placeholder="e.g. Cash exchange"
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createSet()
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => void createSet()}>
            <Plus aria-hidden="true" className="calc-ico" />
            Create
          </button>
        </div>
        {setError && <p className="calc-cur-msg calc-cur-msg-error" role="alert">{setError}</p>}

        <div className="calc-cur-row">
          <div className="calc-cur-field">
            <label className="calc-cur-label" htmlFor="calc-cur-stale">Stale after (days)</label>
            <div className="calc-cur-inline">
              <input
                id="calc-cur-stale"
                className="field calc-cur-num"
                type="number"
                min={0}
                max={3650}
                value={staleDays}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 0) void saveSetting('staleRateDays', Math.floor(n))
                }}
              />
              <span className="text-xs text-muted">days</span>
            </div>
          </div>

          <div className="calc-cur-field">
            <label className="calc-cur-label" htmlFor="calc-cur-decimals">Result decimal places</label>
            <div className="calc-cur-inline">
              <select
                id="calc-cur-decimals"
                className="field calc-cur-num"
                value={displayDecimals}
                onChange={(e) => void saveSetting('currencyDisplayDecimals', Number(e.target.value))}
              >
                {DISPLAY_DECIMALS_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d} dp</option>
                ))}
              </select>
              <span className="text-xs text-muted">never rounded in storage</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Conversion ---------------- */}
      <section className="calc-cur-card" aria-labelledby="calc-cur-conv-label">
        <h4 id="calc-cur-conv-label" className="calc-cur-title">Conversion</h4>
        <div className="calc-cur-grid3">
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-amount">Amount</label>
            <input
              id="calc-cur-amount"
              ref={amountRef}
              className="field font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doConvert()
              }}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-from">From</label>
            <input
              id="calc-cur-from"
              className="field font-mono"
              placeholder="USD"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doConvert()
              }}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-to">To</label>
            <input
              id="calc-cur-to"
              className="field font-mono"
              placeholder="EUR"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doConvert()
              }}
            />
          </div>
        </div>

        <div className="calc-cur-actions">
          <button type="button" className="btn btn-primary" onClick={() => void doConvert()}>
            Convert currency
          </button>
          <span className="text-xs text-muted">
            Saved to your history with the exact rates it used.
          </span>
        </div>

        {convertError && (
          <div className="calc-cur-result calc-cur-result-error" role="alert">
            <AlertTriangle aria-hidden="true" className="calc-ico" />
            <span>{convertError}</span>
          </div>
        )}

        {missing && (
          <div className="calc-cur-result calc-cur-result-missing" role="alert">
            <AlertTriangle aria-hidden="true" className="calc-ico" />
            <span className="calc-cur-grow">
              Missing rate for {missing} in this set. Add it below so the conversion can run.
            </span>
            <button type="button" className="btn btn-sm" onClick={startAddingMissing}>
              Add {missing} below
            </button>
          </div>
        )}

        {conversion && (
          <div className="calc-cur-result">
            <div className="calc-cur-result-value" aria-live="polite">
              <span className="font-mono">
                {conversion.amount} {conversion.from} = {conversion.rounded} {conversion.to}
              </span>
            </div>
            <div className="calc-cur-result-meta">
              <span>
                1 {conversion.from} = {conversion.output.rate} {conversion.to}
              </span>
              <span className="text-muted">·</span>
              <span>{conversion.output.snapshot.rateSetName}</span>
              {savedToHistory && (
                <span className={stateClass('ok')}>
                  <Check aria-hidden="true" className="calc-ico" />
                  Saved to history
                </span>
              )}
            </div>

            {conversion.output.isDirectOverride && (
              <p className={stateClass('override')} data-cur-state="override">
                <AlertTriangle aria-hidden="true" className="calc-ico" />
                Used the pair override {conversion.from}→{conversion.to} (
                {conversion.output.snapshot.rateUsed}), not the base cross rate.
              </p>
            )}

            {conversion.output.isStale && (
              <p className={stateClass('stale')} data-cur-state="stale" role="status">
                <AlertTriangle aria-hidden="true" className="calc-ico" />
                Stale rate: the oldest rate this conversion used is{' '}
                {describeDays(conversion.output.oldestRateAgeDays)} (limit {staleDays} days). Update it below.
              </p>
            )}

            {displayed.length > 0 && (
              <ul className="calc-cur-used">
                {displayed.map((r, i) => {
                  const age = checkRateStaleness(r.updatedAt, new Date(), staleDays)
                  return (
                    <li key={`${r.currencyCode}-${i}`}>
                      <span className="font-mono text-fg">{r.currencyCode}</span>
                      <span className="font-mono">{r.rateToBase}</span>
                      {/* The warning above already names the age, so a row only marks which rate is the old one. */}
                      <span className="text-muted">
                        updated {formatRateDate(r.updatedAt)}
                        {age.isStale ? ' (the stale one)' : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ---------------- Rates ---------------- */}
      <section className="calc-cur-card" aria-labelledby="calc-cur-rates-label">
        <div className="calc-cur-card-head">
          <h4 id="calc-cur-rates-label" className="calc-cur-title">
            Rates <span className="text-muted font-normal">per 1 {baseCurrency}</span>
          </h4>
          {staleList.length > 0 && (
            <span className={stateClass('stale')}>
              <AlertTriangle aria-hidden="true" className="calc-ico" />
              {staleList.length} stale
            </span>
          )}
        </div>

        {orderedRates.length === 0 ? (
          <p className="text-xs text-muted">
            No rates in this set yet. Add one below, or import a CSV/JSON file.
          </p>
        ) : (
          <ul className="calc-cur-rates">
            {orderedRates.map((r) => {
              const age = checkRateStaleness(r.updatedAt, new Date(), staleDays)
              const isBase = r.currencyCode === baseCurrency
              const isEditing = editingId === r.id
              return (
                <li key={r.id} className="calc-cur-rate" data-editing={isEditing}>
                  <div className="calc-cur-rate-main">
                    <span className="calc-cur-code font-mono">{r.currencyCode}</span>

                    {isEditing ? (
                      <div className="calc-cur-edit">
                        <label className="sr-only" htmlFor={`cur-rate-${r.id}`}>Rate for {r.currencyCode}</label>
                        <input
                          id={`cur-rate-${r.id}`}
                          ref={editFirstFieldRef}
                          className="field calc-cur-num font-mono"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <label className="sr-only" htmlFor={`cur-note-${r.id}`}>Note for {r.currencyCode}</label>
                        <input
                          id={`cur-note-${r.id}`}
                          className="field calc-cur-input"
                          placeholder="Note (optional)"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveEdit()}>
                          Save
                        </button>
                        <button type="button" className="btn btn-sm" onClick={cancelEdit}>
                          <X aria-hidden="true" className="calc-ico" />
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="calc-cur-rate-value font-mono"
                          onClick={() => beginEdit(r)}
                          aria-label={`Edit rate for ${r.currencyCode}, currently ${r.rateToBase}, updated ${formatRateDate(r.updatedAt)}`}
                        >
                          {r.rateToBase}
                          <Pencil aria-hidden="true" className="calc-ico" />
                        </button>
                        {r.note && <span className="calc-cur-note">{r.note}</span>}
                        <span className="calc-cur-date">updated {formatRateDate(r.updatedAt)}</span>
                        {isBase && <span className="badge badge-muted">base</span>}
                        {age.isStale && (
                          <span className={stateClass('stale')}>
                            <AlertTriangle aria-hidden="true" className="calc-ico" />
                            {describeDays(age.daysOld)}
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm calc-cur-edit-btn"
                          onClick={() => beginEdit(r)}
                          aria-label={`Edit ${r.currencyCode}`}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                  {isEditing && editError && (
                    <p className="calc-cur-msg calc-cur-msg-error" role="alert">{editError}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="calc-cur-form">
          <div>
            <label className="calc-cur-label" htmlFor="calc-currency-new-code">Currency code</label>
            <input
              id="calc-currency-new-code"
              className="field font-mono"
              placeholder="EUR, JPY, XAU, BTC"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewRate()
              }}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-currency-new-rate">Rate per 1 {baseCurrency}</label>
            <input
              id="calc-currency-new-rate"
              className="field font-mono"
              placeholder="0.92"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewRate()
              }}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-currency-new-note">Note (optional)</label>
            <input
              id="calc-currency-new-note"
              className="field"
              placeholder="e.g. Bank rate"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewRate()
              }}
            />
          </div>
          <button type="button" className="btn btn-sm calc-cur-form-submit" onClick={() => void submitNewRate()}>
            <Plus aria-hidden="true" className="calc-ico" />
            Save rate
          </button>
        </div>
        {rateFormError && <p className="calc-cur-msg calc-cur-msg-error" role="alert">{rateFormError}</p>}
        <p className="text-xs text-muted">
          Rates are stored exactly as typed and never rounded. Saving a code that already exists updates it.
        </p>
      </section>

      {/* ---------------- Pair overrides ---------------- */}
      <section className="calc-cur-card" aria-labelledby="calc-cur-ov-label">
        <h4 id="calc-cur-ov-label" className="calc-cur-title">Pair overrides</h4>
        <p className="text-xs text-muted">
          A direct rate between two currencies. An override wins over the cross rate through {baseCurrency}.
        </p>

        {overrides.length > 0 && (
          <ul className="calc-cur-overrides">
            {overrides.map((o) => (
              <li key={o.id} className="calc-cur-override">
                <span className="font-mono font-semibold text-fg">
                  {o.fromCode} → {o.toCode}
                </span>
                <span className="font-mono">{o.rate}</span>
                <span className="text-muted">updated {formatRateDate(o.updatedAt)}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => void removeOverride(o.id)}
                  aria-label={`Delete override ${o.fromCode} to ${o.toCode}`}
                >
                  <Trash2 aria-hidden="true" className="calc-ico" />
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="calc-cur-grid4">
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-ov-from">From</label>
            <input
              id="calc-cur-ov-from"
              className="field font-mono"
              placeholder="EUR"
              value={ovFrom}
              onChange={(e) => setOvFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-ov-to">To</label>
            <input
              id="calc-cur-ov-to"
              className="field font-mono"
              placeholder="GBP"
              value={ovTo}
              onChange={(e) => setOvTo(e.target.value)}
            />
          </div>
          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-ov-rate">Rate (1 From = ? To)</label>
            <input
              id="calc-cur-ov-rate"
              className="field font-mono"
              placeholder="0.88"
              value={ovRate}
              onChange={(e) => setOvRate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addOverride()
              }}
            />
          </div>
          <div className="calc-cur-grid4-action">
            <button type="button" className="btn btn-sm" onClick={() => void addOverride()}>
              <Plus aria-hidden="true" className="calc-ico" />
              Add override
            </button>
          </div>
        </div>
        {ovError && <p className="calc-cur-msg calc-cur-msg-error" role="alert">{ovError}</p>}
      </section>

      {/* ---------------- Import / export ---------------- */}
      <section className="calc-cur-card" aria-labelledby="calc-cur-io-label">
        <h4 id="calc-cur-io-label" className="calc-cur-title">Import / export</h4>

        <div className="calc-cur-actions">
          <button type="button" className="btn btn-sm" onClick={() => exportSet('csv')} disabled={rates.length === 0}>
            <Download aria-hidden="true" className="calc-ico" />
            Export CSV
          </button>
          <button type="button" className="btn btn-sm" onClick={() => exportSet('json')} disabled={rates.length === 0}>
            <Download aria-hidden="true" className="calc-ico" />
            Export JSON
          </button>
          {exportNote && <span className="text-xs text-muted" role="status">{exportNote}</span>}
        </div>

        <div className="calc-cur-io">
          <div className="calc-cur-row">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              id="calc-cur-file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
              }}
            />
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <FileUp aria-hidden="true" className="calc-ico" />
              Choose file…
            </button>
            {draft.fileName && <span className="text-xs text-muted">{draft.fileName}</span>}
          </div>

          <div>
            <label className="calc-cur-label" htmlFor="calc-cur-paste">…or paste CSV / JSON</label>
            <textarea
              id="calc-cur-paste"
              className="field calc-cur-textarea font-mono"
              rows={4}
              placeholder={'code,rate,name,note\nEUR,0.92,Euro,ECB'}
              value={draft.text}
              onChange={(e) => {
                setDraft((d) => ({ ...d, text: e.target.value, fileName: '' }))
                setPreview(null)
              }}
            />
          </div>

          <div className="calc-cur-grid3">
            <div>
              <label className="calc-cur-label" htmlFor="calc-cur-format">Format</label>
              <select
                id="calc-cur-format"
                className="field"
                value={draft.format}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, format: e.target.value as ImportFormat }))
                  setPreview(null)
                }}
              >
                <option value="auto">Detect</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div>
              <label className="calc-cur-label" htmlFor="calc-cur-mode">On apply</label>
              <select
                id="calc-cur-mode"
                className="field"
                value={draft.mode}
                onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as ImportMode }))}
              >
                <option value="merge">Merge (update matching codes)</option>
                <option value="replace">Replace all rates in the set</option>
              </select>
            </div>
            <div>
              <label className="calc-cur-label" htmlFor="calc-cur-target">Into</label>
              <select
                id="calc-cur-target"
                className="field"
                value={draft.applyTo || activeSetId}
                onChange={(e) => setDraft((d) => ({ ...d, applyTo: e.target.value }))}
              >
                {rateSets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="calc-cur-actions">
            <button type="button" className="btn btn-sm" onClick={buildPreview}>
              <Upload aria-hidden="true" className="calc-ico" />
              Preview
            </button>
          </div>
        </div>

        {preview && (
          <div
            className="calc-cur-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Import preview"
            ref={previewDialog.overlayRef}
            onKeyDown={previewDialog.onKeyDown}
            data-testid="calc-cur-import-preview"
          >
            <div className="calc-cur-card-head">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Preview</span>
              <span className="text-xs text-muted">
                {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} · {preview.mode} · into{' '}
                {rateSets.find((s) => s.id === (preview.applyTo || activeSetId))?.name ?? activeSetId}
              </span>
            </div>

            {preview.error ? (
              <p className="calc-cur-msg calc-cur-msg-error" role="alert">
                Rejected — nothing was changed. {preview.error}
              </p>
            ) : (
              <div className="calc-cur-table-wrap">
                <table className="calc-cur-table">
                  <caption className="sr-only">Rates to import</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Code</th>
                      <th scope="col">Rate</th>
                      <th scope="col">Name</th>
                      <th scope="col">Note</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => {
                      const existing = rates.find((r) => r.currencyCode === row.code)
                      return (
                        <tr key={`${row.code}-${i}`}>
                          <td>{i + 1}</td>
                          <td className="font-mono font-semibold">{row.code}</td>
                          <td className="font-mono">{row.rate}</td>
                          <td>{row.name || '—'}</td>
                          <td>{row.note || '—'}</td>
                          <td>
                            {existing ? (
                              <span className="badge badge-muted">updates {existing.rateToBase}</span>
                            ) : (
                              <span className="badge badge-pos">new</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {preview.duplicateCodes.length > 0 && (
              <p className={stateClass('stale')}>
                <AlertTriangle aria-hidden="true" className="calc-ico" />
                Duplicate codes: {preview.duplicateCodes.join(', ')}
              </p>
            )}

            <div className="calc-cur-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!!preview.error || preview.rows.length === 0}
                onClick={() => void applyImport()}
              >
                Apply {preview.mode === 'replace' ? 'and replace' : 'import'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setPreview(null)
                  setImportError(null)
                }}
              >
                Cancel
              </button>
              {importError && <span className="calc-cur-msg calc-cur-msg-error" role="alert">{importError}</span>}
            </div>
          </div>
        )}

        {importDone && <p className="calc-cur-msg calc-cur-msg-ok" role="status">{importDone}</p>}
      </section>
    </div>
  )
}

export default CurrencyPanel
