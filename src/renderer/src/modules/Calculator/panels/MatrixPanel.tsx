import { useState } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import {
  matrixDeterminant,
  matrixInverse,
  matrixRank,
  matrixRREF,
  matrixMultiply,
  solveLinearSystem,
  eigenvalues2x2,
  vectorDot,
  vectorCross,
  type Matrix,
  type Vector
} from '../../../../../shared/calculator/modules/linear-algebra'
import {
  Complex,
  complexAdd,
  complexMultiply,
  complexDivide,
  complexAbs,
  complexRoots
} from '../../../../../shared/calculator/modules/complex'
import { Decimal } from '../../../../../shared/calculator/numeric'

type LinalgSubTab = 'matrix' | 'system' | 'complex'

export function MatrixPanel(_props: ModuleProps) {
  const [tab, setTab] = useState<LinalgSubTab>('matrix')

  // --- Matrix State (Grid entry) ---
  const [matDim, setMatDim] = useState<'2' | '3'>('2')
  const [mRaw, setMRaw] = useState<string[][]>([
    ['1', '2'],
    ['3', '4']
  ])
  const [matResult, setMatResult] = useState<string | null>(null)
  const [matError, setMatError] = useState<string | null>(null)

  const handleDimChange = (dim: '2' | '3') => {
    setMatDim(dim)
    const n = parseInt(dim, 10)
    setMRaw(Array.from({ length: n }, () => Array.from({ length: n }, () => '0')))
    setMatResult(null)
  }

  const updateCell = (r: number, c: number, val: string) => {
    setMRaw((prev) => {
      const copy = prev.map((row) => [...row])
      copy[r][c] = val
      return copy
    })
  }

  const parseMatrix = (): Matrix => {
    return mRaw.map((row) => row.map((cell) => new Decimal(cell.trim() || '0')))
  }

  const handleDeterminant = () => {
    setMatError(null)
    try {
      const M = parseMatrix()
      const d = matrixDeterminant(M)
      setMatResult(`Determinant = ${d.toDecimalPlaces(6).toString()}`)
    } catch (err) {
      setMatError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInverse = () => {
    setMatError(null)
    try {
      const M = parseMatrix()
      const inv = matrixInverse(M)
      const rows = inv.map((r) => r.map((c) => c.toDecimalPlaces(4).toString()).join(', '))
      setMatResult(`Inverse Matrix:\n[ ${rows.join(' ]\n[ ')} ]`)
    } catch (err) {
      setMatError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRank = () => {
    setMatError(null)
    try {
      const M = parseMatrix()
      const r = matrixRank(M)
      setMatResult(`Rank = ${r}`)
    } catch (err) {
      setMatError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRREF = () => {
    setMatError(null)
    try {
      const M = parseMatrix()
      const rref = matrixRREF(M)
      const rows = rref.map((r) => r.map((c) => c.toDecimalPlaces(4).toString()).join(', '))
      setMatResult(`RREF:\n[ ${rows.join(' ]\n[ ')} ]`)
    } catch (err) {
      setMatError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleEigenvalues = () => {
    setMatError(null)
    try {
      const M = parseMatrix()
      if (M.length !== 2) throw new Error('Eigenvalues solver currently available for 2x2 matrices')
      const evs = eigenvalues2x2(M)
      setMatResult(`Eigenvalues (λ): ${evs.map((e) => e.toDecimalPlaces(4).toString()).join(', ')}`)
    } catch (err) {
      setMatError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Linear System Solve (2x2) ---
  const [eq1, setEq1] = useState({ a: '2', b: '1', c: '8' }) // 2x + 1y = 8
  const [eq2, setEq2] = useState({ a: '1', b: '3', c: '14' }) // 1x + 3y = 14
  const [sysResult, setSysResult] = useState<string | null>(null)

  const handleSolveSystem = () => {
    try {
      const A: Matrix = [
        [new Decimal(eq1.a), new Decimal(eq1.b)],
        [new Decimal(eq2.a), new Decimal(eq2.b)]
      ]
      const b: Vector = [new Decimal(eq1.c), new Decimal(eq2.c)]
      const x = solveLinearSystem(A, b)
      setSysResult(`Solution: x = ${x[0].toDecimalPlaces(4).toString()}, y = ${x[1].toDecimalPlaces(4).toString()}`)
    } catch (err) {
      setSysResult(err instanceof Error ? err.message : 'System solve error')
    }
  }

  // --- Complex Numbers ---
  const [z1Re, setZ1Re] = useState('3')
  const [z1Im, setZ1Im] = useState('4')
  const [z2Re, setZ2Re] = useState('1')
  const [z2Im, setZ2Im] = useState('-2')
  const [compResult, setCompResult] = useState<string | null>(null)

  const handleComplexOp = (op: 'add' | 'mul' | 'div' | 'abs' | 'roots') => {
    try {
      const z1 = new Complex(new Decimal(z1Re), new Decimal(z1Im))
      const z2 = new Complex(new Decimal(z2Re), new Decimal(z2Im))

      if (op === 'add') setCompResult(`z1 + z2 = ${complexAdd(z1, z2).toString()}`)
      else if (op === 'mul') setCompResult(`z1 * z2 = ${complexMultiply(z1, z2).toString()}`)
      else if (op === 'div') setCompResult(`z1 / z2 = ${complexDivide(z1, z2).toString()}`)
      else if (op === 'abs') setCompResult(`|z1| = ${complexAbs(z1).toDecimalPlaces(4).toString()}`)
      else if (op === 'roots') {
        const rts = complexRoots(z1, 3)
        setCompResult(`Cube roots of z1:\n${rts.map((r, i) => `w${i}: ${r.toString(4)}`).join('\n')}`)
      }
    } catch (err) {
      setCompResult(err instanceof Error ? err.message : 'Complex arithmetic error')
    }
  }

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="seg flex-wrap" role="group" aria-label="Linear algebra view">
        {(['matrix', 'system', 'complex'] as LinalgSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'matrix' && 'Matrix Operations'}
            {t === 'system' && 'Solve Linear System'}
            {t === 'complex' && 'Complex Numbers'}
          </button>
        ))}
      </div>

      {/* 1. Matrix Operations */}
      {tab === 'matrix' && (
        <div className="rounded-lg border border-line bg-card p-4 shadow-card space-y-3">
          <div className="seg" role="group" aria-label="Matrix size">
            <span className="text-xs text-muted self-center pl-1">Matrix Size:</span>
            <button
              type="button"
              aria-pressed={matDim === '2'}
              onClick={() => handleDimChange('2')}
            >
              2x2
            </button>
            <button
              type="button"
              aria-pressed={matDim === '3'}
              onClick={() => handleDimChange('3')}
            >
              3x3
            </button>
          </div>

          <div className="inline-grid gap-2 border border-line p-3 rounded bg-accent-fg/10">
            {mRaw.map((row, r) => (
              <div key={r} className="flex gap-2">
                {row.map((cell, c) => (
                  <input
                    key={`${r}-${c}`}
                    className="field w-16 text-center text-xs font-mono"
                    value={cell}
                    onChange={(e) => updateCell(r, c, e.target.value)}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className="btn btn text-xs" onClick={handleDeterminant}>
              Determinant
            </button>
            <button type="button" className="btn btn text-xs" onClick={handleInverse}>
              Inverse
            </button>
            <button type="button" className="btn btn text-xs" onClick={handleRank}>
              Rank
            </button>
            <button type="button" className="btn btn text-xs" onClick={handleRREF}>
              RREF
            </button>
            {matDim === '2' && (
              <button type="button" className="btn btn text-xs" onClick={handleEigenvalues}>
                Eigenvalues
              </button>
            )}
          </div>

          {matError && <p className="text-xs text-neg">{matError}</p>}
          {matResult && (
            <div className="p-3 rounded border border-line bg-accent-fg/10 font-mono text-xs whitespace-pre-wrap text-accent-fg font-semibold">
              {matResult}
            </div>
          )}
        </div>
      )}

      {/* 2. Linear System Solver */}
      {tab === 'system' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">2x2 System (a*x + b*y = c)</h4>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <input className="field w-12 text-center" value={eq1.a} onChange={(e) => setEq1({ ...eq1, a: e.target.value })} />
              <span>x + </span>
              <input className="field w-12 text-center" value={eq1.b} onChange={(e) => setEq1({ ...eq1, b: e.target.value })} />
              <span>y = </span>
              <input className="field w-12 text-center" value={eq1.c} onChange={(e) => setEq1({ ...eq1, c: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <input className="field w-12 text-center" value={eq2.a} onChange={(e) => setEq2({ ...eq2, a: e.target.value })} />
              <span>x + </span>
              <input className="field w-12 text-center" value={eq2.b} onChange={(e) => setEq2({ ...eq2, b: e.target.value })} />
              <span>y = </span>
              <input className="field w-12 text-center" value={eq2.c} onChange={(e) => setEq2({ ...eq2, c: e.target.value })} />
            </div>
          </div>

          <button type="button" className="btn-primary text-xs" onClick={handleSolveSystem}>
            Solve System
          </button>

          {sysResult && (
            <div className="p-3 rounded border border-line bg-accent-fg/10 font-mono text-sm font-semibold text-accent-fg">
              {sysResult}
            </div>
          )}
        </div>
      )}

      {/* 3. Complex Numbers */}
      {tab === 'complex' && (
        <div className="rounded-lg border border-line bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="p-3 rounded border border-line bg-accent-fg/10 space-y-2">
              <span className="font-semibold block text-accent-fg">z1 = a + bi</span>
              <div className="flex items-center gap-2">
                <span>Real:</span>
                <input className="field w-16" value={z1Re} onChange={(e) => setZ1Re(e.target.value)} />
                <span>Imag:</span>
                <input className="field w-16" value={z1Im} onChange={(e) => setZ1Im(e.target.value)} />
              </div>
            </div>

            <div className="p-3 rounded border border-line bg-accent-fg/10 space-y-2">
              <span className="font-semibold block text-accent-fg">z2 = c + di</span>
              <div className="flex items-center gap-2">
                <span>Real:</span>
                <input className="field w-16" value={z2Re} onChange={(e) => setZ2Re(e.target.value)} />
                <span>Imag:</span>
                <input className="field w-16" value={z2Im} onChange={(e) => setZ2Im(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className="btn btn text-xs" onClick={() => handleComplexOp('add')}>
              z1 + z2
            </button>
            <button type="button" className="btn btn text-xs" onClick={() => handleComplexOp('mul')}>
              z1 * z2
            </button>
            <button type="button" className="btn btn text-xs" onClick={() => handleComplexOp('div')}>
              z1 / z2
            </button>
            <button type="button" className="btn btn text-xs" onClick={() => handleComplexOp('abs')}>
              |z1|
            </button>
            <button type="button" className="btn btn text-xs" onClick={() => handleComplexOp('roots')}>
              Cube Roots of z1
            </button>
          </div>

          {compResult && (
            <div className="p-3 rounded border border-line bg-accent-fg/10 font-mono text-xs whitespace-pre-wrap text-accent-fg font-semibold">
              {compResult}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default MatrixPanel
