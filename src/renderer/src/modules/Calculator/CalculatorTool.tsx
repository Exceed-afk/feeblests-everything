import { lazy, Suspense } from 'react'
import type { ModuleProps } from '../../lib/navigation'

const LazyCalculator = lazy(() => import('./Calculator'))

export function CalculatorTool(props: ModuleProps) {
  return (
    <Suspense
      fallback={
        <div className="page page-lg calculator-module" aria-busy="true">
          <header className="calc-head">
            <div className="calc-head-title">
              <h1 className="page-title">Calculator</h1>
              <p className="page-sub">Loading mathematical engine…</p>
            </div>
          </header>
          <div className="calc-body flex items-center justify-center py-20 text-muted text-sm">
            Loading Calculator…
          </div>
        </div>
      }
    >
      <LazyCalculator {...props} />
    </Suspense>
  )
}

export default CalculatorTool
