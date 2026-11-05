import { useState, useRef, useEffect, useCallback } from 'react'
import type { ModuleProps } from '../../../lib/navigation'
import type {
  PlotRange,
  SamplePoint,
  ExtremaPoint
} from '../../../../../shared/calculator/modules/graphing'
import {
  runGraphBatchSample,
  runGraphAnalysis,
  GRAPH_DEFAULT_TIMEOUT_MS,
  CancelledError
} from '../workers'

interface GraphFunctionItem {
  id: string
  expr: string
  color: string
  visible: boolean
}

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6']

export function GraphPanel(_props: ModuleProps) {
  const [funcs, setFuncs] = useState<GraphFunctionItem[]>([
    { id: '1', expr: 'x^2 - 4', color: DEFAULT_COLORS[0], visible: true }
  ])
  const [newExpr, setNewExpr] = useState('')
  const [range, setRange] = useState<PlotRange>({
    xMin: -10,
    xMax: 10,
    yMin: -10,
    yMax: 10
  })

  // Sampled points cache per function id
  const [sampledPoints, setSampledPoints] = useState<Record<string, SamplePoint[]>>({})
  const [isSampling, setIsSampling] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  // Trace & Analysis state
  const [traceX, setTraceX] = useState<number | null>(null)
  const [analysisResults, setAnalysisResults] = useState<{
    roots: number[]
    extrema: ExtremaPoint[]
  } | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef<{ x: number; y: number; range: PlotRange }>({
    x: 0,
    y: 0,
    range
  })

  // Stale sampling abort controller
  const sampleAbortRef = useRef<AbortController | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)

  // ---------------------------------------------------------------------------
  // 1. Worker Sampling with fast pan/zoom cancellation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Abort any stale in-flight sample request
    if (sampleAbortRef.current) {
      sampleAbortRef.current.abort()
    }
    const controller = new AbortController()
    sampleAbortRef.current = controller

    const canvas = canvasRef.current
    const resolution = canvas ? canvas.width : 600

    const activeFuncs = funcs.filter((f) => f.visible && f.expr.trim())
    if (activeFuncs.length === 0) {
      setSampledPoints({})
      setIsSampling(false)
      setSampleError(null)
      return
    }

    setIsSampling(true)
    setSampleError(null)

    runGraphBatchSample(
      {
        functions: activeFuncs.map((f) => ({ id: f.id, expr: f.expr })),
        range,
        resolution
      },
      {
        timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS,
        signal: controller.signal
      }
    )
      .then((batch) => {
        if (sampleAbortRef.current === controller) {
          setSampledPoints(batch.results)
          setIsSampling(false)
        }
      })
      .catch((err) => {
        if (sampleAbortRef.current === controller) {
          if (err instanceof CancelledError) {
            // Cancelled due to rapid pan/zoom: ignore
          } else {
            setSampleError(err instanceof Error ? err.message : String(err))
          }
          setIsSampling(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [funcs, range])

  // ---------------------------------------------------------------------------
  // 2. Main-thread Canvas Drawing (stays on main thread, smooth 60fps target)
  // ---------------------------------------------------------------------------
  const drawPlot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Clear background
    ctx.clearRect(0, 0, width, height)

    // Screen coordinate mapping
    const toScreenX = (x: number) => ((x - range.xMin) / (range.xMax - range.xMin)) * width
    const toScreenY = (y: number) => height - ((y - range.yMin) / (range.yMax - range.yMin)) * height

    // Draw Grid
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.15)'
    ctx.lineWidth = 1

    const xStep = Math.pow(10, Math.floor(Math.log10((range.xMax - range.xMin) / 5))) || 1
    const xStart = Math.floor(range.xMin / xStep) * xStep
    for (let x = xStart; x <= range.xMax; x += xStep) {
      const sx = toScreenX(x)
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
      ctx.stroke()
    }

    const yStep = Math.pow(10, Math.floor(Math.log10((range.yMax - range.yMin) / 5))) || 1
    const yStart = Math.floor(range.yMin / yStep) * yStep
    for (let y = yStart; y <= range.yMax; y += yStep) {
      const sy = toScreenY(y)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
      ctx.stroke()
    }

    // Draw Axes (X = 0, Y = 0)
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)'
    ctx.lineWidth = 1.5

    const axisX = toScreenX(0)
    if (axisX >= 0 && axisX <= width) {
      ctx.beginPath()
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX, height)
      ctx.stroke()
    }

    const axisY = toScreenY(0)
    if (axisY >= 0 && axisY <= height) {
      ctx.beginPath()
      ctx.moveTo(0, axisY)
      ctx.lineTo(width, axisY)
      ctx.stroke()
    }

    // Plot Functions using latest sampled points from worker
    for (const fn of funcs) {
      if (!fn.visible || !fn.expr.trim()) continue

      const points = sampledPoints[fn.id]
      if (!points || points.length === 0) continue

      ctx.strokeStyle = fn.color
      ctx.lineWidth = 2.5
      ctx.beginPath()

      let drawing = false
      for (const pt of points) {
        if (pt.y === null || pt.discontinuous) {
          drawing = false
          continue
        }

        const sx = toScreenX(pt.x)
        const sy = toScreenY(pt.y)

        if (!drawing) {
          ctx.moveTo(sx, sy)
          drawing = true
        } else {
          ctx.lineTo(sx, sy)
        }
      }
      ctx.stroke()
    }

    // Draw Trace Cursor if set
    if (traceX !== null && traceX >= range.xMin && traceX <= range.xMax) {
      const sx = toScreenX(traceX)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [funcs, range, traceX, sampledPoints])

  useEffect(() => {
    drawPlot()
  }, [drawPlot])

  // Mouse pan and drag
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      range: { ...range }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const xCoord = range.xMin + (mouseX / canvas.width) * (range.xMax - range.xMin)
    setTraceX(xCoord)

    if (!isDraggingRef.current) return

    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y

    const xSpan = dragStartRef.current.range.xMax - dragStartRef.current.range.xMin
    const ySpan = dragStartRef.current.range.yMax - dragStartRef.current.range.yMin

    const xShift = (dx / canvas.width) * xSpan
    const yShift = (dy / canvas.height) * ySpan

    setRange({
      xMin: dragStartRef.current.range.xMin - xShift,
      xMax: dragStartRef.current.range.xMax - xShift,
      yMin: dragStartRef.current.range.yMin + yShift,
      yMax: dragStartRef.current.range.yMax + yShift
    })
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.15 : 0.85
    const xMid = (range.xMin + range.xMax) / 2
    const yMid = (range.yMin + range.yMax) / 2
    const halfX = ((range.xMax - range.xMin) * factor) / 2
    const halfY = ((range.yMax - range.yMin) * factor) / 2

    setRange({
      xMin: xMid - halfX,
      xMax: xMid + halfX,
      yMin: yMid - halfY,
      yMax: yMid + halfY
    })
  }

  const handleResetView = () => {
    setRange({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 })
  }

  const handleAddFunction = () => {
    if (!newExpr.trim()) return
    const nextColor = DEFAULT_COLORS[funcs.length % DEFAULT_COLORS.length]
    setFuncs((prev) => [
      ...prev,
      { id: String(Date.now()), expr: newExpr.trim(), color: nextColor, visible: true }
    ])
    setNewExpr('')
  }

  const handleRemoveFunction = (id: string) => {
    setFuncs((prev) => prev.filter((f) => f.id !== id))
    setSampledPoints((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handleAnalyze = async (expr: string) => {
    if (analysisAbortRef.current) {
      analysisAbortRef.current.abort()
    }
    const controller = new AbortController()
    analysisAbortRef.current = controller

    setIsAnalyzing(true)
    setAnalysisError(null)

    try {
      const res = await runGraphAnalysis(
        { expr, range },
        { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
      )
      setAnalysisResults(res)
    } catch (err) {
      if (err instanceof CancelledError) {
        setAnalysisError('Analysis cancelled.')
      } else {
        setAnalysisError(err instanceof Error ? err.message : String(err))
      }
      setAnalysisResults(null)
    } finally {
      if (analysisAbortRef.current === controller) {
        setIsAnalyzing(false)
        analysisAbortRef.current = null
      }
    }
  }

  const handleCancelSampling = () => {
    if (sampleAbortRef.current) {
      sampleAbortRef.current.abort()
      sampleAbortRef.current = null
    }
    setIsSampling(false)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Canvas Area */}
        <div className="md:col-span-2 rounded-lg border border-line bg-card p-2 shadow-card flex flex-col items-center">
          <canvas
            ref={canvasRef}
            width={600}
            height={400}
            className="w-full h-auto cursor-crosshair rounded bg-card border border-line/20"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
          <div className="flex items-center justify-between w-full px-2 pt-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span>Scroll to zoom, drag to pan</span>
              {isSampling && (
                <span className="flex items-center gap-1.5 text-accent-fg">
                  <span>Sampling...</span>
                  <button
                    type="button"
                    className="btn py-0 px-1.5 text-[10px] border border-line hover:bg-surface"
                    onClick={handleCancelSampling}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {traceX !== null && (
                <span className="font-mono">
                  x: {traceX.toFixed(2)}
                </span>
              )}
              <button
                type="button"
                className="btn btn text-xs py-0.5 px-2"
                onClick={handleResetView}
              >
                Reset Zoom
              </button>
            </div>
          </div>
          {sampleError && <p className="text-xs text-neg w-full px-2 pt-1">{sampleError}</p>}
        </div>

        {/* Function List & Controls */}
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-card p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Functions y = f(x)</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {funcs.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={f.visible}
                    onChange={(e) =>
                      setFuncs((prev) =>
                        prev.map((item) =>
                          item.id === f.id ? { ...item, visible: e.target.checked } : item
                        )
                      )
                    }
                  />
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: f.color }} />
                  <span className="font-mono flex-1 truncate">{f.expr}</span>
                  <button
                    type="button"
                    className="text-[10px] text-muted hover:text-accent-fg"
                    onClick={() => handleAnalyze(f.expr)}
                    disabled={isAnalyzing}
                  >
                    Analyze
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-neg hover:opacity-80"
                    onClick={() => handleRemoveFunction(f.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-line/20">
              <input
                className="field text-xs font-mono flex-1"
                placeholder="e.g. sin(x) or 3x - 2"
                value={newExpr}
                onChange={(e) => setNewExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFunction()
                }}
              />
              <button
                type="button"
                className="btn-primary text-xs px-2.5"
                onClick={handleAddFunction}
              >
                Add
              </button>
            </div>
          </div>

          {/* Analysis View */}
          {isAnalyzing && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-1.5">
              <span className="text-muted">Analyzing function...</span>
            </div>
          )}

          {analysisError && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs text-neg">
              {analysisError}
            </div>
          )}

          {analysisResults && !isAnalyzing && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-1.5 font-mono">
              <div className="font-semibold text-accent-fg">Function Analysis</div>
              <div>
                <span className="text-muted">Roots (y = 0): </span>
                {analysisResults.roots.length === 0
                  ? 'None found'
                  : analysisResults.roots.map((r) => r.toFixed(3)).join(', ')}
              </div>
              <div>
                <span className="text-muted">Extrema: </span>
                {analysisResults.extrema.length === 0
                  ? 'None found'
                  : analysisResults.extrema
                    .map((e) => `${e.type.toUpperCase()}(${e.x.toFixed(2)}, ${e.y.toFixed(2)})`)
                    .join('; ')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default GraphPanel
