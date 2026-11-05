import { useState, useRef, useEffect, useCallback } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import { defaultStorageAdapter } from '../adapters/storage'
import { useModalDialog } from '../useModalDialog'
import type { CalcProgram } from '../../../../../shared/calculator/types'
import {
  bitwiseAnd,
  bitwiseOr,
  bitwiseXor,
  bitwiseNot,
  bitwiseShiftLeft,
  bitwiseShiftRight,
  formatBinaryWord,
  twosView,
  parseProgValue,
  parseProgramFile,
  serializeProgramFile,
  WORD_SIZES,
  type WordSize
} from '../../../../../shared/calculator/modules/scripting'
import { runScriptTask, SCRIPT_DEFAULT_TIMEOUT_MS, CancelledError } from '../workers'

type ProgSubTab = 'bitwise' | 'twos' | 'script'

export function ProgrammingPanel(_props: ModuleProps) {
  const [tab, setTab] = useState<ProgSubTab>('bitwise')

  // --- Bitwise Tool State ---
  const [valA, setValA] = useState('12')
  const [valB, setValB] = useState('10')
  const [wordBits, setWordBits] = useState<WordSize>(32)
  const [bitOp, setBitOp] = useState<'AND' | 'OR' | 'XOR' | 'NOT' | 'SHL' | 'SHR'>('AND')
  const [shiftCount, setShiftCount] = useState('2')
  const [bitResult, setBitResult] = useState<{ dec: string; hex: string; bin: string } | null>(null)
  const [bitError, setBitError] = useState<string | null>(null)

  const handleComputeBitwise = () => {
    setBitError(null)
    try {
      const a = parseProgValue(valA)
      const b = parseProgValue(valB)
      const shift = parseInt(shiftCount, 10) || 0

      let out = 0n
      switch (bitOp) {
        case 'AND':
          out = bitwiseAnd(a, b)
          break
        case 'OR':
          out = bitwiseOr(a, b)
          break
        case 'XOR':
          out = bitwiseXor(a, b)
          break
        case 'NOT':
          out = bitwiseNot(a, wordBits)
          break
        case 'SHL':
          out = bitwiseShiftLeft(a, shift, wordBits)
          break
        case 'SHR':
          out = bitwiseShiftRight(a, shift)
          break
      }

      setBitResult({
        dec: out.toString(10),
        hex: '0x' + out.toString(16).toUpperCase(),
        bin: formatBinaryWord(out, wordBits)
      })
    } catch (e) {
      setBitResult(null)
      setBitError(e instanceof Error ? e.message : 'Invalid input')
    }
  }

  // --- Two's complement view state ---
  const [twosRaw, setTwosRaw] = useState('255')
  const [twosSignedInput, setTwosSignedInput] = useState(true)
  const [twosError, setTwosError] = useState<string | null>(null)
  // The view is derived, but parsing errors are surfaced via state so a bad
  // input shows a message instead of clearing the previous table.
  const twos = (() => {
    try {
      const v = twosView(twosRaw === '' ? '0' : twosRaw, wordBits, twosSignedInput)
      return { view: v, error: null as string | null }
    } catch (e) {
      return { view: null, error: e instanceof Error ? e.message : 'Invalid value' }
    }
  })()
  useEffect(() => {
    setTwosError(twos.error)
  }, [twos.error])

  // --- Scripting State ---
  const [scriptSource, setScriptSource] = useState(
    `# Sandboxed Calculator Script
n = 5
fact = 1
while n > 1 {
  fact = fact * n
  n = n - 1
}
return fact`
  )
  const [scriptResult, setScriptResult] = useState<string | null>(null)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  const handleRunScript = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setScriptError(null)
    setScriptResult(null)
    setIsRunning(true)

    try {
      const res = await runScriptTask(
        {
          source: scriptSource,
          context: { maxSteps: 100_000 }
        },
        {
          timeoutMs: SCRIPT_DEFAULT_TIMEOUT_MS,
          signal: controller.signal
        }
      )
      setScriptResult(`Returned: ${res.returnValue} (Executed in ${res.stepsCount} steps)`)
    } catch (err) {
      if (err instanceof CancelledError) {
        setScriptError('Task cancelled.')
      } else {
        setScriptError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsRunning(false)
        abortControllerRef.current = null
      }
    }
  }

  const handleCancelScript = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsRunning(false)
  }

  // --- Saved programs state ---
  const [programs, setPrograms] = useState<CalcProgram[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null) // null = new unsaved program
  const [currentName, setCurrentName] = useState('')
  // The editor's dirty flag: source differs from the saved copy (or the program
  // is new and not saved yet after the first keystroke).
  const [savedSource, setSavedSource] = useState<string | null>(null)
  // Dirty = the editor text differs from the last saved copy. A brand-new
  // program is dirty as soon as it has any text and no saved copy exists.
  const dirty = savedSource === null ? false : currentId === null ? scriptSource !== savedSource : scriptSource !== savedSource
  const [progMessage, setProgMessage] = useState<string | null>(null)
  const [progError, setProgError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  // When switching away from unsaved code, remember what to load after the user decides.
  const pendingLoadRef = useRef<(() => void) | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const deleteDialog = useModalDialog(!!confirmDelete, () => setConfirmDelete(null))
  const discardDialog = useModalDialog(confirmDiscard, () => {
    setConfirmDiscard(false)
    pendingLoadRef.current = null
  })

  const refreshPrograms = useCallback(async () => {
    try {
      const list = await defaultStorageAdapter.loadPrograms()
      setPrograms(list)
    } catch {
      // Listing failures leave the current list untouched.
    }
  }, [])

  useEffect(() => {
    void refreshPrograms()
  }, [refreshPrograms])

  /** Guard: refuse to replace unsaved code unless the user confirms. */
  const guardUnsaved = (action: () => void) => {
    if (dirty) {
      pendingLoadRef.current = action
      setConfirmDiscard(true)
      return
    }
    action()
  }

  const loadProgram = (p: CalcProgram) => {
    guardUnsaved(() => {
      setCurrentId(p.id)
      setCurrentName(p.name)
      setScriptSource(p.source)
      setSavedSource(p.source)
      setScriptResult(null)
      setScriptError(null)
      setProgMessage(`Loaded "${p.name}"`)
      setProgError(null)
    })
  }

  const newProgram = () => {
    guardUnsaved(() => {
      setCurrentId(null)
      setCurrentName('')
      setScriptSource('')
      setSavedSource('')
      setScriptResult(null)
      setScriptError(null)
      setProgMessage(null)
      setProgError(null)
    })
  }

  const saveProgram = async () => {
    const name = currentName.trim()
    if (!name) {
      setProgError('Give the program a name before saving')
      return
    }
    try {
      const saved = await defaultStorageAdapter.saveProgram({
        id: currentId ?? undefined,
        name,
        source: scriptSource
      })
      setCurrentId(saved.id)
      setSavedSource(scriptSource)
      setProgError(null)
      setProgMessage(`Saved "${saved.name}"`)
      await refreshPrograms()
    } catch (e) {
      setProgError(e instanceof Error ? e.message : 'Could not save the program')
    }
  }

  const renameProgram = async () => {
    const name = currentName.trim()
    if (!name) {
      setProgError('A program name cannot be empty')
      return
    }
    if (!currentId) {
      setProgError('Save the program before renaming it')
      return
    }
    if (scriptSource !== savedSource) {
      setProgError('Save or discard your edits before renaming')
      return
    }
    try {
      await defaultStorageAdapter.saveProgram({ id: currentId, name, source: scriptSource })
      setProgError(null)
      setProgMessage(`Renamed to "${name}"`)
      await refreshPrograms()
    } catch (e) {
      setProgError(e instanceof Error ? e.message : 'Could not rename the program')
    }
  }

  const duplicateProgram = async (p: { name: string; source: string }) => {
    try {
      await defaultStorageAdapter.saveProgram({ name: `${p.name} copy`, source: p.source })
      setProgError(null)
      setProgMessage(`Duplicated "${p.name}"`)
      await refreshPrograms()
    } catch (e) {
      setProgError(e instanceof Error ? e.message : 'Could not duplicate the program')
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    try {
      await defaultStorageAdapter.deleteProgram(confirmDelete.id)
      if (currentId === confirmDelete.id) {
        setCurrentId(null)
        setCurrentName('')
        setScriptSource('')
        setSavedSource('')
      }
      setProgError(null)
      setProgMessage(`Deleted "${confirmDelete.name}"`)
    } catch (e) {
      setProgError(e instanceof Error ? e.message : 'Could not delete the program')
    } finally {
      setConfirmDelete(null)
      await refreshPrograms()
    }
  }

  // --- Import / export ---
  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    setProgError(null)
    setProgMessage(null)
    let text: string
    try {
      // The parse function enforces the size limit; read as text and check it is decodable.
      text = await file.text()
      if (text.includes('\uFFFD')) {
        setProgError(`"${file.name}" is not readable text (binary file?)`)
        return
      }
    } catch {
      setProgError(`Could not read "${file.name}"`)
      return
    }
    importPrograms(text, file.name)
  }

  const importPrograms = (text: string, fileName: string) => {
    try {
      const parsed = parseProgramFile(text, fileName)
      guardUnsaved(() => {
        // Open the first imported program in the editor for review. It is NEVER
        // run automatically �?the user reads it and presses Run.
        const first = parsed.programs[0]
        setCurrentId(null) // not saved yet: the user decides after review
        setCurrentName(first.name)
        setScriptSource(first.source)
        setSavedSource('') // mark "unsaveed relative to nothing saved" but not dirty-flagged dirty
        setScriptResult(null)
        setScriptError(null)
        setProgMessage(
          parsed.programs.length > 1
            ? `Imported ${parsed.programs.length} programs from ${fileName}. The first one is open for review �?nothing was executed.`
            : `Imported "${first.name}" from ${fileName}. It is open for review �?nothing was executed.`
        )
        // Save the rest (if any) as new programs so nothing is lost.
        if (parsed.programs.length > 1) {
          void (async () => {
            for (const p of parsed.programs.slice(1)) {
              try {
                await defaultStorageAdapter.saveProgram({ name: p.name, source: p.source })
              } catch { /* one failure must not abort the rest */ }
            }
            await refreshPrograms()
          })()
        }
      })
    } catch (e) {
      setProgError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  const exportProgram = () => {
    const name = currentName.trim() || 'program'
    const text = serializeProgramFile([{ name, source: scriptSource }])
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/[^\w-]+/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
    setProgMessage(`Exported "${name}.json"`)
  }

  const unsavedBadge = dirty ? (
    <span className="text-xs text-warn" data-testid="prog-unsaved">�?unsaved changes</span>
  ) : null

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-line pb-2 text-sm">
        {(['bitwise', 'twos', 'script'] as ProgSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`px-3 py-1.5 rounded-md font-medium ${tab === t ? 'bg-accent text-on-accent' : 'text-muted'
              }`}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
          >
            {t === 'bitwise' && 'Bitwise Operations'}
            {t === 'twos' && "Two's Complement"}
            {t === 'script' && 'Saved Programs'}
          </button>
        ))}
      </div>

      {/* 1. Bitwise Operations */}
      {tab === 'bitwise' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">Word Size:</span>
            {WORD_SIZES.map((b) => (
              <button
                key={b}
                type="button"
                className={`btn btn-sm px-2 py-0.5 ${wordBits === b ? 'bg-accent text-on-accent' : ''}`}
                onClick={() => setWordBits(b)}
                aria-pressed={wordBits === b}
              >
                {b}-bit
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Operand A (Dec, 0xHex, 0bBin)</label>
              <input
                className="field w-full text-xs font-mono"
                value={valA}
                onChange={(e) => setValA(e.target.value)}
              />
            </div>

            <div>
              <label className="text-muted block text-xs mb-1">Operation</label>
              <select
                className="field w-full text-xs"
                value={bitOp}
                onChange={(e) => setBitOp(e.target.value as typeof bitOp)}
              >
                <option value="AND">AND (&)</option>
                <option value="OR">OR (|)</option>
                <option value="XOR">XOR (^)</option>
                <option value="NOT">NOT (~)</option>
                <option value="SHL">Shift Left (\u226A)</option>
                <option value="SHR">Shift Right (\u226B)</option>
              </select>
            </div>

            <div>
              <label className="text-muted block text-xs mb-1">
                {bitOp === 'SHL' || bitOp === 'SHR' ? 'Shift Amount' : 'Operand B'}
              </label>
              <input
                className="field w-full text-xs font-mono"
                value={bitOp === 'SHL' || bitOp === 'SHR' ? shiftCount : valB}
                onChange={(e) =>
                  bitOp === 'SHL' || bitOp === 'SHR'
                    ? setShiftCount(e.target.value)
                    : setValB(e.target.value)
                }
              />
            </div>
          </div>

          <button type="button" className="btn btn-sm" onClick={handleComputeBitwise}>
            Compute Bitwise
          </button>

          {bitError && <p className="text-xs text-neg" role="alert">{bitError}</p>}

          {bitResult && (
            <div className="p-3 rounded border border-line bg-bg space-y-1 font-mono text-xs">
              <div>
                <span className="text-muted">DEC: </span>
                <span className="font-bold">{bitResult.dec}</span>
              </div>
              <div>
                <span className="text-muted">HEX: </span>
                <span className="font-bold">{bitResult.hex}</span>
              </div>
              <div>
                <span className="text-muted">BIN: </span>
                <span className="font-bold tracking-wider">{bitResult.bin}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Two's complement view */}
      {tab === 'twos' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3" data-testid="twos-panel">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted">Word Size:</span>
            {WORD_SIZES.map((b) => (
              <button
                key={b}
                type="button"
                className={`btn btn-sm px-2 py-0.5 ${wordBits === b ? 'bg-accent text-on-accent' : ''}`}
                onClick={() => setWordBits(b)}
                aria-pressed={wordBits === b}
                data-testid={`twos-bits-${b}`}
              >
                {b}-bit
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="text-muted" htmlFor="twos-value">Value (Dec, 0xHex, 0bBin)</label>
            <input
              id="twos-value"
              className="field w-48 text-xs font-mono"
              value={twosRaw}
              onChange={(e) => setTwosRaw(e.target.value)}
              data-testid="twos-input"
            />
            <span className="seg" role="group" aria-label="Input interpretation">
              <button type="button" aria-pressed={twosSignedInput} onClick={() => setTwosSignedInput(true)} data-testid="twos-signed">Signed input</button>
              <button type="button" aria-pressed={!twosSignedInput} onClick={() => setTwosSignedInput(false)} data-testid="twos-unsigned">Unsigned input</button>
            </span>
          </div>

          {twosError ? (
            <p className="text-xs text-neg" role="alert">{twosError}</p>
          ) : twos.view && (
            <>
              {twos.view.overflowed && (
                <p className="text-xs text-warn" data-testid="twos-overflow">
                  Overflow: {twos.view.input} does not fit {wordBits}-bit {twosSignedInput ? 'signed' : 'unsigned'}; the bits below are the value wrapped mod 2^{wordBits}.
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" data-testid="twos-grid">
                {([
                  ['Unsigned', twos.view.unsigned],
                  ['Signed (two\u2019s complement)', twos.view.signed],
                  ['Hex', `0x${twos.view.hex}`],
                  ['Binary', twos.view.binary]
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-line bg-bg p-3" data-testid={`twos-cell-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                    <div className="text-xs text-muted">{label}</div>
                    <div className="font-mono font-semibold break-all">{value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                Overflow wraps modulo 2^{wordBits} (the same bits, re-read). Hex and binary always show the wrapped unsigned word.
              </p>
            </>
          )}
        </div>
      )}

      {/* 3. Saved programs */}
      {tab === 'script' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-card p-4 space-y-3" data-testid="prog-panel">
            <div className="flex items-center gap-2">
              <input
                className="field text-xs font-mono"
                placeholder="Program name"
                value={currentName}
                onChange={(e) => setCurrentName(e.target.value)}
                aria-label="Program name"
                data-testid="prog-name"
              />
              {unsavedBadge}
            </div>

            <label className="text-muted block text-xs">Script Editor (Assignments, if/else, while, fn)</label>
            <textarea
              className="field w-full font-mono text-xs h-40"
              value={scriptSource}
              onChange={(e) => setScriptSource(e.target.value)}
              aria-label="Script source"
              data-testid="prog-editor"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { void saveProgram() }}
                data-testid="prog-save"
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { void renameProgram() }}
                disabled={!currentId}
                data-testid="prog-rename"
              >
                Rename
              </button>
              <button type="button" className="btn btn-sm" onClick={newProgram} data-testid="prog-new">
                New
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { void duplicateProgram({ name: currentName.trim() || 'Untitled', source: scriptSource }) }}
                disabled={!currentId}
                data-testid="prog-duplicate"
              >
                Duplicate
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => currentId && setConfirmDelete({ id: currentId, name: currentName.trim() || 'Untitled' })}
                disabled={!currentId}
                data-testid="prog-delete"
              >
                Delete
              </button>
              <button type="button" className="btn btn-sm" onClick={exportProgram} data-testid="prog-export">
                Export�?              </button>
              <label className="btn btn-sm cursor-pointer" data-testid="prog-import-label">
                Import�?                <input
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  className="hidden"
                  data-testid="prog-import-file"
                  onChange={(e) => { void onImportFile(e.target.files?.[0]) }}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={handleRunScript}
                disabled={isRunning}
                data-testid="prog-run"
              >
                {isRunning ? 'Running...' : 'Run Script'}
              </button>

              {isRunning && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Running...</span>
                  <button type="button" className="btn btn-sm" onClick={handleCancelScript}>
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {progError && <p className="text-xs text-neg" role="alert" data-testid="prog-error">{progError}</p>}
            {progMessage && <p className="text-xs text-muted" data-testid="prog-message">{progMessage}</p>}

            {scriptError && <p className="text-xs text-neg" role="alert">{scriptError}</p>}
            {scriptResult && (
              <div className="p-3 rounded border border-line bg-bg font-mono text-sm font-semibold" data-testid="prog-output">
                {scriptResult}
              </div>
            )}

            {/* Delete confirmation */}
            {confirmDelete && (
              <div
                className="rounded-lg border border-line bg-bg p-3 text-sm"
                role="dialog"
                aria-modal="true"
                aria-label="Confirm delete"
                data-testid="prog-confirm-delete"
                ref={deleteDialog.overlayRef}
                onKeyDown={deleteDialog.onKeyDown}
              >
                <p>Delete "{confirmDelete.name}"? This cannot be undone.</p>
                <div className="flex gap-2 mt-2">
                  <button type="button" className="btn-danger btn-sm" onClick={() => { void doDelete() }} data-testid="prog-confirm-yes">
                    Delete
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(null)} data-testid="prog-confirm-no">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Unsaved-changes confirmation when replacing editor content */}
            {confirmDiscard && (
              <div
                className="rounded-lg border border-line bg-bg p-3 text-sm"
                role="dialog"
                aria-modal="true"
                aria-label="Unsaved changes"
                data-testid="prog-confirm-discard"
                ref={discardDialog.overlayRef}
                onKeyDown={discardDialog.onKeyDown}
              >
                <p>You have unsaved changes. Replace them?</p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => {
                      setConfirmDiscard(false)
                      const action = pendingLoadRef.current
                      pendingLoadRef.current = null
                      if (action) action()
                    }}
                    data-testid="prog-discard-yes"
                  >
                    Discard changes
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setConfirmDiscard(false)
                      pendingLoadRef.current = null
                    }}
                    data-testid="prog-discard-no"
                  >
                    Keep editing
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Saved program list */}
          <div className="rounded-lg border border-line bg-card p-4" data-testid="prog-list">
            <div className="text-sm font-semibold mb-2">Saved programs ({programs.length})</div>
            {programs.length === 0 ? (
              <p className="text-xs text-muted">No saved programs yet.</p>
            ) : (
              <ul className="space-y-1">
                {programs.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="text-left flex-1 truncate hover:underline"
                      onClick={() => loadProgram(p)}
                      title={p.source.slice(0, 80)}
                      data-testid={`prog-row-${p.name.replace(/[^\w]+/g, '-')}`}
                    >
                      {p.name}
                      <span className="text-xs text-muted ml-2">{new Date(p.updatedAt).toLocaleDateString()}</span>
                    </button>
                    <button type="button" className="btn-icon" aria-label={`Duplicate ${p.name}`} onClick={() => { void duplicateProgram(p) }}>
                      �?                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
                      data-testid={`prog-list-delete-${p.name.replace(/[^\w]+/g, '-')}`}
                    >
                      �?                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
export default ProgrammingPanel