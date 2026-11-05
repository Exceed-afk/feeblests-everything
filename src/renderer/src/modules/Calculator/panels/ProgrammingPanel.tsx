import { useState, useRef } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  bitwiseAnd,
  bitwiseOr,
  bitwiseXor,
  bitwiseNot,
  bitwiseShiftLeft,
  bitwiseShiftRight,
  formatBinaryWord
} from '../../../../../shared/calculator/modules/scripting'
import { runScriptTask, SCRIPT_DEFAULT_TIMEOUT_MS, CancelledError } from '../workers'

type ProgSubTab = 'bitwise' | 'script'

export function ProgrammingPanel(_props: ModuleProps) {
  const [tab, setTab] = useState<ProgSubTab>('bitwise')

  // --- Bitwise Tool State ---
  const [valA, setValA] = useState('12')
  const [valB, setValB] = useState('10')
  const [wordBits, setWordBits] = useState<8 | 16 | 32 | 64>(32)
  const [bitOp, setBitOp] = useState<'AND' | 'OR' | 'XOR' | 'NOT' | 'SHL' | 'SHR'>('AND')
  const [shiftCount, setShiftCount] = useState('2')
  const [bitResult, setBitResult] = useState<{ dec: string; hex: string; bin: string } | null>(null)

  const handleComputeBitwise = () => {
    try {
      const a = BigInt(valA.trim() || '0')
      const b = BigInt(valB.trim() || '0')
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
    } catch {
      setBitResult(null)
    }
  }

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

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-theme pb-2 text-sm">
        {(['bitwise', 'script'] as ProgSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`px-3 py-1.5 rounded-md font-medium ${tab === t ? 'bg-theme text-white' : 'btn-subtle text-muted'
              }`}
            onClick={() => setTab(t)}
          >
            {t === 'bitwise' && 'Bitwise Operations'}
            {t === 'script' && 'Sandboxed Scripts'}
          </button>
        ))}
      </div>

      {/* 1. Bitwise Operations */}
      {tab === 'bitwise' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">Word Size:</span>
            {[8, 16, 32, 64].map((b) => (
              <button
                key={b}
                type="button"
                className={`btn px-2 py-0.5 ${wordBits === b ? 'bg-theme text-white' : 'btn-subtle'}`}
                onClick={() => setWordBits(b as any)}
              >
                {b}-bit
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-muted block text-xs mb-1">Operand A (Dec or 0xHex)</label>
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
                onChange={(e) => setBitOp(e.target.value as any)}
              >
                <option value="AND">AND (&)</option>
                <option value="OR">OR (|)</option>
                <option value="XOR">XOR (^)</option>
                <option value="NOT">NOT (~)</option>
                <option value="SHL">Shift Left (&lt;&lt;)</option>
                <option value="SHR">Shift Right (&gt;&gt;)</option>
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

          <button type="button" className="btn bg-theme text-white text-xs" onClick={handleComputeBitwise}>
            Compute Bitwise
          </button>

          {bitResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 space-y-1 font-mono text-xs">
              <div>
                <span className="text-muted">DEC: </span>
                <span className="font-bold text-theme">{bitResult.dec}</span>
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

      {/* 2. Sandboxed Scripts */}
      {tab === 'script' && (
        <div className="rounded-lg border border-theme bg-surface p-4 space-y-3">
          <label className="text-muted block text-xs">Script Editor (Assignments, if/else, while, fn)</label>
          <textarea
            className="field w-full font-mono text-xs h-40"
            value={scriptSource}
            onChange={(e) => setScriptSource(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-theme text-white text-xs"
              onClick={handleRunScript}
              disabled={isRunning}
            >
              {isRunning ? 'Running...' : 'Run Script'}
            </button>

            {isRunning && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Running...</span>
                <button
                  type="button"
                  className="btn text-xs border border-line hover:bg-surface"
                  onClick={handleCancelScript}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {scriptError && <p className="text-xs text-red-500">{scriptError}</p>}
          {scriptResult && (
            <div className="p-3 rounded border border-theme bg-theme/5 font-mono text-sm font-semibold text-theme">
              {scriptResult}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default ProgrammingPanel
