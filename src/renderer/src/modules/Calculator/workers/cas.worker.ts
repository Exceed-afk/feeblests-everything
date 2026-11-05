import {
  casSimplify,
  casDifferentiate,
  casIntegratePolynomial,
  casLimitPolynomial,
  casSubstitute,
  casSolveLinear,
  casTaylorSeries
} from '../../../../../shared/calculator/modules/cas'
import type { WorkerRequest, WorkerResponse } from './harness'

export interface CasPayload {
  op: 'simplify' | 'diff' | 'integrate' | 'limit' | 'subst' | 'solve' | 'taylor'
  expr: string
  varName?: string
  extraVal?: string
}

self.onmessage = (event: MessageEvent<WorkerRequest<CasPayload>>) => {
  const req = event.data
  if (!req || typeof req !== 'object' || !req.id) return

  try {
    const { op, expr, varName = 'x', extraVal = '' } = req.payload
    let result = ''

    switch (op) {
      case 'simplify':
        result = casSimplify(expr)
        break
      case 'diff':
        result = casDifferentiate(expr, varName.trim() || 'x')
        break
      case 'integrate':
        result = casIntegratePolynomial(expr, varName.trim() || 'x')
        break
      case 'limit':
        result = casLimitPolynomial(expr, varName.trim() || 'x', parseFloat(extraVal) || 0)
        break
      case 'subst':
        result = casSubstitute(expr, varName.trim() || 'x', extraVal.trim())
        break
      case 'solve':
        result = `${varName} = ${casSolveLinear(expr, varName.trim() || 'x')}`
        break
      case 'taylor':
        result = casTaylorSeries(expr, varName.trim() || 'x', 0, parseInt(extraVal, 10) || 3)
        break
      default:
        throw new Error(`Unknown CAS operation: ${op}`)
    }

    const res: WorkerResponse<string> = { id: req.id, ok: true, result }
    self.postMessage(res)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const res: WorkerResponse<string> = { id: req.id, ok: false, error: errorMsg }
    self.postMessage(res)
  }
}
