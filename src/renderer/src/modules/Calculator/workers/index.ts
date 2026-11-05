import { WorkerHarness } from './harness'
import type { CasPayload } from './cas.worker'
import type {
  GraphBatchSamplePayload,
  GraphBatchSampleResult,
  GraphAnalysisPayload,
  GraphAnalysisResult,
  GraphParametricPayload,
  GraphPolarPayload,
  GraphTablePayload,
  GraphDerivativePayload,
  GraphParametricResult,
  GraphPolarResult,
  GraphTableResult
} from './graph.worker'
import type { DerivativeResult } from '../../../../../shared/calculator/modules/graphing'
import type { ScriptPayload } from './script.worker'
import type { ScriptExecutionResult } from '../../../../../shared/calculator/modules/scripting'

export const CAS_DEFAULT_TIMEOUT_MS = 5000
export const GRAPH_DEFAULT_TIMEOUT_MS = 2000
export const SCRIPT_DEFAULT_TIMEOUT_MS = 5000

// Singleton harnesses for the UI thread
export const casWorkerHarness = new WorkerHarness(() => {
  return new Worker(new URL('./cas.worker.ts', import.meta.url), { type: 'module' })
})

export const graphWorkerHarness = new WorkerHarness(() => {
  return new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module' })
})

export const scriptWorkerHarness = new WorkerHarness(() => {
  return new Worker(new URL('./script.worker.ts', import.meta.url), { type: 'module' })
})

export function runCasTask(
  payload: CasPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  return casWorkerHarness.run<string, CasPayload>('cas', payload, {
    timeoutMs: options?.timeoutMs ?? CAS_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphBatchSample(
  payload: GraphBatchSamplePayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<GraphBatchSampleResult> {
  return graphWorkerHarness.run<GraphBatchSampleResult, GraphBatchSamplePayload>('sampleBatch', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphAnalysis(
  payload: GraphAnalysisPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<GraphAnalysisResult> {
  return graphWorkerHarness.run<GraphAnalysisResult, GraphAnalysisPayload>('analyze', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runScriptTask(
  payload: ScriptPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<ScriptExecutionResult> {
  return scriptWorkerHarness.run<ScriptExecutionResult, ScriptPayload>('script', payload, {
    timeoutMs: options?.timeoutMs ?? SCRIPT_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphParametric(
  payload: GraphParametricPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<GraphParametricResult> {
  return graphWorkerHarness.run<GraphParametricResult, GraphParametricPayload>('sampleParametric', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphPolar(
  payload: GraphPolarPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<GraphPolarResult> {
  return graphWorkerHarness.run<GraphPolarResult, GraphPolarPayload>('samplePolar', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphValueTable(
  payload: GraphTablePayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<GraphTableResult> {
  return graphWorkerHarness.run<GraphTableResult, GraphTablePayload>('valueTable', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export function runGraphDerivative(
  payload: GraphDerivativePayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<DerivativeResult> {
  return graphWorkerHarness.run<DerivativeResult, GraphDerivativePayload>('derivative', payload, {
    timeoutMs: options?.timeoutMs ?? GRAPH_DEFAULT_TIMEOUT_MS,
    signal: options?.signal
  })
}

export { WorkerHarness, TimeoutError, CancelledError } from './harness'
export type { CasPayload } from './cas.worker'
export type {
  GraphSamplePayload,
  GraphBatchSamplePayload,
  GraphBatchSampleResult,
  GraphAnalysisPayload,
  GraphAnalysisResult
} from './graph.worker'
export type { ScriptPayload } from './script.worker'
export type {
  GraphParametricPayload,
  GraphPolarPayload,
  GraphTablePayload,
  GraphDerivativePayload,
  GraphParametricResult,
  GraphPolarResult,
  GraphTableResult
} from './graph.worker'
