import { useState, useRef } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import { runCasTask, CAS_DEFAULT_TIMEOUT_MS, CancelledError } from '../workers'
import type { CasOptions } from '../../../../../shared/calculator/modules/cas'

type CasOp = 'simplify' | 'diff' | 'integrate' | 'limit' | 'subst' | 'solve' | 'taylor'

export function CASPanel(_props: ModuleProps) {
  const [op, setOp] = useState<CasOp>('diff')
  const [inputExpr, setInputExpr] = useState('x^3 + 4*x^2 - 7')
  const [varName, setVarName] = useState('x')
  const [extraVal, setExtraVal] = useState('2') // For limit target or subst value
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  const handleCompute = async () => {
    const expr = inputExpr.trim()
    if (!expr) return

    // Cancel any previous running CAS task
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setError(null)
    setResult(null)
    setIsRunning(true)

    // CasOptions.timeLimitMs is respected here; defaults to CAS_DEFAULT_TIMEOUT_MS (~5s)
    const options: CasOptions = {
      timeLimitMs: CAS_DEFAULT_TIMEOUT_MS
    }

    try {
      const out = await runCasTask(
        {
          op,
          expr,
          varName: varName.trim() || 'x',
          extraVal: extraVal.trim()
        },
        {
          timeoutMs: options.timeLimitMs,
          signal: controller.signal
        }
      )
      setResult(out)
    } catch (err) {
      if (err instanceof CancelledError) {
        setError('Task cancelled.')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsRunning(false)
        abortControllerRef.current = null
      }
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsRunning(false)
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4 space-y-4">
      <div className="seg flex-wrap" role="group">
        {[
          ['diff', 'Derivative (d/dx)'],
          ['simplify', 'Simplify'],
          ['integrate', 'Integrate (∫)'],
          ['limit', 'Limit'],
          ['subst', 'Substitute'],
          ['solve', 'Solve Linear'],
          ['taylor', 'Taylor Series']
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={op === id}
            disabled={isRunning}
            onClick={() => {
              setOp(id as CasOp)
              if (id === 'solve' && !inputExpr.includes('=')) {
                setInputExpr('2*x + 5 = 15')
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <div className="md:col-span-2">
          <label className="text-muted block text-xs mb-1">
            {op === 'solve' ? 'Equation (with =)' : 'Expression'}
          </label>
          <input
            className="field w-full text-xs font-mono"
            value={inputExpr}
            onChange={(e) => setInputExpr(e.target.value)}
            placeholder="e.g. x^2 + 4*x or sin(x)"
          />
        </div>

        <div>
          <label className="text-muted block text-xs mb-1">Variable</label>
          <input
            className="field w-full text-xs font-mono"
            value={varName}
            onChange={(e) => setVarName(e.target.value)}
          />
        </div>

        {(op === 'limit' || op === 'subst' || op === 'taylor') && (
          <div>
            <label className="text-muted block text-xs mb-1">
              {op === 'limit' ? 'Approaching' : op === 'subst' ? 'Substitute Value' : 'Degree'}
            </label>
            <input
              className="field w-full text-xs font-mono"
              value={extraVal}
              onChange={(e) => setExtraVal(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={handleCompute}
          disabled={isRunning}
        >
          {isRunning ? 'Computing...' : 'Compute Symbolically'}
        </button>

        {isRunning && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Running...</span>
            <button
              type="button"
              className="btn text-xs border border-line hover:bg-surface"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-neg">{error}</p>}

      {result && (
        <div className="p-3 rounded border border-line bg-accent-fg/10">
          <span className="text-xs text-muted block mb-1">Result:</span>
          <div className="text-lg font-bold font-mono text-accent-fg tracking-wide">{result}</div>
        </div>
      )}
    </div>
  )
}
export default CASPanel
