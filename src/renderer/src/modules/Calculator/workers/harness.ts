export interface WorkerRequest<T = unknown> {
  id: string
  task: string
  payload: T
}

export interface WorkerResponse<T = unknown> {
  id: string
  ok: boolean
  result?: T
  error?: string
}

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
}

export type WorkerFactory = () => WorkerLike

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    const s = Math.round(timeoutMs / 1000)
    super(`Timed out after ${s}s. Try a simpler input.`)
    this.name = 'TimeoutError'
  }
}

export class CancelledError extends Error {
  constructor(message = 'Task cancelled') {
    super(message)
    this.name = 'CancelledError'
  }
}

interface PendingRequest {
  id: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
  timeoutMs: number
  cleanupAbort?: () => void
}

/**
 * Shared worker client harness.
 * - Handles correlation via unique request ids so concurrent/reordered replies are not mixed up.
 * - Enforces hard timeout: on timeout, terminates the worker immediately, rejects with TimeoutError,
 *   and marks the worker instance for replacement so the next call gets a fresh worker.
 * - Handles AbortSignal cancellation: on abort, terminates the worker (if this was the running task),
 *   rejects with CancelledError, and starts fresh on next call.
 * - Late replies from killed workers are discarded.
 * - Worker factory can be injected for testing.
 */
export class WorkerHarness {
  private factory: WorkerFactory
  private worker: WorkerLike | null = null
  private pending: Map<string, PendingRequest> = new Map()
  private nextId = 1

  constructor(factory: WorkerFactory) {
    this.factory = factory
  }

  private getWorker(): WorkerLike {
    if (!this.worker) {
      this.worker = this.factory()
      this.worker.onmessage = (event: { data: unknown }) => {
        const data = event?.data as WorkerResponse | undefined
        if (!data || typeof data !== 'object' || typeof data.id !== 'string') {
          return
        }
        const req = this.pending.get(data.id)
        if (!req) {
          // Late reply or unknown id; discard
          return
        }
        this.pending.delete(data.id)
        clearTimeout(req.timer)
        if (req.cleanupAbort) req.cleanupAbort()

        if (data.ok) {
          req.resolve(data.result)
        } else {
          req.reject(new Error(data.error || 'Worker task failed'))
        }
      }

      this.worker.onerror = (err: unknown) => {
        // Fail all currently pending requests and terminate worker
        const error = err instanceof Error ? err : new Error(String(err) || 'Worker error')
        this.terminateAndRejectAll(error)
      }
    }
    return this.worker
  }

  private terminateAndRejectAll(reason: Error): void {
    const active = Array.from(this.pending.values())
    this.pending.clear()
    for (const req of active) {
      clearTimeout(req.timer)
      if (req.cleanupAbort) req.cleanupAbort()
      req.reject(reason)
    }
    if (this.worker) {
      try {
        this.worker.terminate()
      } catch {
        // ignore
      }
      this.worker = null
    }
  }

  public run<TResult = unknown, TPayload = unknown>(
    task: string,
    payload: TPayload,
    options: RunOptions = {}
  ): Promise<TResult> {
    const { timeoutMs = 5000, signal } = options

    if (signal?.aborted) {
      return Promise.reject(new CancelledError())
    }

    const id = `req_${this.nextId++}_${Date.now()}`
    const worker = this.getWorker()

    return new Promise<TResult>((resolve, reject) => {
      let cleanupAbort: (() => void) | undefined

      const timer = setTimeout(() => {
        this.pending.delete(id)
        if (cleanupAbort) cleanupAbort()

        // Hard timeout: terminate worker to kill the runaway computation
        if (this.worker) {
          try {
            this.worker.terminate()
          } catch {
            // ignore
          }
          this.worker = null
        }

        // Also reject any other pending requests with an error since worker is dead
        const otherPending = Array.from(this.pending.values())
        this.pending.clear()
        for (const other of otherPending) {
          clearTimeout(other.timer)
          if (other.cleanupAbort) other.cleanupAbort()
          other.reject(new Error('Worker terminated due to timeout on another request'))
        }

        reject(new TimeoutError(timeoutMs))
      }, timeoutMs)

      if (signal) {
        const onAbort = () => {
          this.pending.delete(id)
          clearTimeout(timer)
          if (cleanupAbort) cleanupAbort()

          // Hard abort: terminate worker so runaway work stops
          if (this.worker) {
            try {
              this.worker.terminate()
            } catch {
              // ignore
            }
            this.worker = null
          }

          reject(new CancelledError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        cleanupAbort = () => signal.removeEventListener('abort', onAbort)
      }

      this.pending.set(id, {
        id,
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
        timeoutMs,
        cleanupAbort
      })

      const req: WorkerRequest<TPayload> = { id, task, payload }
      try {
        worker.postMessage(req)
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        if (cleanupAbort) cleanupAbort()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Force terminate currently running worker. */
  public terminate(): void {
    this.terminateAndRejectAll(new CancelledError('Worker terminated'))
  }
}
