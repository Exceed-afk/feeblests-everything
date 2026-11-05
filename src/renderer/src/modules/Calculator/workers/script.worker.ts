import {
  executeScript,
  type ScriptContext,
  type ScriptExecutionResult
} from '../../../../../shared/calculator/modules/scripting'
import { CALC_LIMITS } from '../../../../../shared/calculator/limits'
import type { WorkerRequest, WorkerResponse } from './harness'

export interface ScriptPayload {
  source: string
  context?: ScriptContext
}

self.onmessage = (event: MessageEvent<WorkerRequest<ScriptPayload>>) => {
  const req = event.data
  if (!req || typeof req !== 'object' || !req.id) return

  try {
    const { source, context = {} } = req.payload

    // Enforce that callers cannot raise the step limit above the hard cap from 3a / CALC_LIMITS.scriptSteps
    const requested = context.maxSteps === undefined ? CALC_LIMITS.scriptSteps : Number(context.maxSteps)
    const cappedSteps = Math.min(CALC_LIMITS.scriptSteps, Math.max(1, Math.floor(requested)))

    const safeContext: ScriptContext = {
      ...context,
      maxSteps: cappedSteps
    }

    const result: ScriptExecutionResult = executeScript(source, safeContext)
    const res: WorkerResponse<ScriptExecutionResult> = { id: req.id, ok: true, result }
    self.postMessage(res)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const res: WorkerResponse<ScriptExecutionResult> = { id: req.id, ok: false, error: errorMsg }
    self.postMessage(res)
  }
}
