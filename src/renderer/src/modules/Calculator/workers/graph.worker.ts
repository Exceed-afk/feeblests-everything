import {
  sampleFunction,
  findRoots,
  findExtrema,
  type PlotRange,
  type SamplePoint,
  type ExtremaPoint
} from '../../../../../shared/calculator/modules/graphing'
import type { WorkerRequest, WorkerResponse } from './harness'

export interface GraphSamplePayload {
  expr: string
  range: PlotRange
  resolution?: number
}

export interface GraphBatchSamplePayload {
  functions: Array<{ id: string; expr: string }>
  range: PlotRange
  resolution?: number
}

export interface GraphBatchSampleResult {
  results: Record<string, SamplePoint[]>
}

export interface GraphAnalysisPayload {
  expr: string
  range: PlotRange
}

export interface GraphAnalysisResult {
  roots: number[]
  extrema: ExtremaPoint[]
}

self.onmessage = (event: MessageEvent<WorkerRequest<unknown>>) => {
  const req = event.data
  if (!req || typeof req !== 'object' || !req.id) return

  try {
    let result: unknown

    switch (req.task) {
      case 'sample': {
        const payload = req.payload as GraphSamplePayload
        result = sampleFunction(payload.expr, payload.range, payload.resolution ?? 300)
        break
      }
      case 'sampleBatch': {
        const payload = req.payload as GraphBatchSamplePayload
        const map: Record<string, SamplePoint[]> = {}
        for (const fn of payload.functions) {
          if (!fn.expr.trim()) continue
          try {
            map[fn.id] = sampleFunction(fn.expr, payload.range, payload.resolution ?? 300)
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
