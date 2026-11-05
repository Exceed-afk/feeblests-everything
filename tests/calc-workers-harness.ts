import assert from 'node:assert/strict'
import {
  WorkerHarness,
  TimeoutError,
  CancelledError,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse
} from '../src/renderer/src/modules/Calculator/workers/harness'

let checks = 0
const ok = () => { checks++ }

class FakeWorker implements WorkerLike {
  public onmessage: ((event: { data: unknown }) => void) | null = null
  public onerror: ((event: unknown) => void) | null = null
  public terminated = false
  public messages: WorkerRequest[] = []

  // Simulated handler for responding
  public handler?: (req: WorkerRequest, worker: FakeWorker) => void

  postMessage(message: unknown): void {
    if (this.terminated) {
      throw new Error('Worker is terminated')
    }
    const req = message as WorkerRequest
    this.messages.push(req)
    if (this.handler) {
      this.handler(req, this)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  respond(res: WorkerResponse): void {
    if (this.onmessage) {
      this.onmessage({ data: res })
    }
  }
}

async function runTests(): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. Basic request/response
  // ---------------------------------------------------------------------------
  {
    let createdCount = 0
    let latestWorker: FakeWorker | null = null
    const factory = () => {
      createdCount++
      latestWorker = new FakeWorker()
      latestWorker.handler = (req, w) => {
        setTimeout(() => {
          w.respond({ id: req.id, ok: true, result: `echo:${req.task}:${req.payload}` })
        }, 10)
      }
      return latestWorker
    }

    const harness = new WorkerHarness(factory)
    const result = await harness.run('greet', 'world')
    assert.equal(result, 'echo:greet:world')
    assert.equal(createdCount, 1)
    ok()
  }

  // ---------------------------------------------------------------------------
  // 2. Timeout terminates worker and respawns a fresh one on next call
  // ---------------------------------------------------------------------------
  {
    let createdCount = 0
    const workers: FakeWorker[] = []
    const factory = () => {
      createdCount++
      const w = new FakeWorker()
      workers.push(w)
      // If task is 'hang', never respond; if task is 'recovered', respond
      w.handler = (req, self) => {
        if (req.task === 'good') {
          self.respond({ id: req.id, ok: true, result: 'recovered' })
        }
      }
      return w
    }

    const harness = new WorkerHarness(factory)
    let caught: Error | null = null
    try {
      await harness.run('hang', 'test', { timeoutMs: 100 })
    } catch (err) {
      caught = err as Error
    }

    assert.ok(caught instanceof TimeoutError, 'Expected TimeoutError')
    assert.equal(caught.message, 'Timed out after 0s. Try a simpler input.')
    assert.equal(workers[0].terminated, true, 'First worker must be terminated')
    assert.equal(createdCount, 1)
    ok()

    // Next call should spawn a fresh worker and succeed
    const res2 = await harness.run('good', 'y', { timeoutMs: 1000 })
    assert.equal(res2, 'recovered')
    assert.equal(createdCount, 2, 'A fresh worker should have been created')
    assert.equal(workers[1].terminated, false)
    ok()
  }

  // ---------------------------------------------------------------------------
  // 3. Clear timeout message format for different durations
  // ---------------------------------------------------------------------------
  {
    const err5s = new TimeoutError(5000)
    assert.equal(err5s.message, 'Timed out after 5s. Try a simpler input.')
    const err2s = new TimeoutError(2000)
    assert.equal(err2s.message, 'Timed out after 2s. Try a simpler input.')
    ok()
  }

  // ---------------------------------------------------------------------------
  // 4. Cancellation terminates worker and rejects with CancelledError
  // ---------------------------------------------------------------------------
  {
    const workersList: FakeWorker[] = []
    const factory = () => {
      const w = new FakeWorker()
      workersList.push(w)
      return w
    }

    const harness = new WorkerHarness(factory)
    const controller = new AbortController()

    const promise = harness.run('long_task', 123, { signal: controller.signal, timeoutMs: 10000 })
    // Cancel after 20ms
    setTimeout(() => controller.abort(), 20)

    let caught: Error | null = null
    try {
      await promise
    } catch (err) {
      caught = err as Error
    }

    assert.ok(caught instanceof CancelledError, 'Expected CancelledError')
    assert.equal(workersList[0]?.terminated, true, 'Worker should be terminated on cancel')
    ok()
  }

  // ---------------------------------------------------------------------------
  // 5. Late reply from a killed worker is ignored
  // ---------------------------------------------------------------------------
  {
    let worker: FakeWorker | null = null
    const factory = () => {
      worker = new FakeWorker()
      return worker
    }

    const harness = new WorkerHarness(factory)
    const promise = harness.run('slow', 1, { timeoutMs: 50 })

    await assert.rejects(promise, TimeoutError)
    assert.equal(worker!.terminated, true)

    // Now simulate a late reply arriving on the killed worker
    let threw = false
    try {
      worker!.respond({ id: 'req_1_99999', ok: true, result: 'late_data' })
    } catch {
      threw = true
    }
    assert.equal(threw, false, 'Late reply must not throw')
    ok()
  }

  // ---------------------------------------------------------------------------
  // 6. Concurrent requests are correlated by request id and not mixed up
  // ---------------------------------------------------------------------------
  {
    let worker: FakeWorker | null = null
    const factory = () => {
      worker = new FakeWorker()
      worker.handler = (req, self) => {
        // Intentionally reverse response order: req2 returns before req1
        const delay = req.task === 'task1' ? 40 : 10
        setTimeout(() => {
          self.respond({ id: req.id, ok: true, result: `res:${req.task}` })
        }, delay)
      }
      return worker
    }

    const harness = new WorkerHarness(factory)
    const [res1, res2] = await Promise.all([
      harness.run('task1', 'data1'),
      harness.run('task2', 'data2')
    ])

    assert.equal(res1, 'res:task1')
    assert.equal(res2, 'res:task2')
    ok()
  }

  console.log(`calc-workers-harness.ts: ${checks} checks passed`)
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
