import {
  sampleFunction,
  findRoots,
  findExtrema,
  sampleParametric,
  samplePolar,
  buildValueTable,
  derivativeAt,
  type PlotRange,
  type SamplePoint,
  type ExtremaPoint,
  type ParametricPoint,
  type PolarPoint,
  type TableRow,
  type DerivativeResult,
  type AngleMode
} from '../../../../../shared/calculator/modules/graphing'
import type { WorkerRequest, WorkerResponse } from './harness'

export interface GraphSamplePayload {
  expr: string
  range: PlotRange
  resolution?: number
  angleMode?: AngleMode
}

export interface GraphBatchSamplePayload {
  functions: Array<{ id: string; expr: string }>
  range: PlotRange
  resolution?: number
  angleMode?: AngleMode
}

export interface GraphBatchSampleResult {
  results: Record<string, SamplePoint[]>
}

export interface GraphAnalysisPayload {
  expr: string
  range: PlotRange
  angleMode?: AngleMode
}

export interface GraphAnalysisResult {
  roots: number[]
  extrema: ExtremaPoint[]
}

export interface GraphParametricPayload {
  xExpr: string
  yExpr: string
  tMin: number
  tMax: number
  samples?: number
  angleMode?: AngleMode
}

export interface GraphPolarPayload {
  rExpr: string
  thetaMin: number
  thetaMax: number
  samples?: number
  angleMode?: AngleMode
}

export interface GraphTablePayload {
  expr: string
  start: number
  step: number
  count: number
  angleMode?: AngleMode
}

export interface GraphDerivativePayload {
  expr: string
  point: number
  angleMode?: AngleMode
}

export type GraphParametricResult = ParametricPoint[]
export type GraphPolarResult = PolarPoint[]
export type GraphTableResult = TableRow[]

self.onmessage = (event: MessageEvent<WorkerRequest<unknown>>) => {
  const req = event.data
  if (!req || typeof req !== 'object' || !req.id) return

  try {
    let result: unknown

    switch (req.task) {
      case 'sample': {
        const payload = req.payload as GraphSamplePayload
        result = sampleFunction(payload.expr, payload.range, payload.resolution ?? 300, { angleMode: payload.angleMode })
        break
      }
      case 'sampleBatch': {
        const payload = req.payload as GraphBatchSamplePayload
        const map: Record<string, SamplePoint[]> = {}
        for (const fn of payload.functions) {
          if (!fn.expr.trim()) continue
          try {
            map[fn.id] = sampleFunction(fn.expr, payload.range, payload.resolution ?? 300, { angleMode: payload.angleMode })
          } catch {
            // Expression error, leave out or empty
          }
        }
        result = { results: map } as GraphBatchSampleResult
        break
      }
      case 'analyze': {
        const payload = req.payload as GraphAnalysisPayload
        const roots = findRoots(payload.expr, payload.range.xMin, payload.range.xMax)
        const extrema = findExtrema(payload.expr, payload.range.xMin, payload.range.xMax)
        result = { roots, extrema } as GraphAnalysisResult
        break
      }
      case 'sampleParametric': {
        const payload = req.payload as GraphParametricPayload
        result = sampleParametric(
          payload.xExpr,
          payload.yExpr,
          payload.tMin,
          payload.tMax,
          payload.samples ?? 300,
          { angleMode: payload.angleMode }
        )
        break
      }
      case 'samplePolar': {
        const payload = req.payload as GraphPolarPayload
        result = samplePolar(
          payload.rExpr,
          payload.thetaMin,
          payload.thetaMax,
          payload.samples ?? 300,
          { angleMode: payload.angleMode }
        )
        break
      }
      case 'valueTable': {
        const payload = req.payload as GraphTablePayload
        result = buildValueTable(payload.expr, payload.start, payload.step, payload.count, {
          angleMode: payload.angleMode
        })
        break
      }
      case 'derivative': {
        const payload = req.payload as GraphDerivativePayload
        result = derivativeAt(payload.expr, payload.point, { angleMode: payload.angleMode })
        break
      }
      default:
        throw new Error(`Unknown graph task: ${req.task}`)
    }

    const res: WorkerResponse<unknown> = { id: req.id, ok: true, result }
    self.postMessage(res)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const res: WorkerResponse<unknown> = { id: req.id, ok: false, error: errorMsg }
    self.postMessage(res)
  }
}
