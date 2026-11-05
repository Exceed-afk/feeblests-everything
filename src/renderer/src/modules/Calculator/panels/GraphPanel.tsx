import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { PlotRange, SamplePoint, ExtremaPoint, ParametricPoint, PolarPoint, TableRow, DerivativeResult } from '../../../../../shared/calculator/modules/graphing'
import {
  runGraphBatchSample,
  runGraphAnalysis,
  runGraphParametric,
  runGraphPolar,
  runGraphValueTable,
  runGraphDerivative,
  GRAPH_DEFAULT_TIMEOUT_MS,
  CancelledError
} from '../workers'

type PlotType = 'function' | 'parametric' | 'polar'

interface GraphFunctionItem {
  id: string
  expr: string
  colorVar: string
  visible: boolean
}

/**
 * Plot series colours as CSS variable TRIPLES ("R G B"), not hex values: the
 * canvas needs an rgba() string, which we build from the triple with a chosen
 * alpha. Triple form means the theme's own accent-derived palette resolves at
 * draw time, so a theme or dark-mode change just needs a redraw.
 */
const SERIES_VARS = ['--accent', '--pos', '--neg', '--mood', '--accent-fg']
const FALLBACK_SERIES = ['139 92 246', '5 122 82', '197 27 69', '47 111 159', '116 81 197']

/** Reads a CSS custom property triple from :root ("139 92 246"), with a fallback. */
function readTriple(varName: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return /^\d+( \d+){2}$/.test(value) ? value : FALLBACK_SERIES[SERIES_VARS.indexOf(varName)] ?? FALLBACK_SERIES[0]
}

const rgba = (triple: string, alpha: number) => `rgba(${triple} / ${alpha})`

export interface GraphPanelProps {
  /** The app's current angle mode, passed to the worker for polar plots. */
  angleMode: 'deg' | 'rad' | 'grad'
}

export function GraphPanel({ angleMode }: GraphPanelProps) {
  const [plotType, setPlotType] = useState<PlotType>('function')

  // Function plot state
  const [funcs, setFuncs] = useState<GraphFunctionItem[]>([
    { id: '1', expr: 'x^2 - 4', colorVar: SERIES_VARS[0], visible: true }
  ])
  // Which function the value table and derivative tools operate on.
  const [selectedId, setSelectedId] = useState('1')
  const [newExpr, setNewExpr] = useState('')
  const [range, setRange] = useState<PlotRange>({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 })
  const [sampledPoints, setSampledPoints] = useState<Record<string, SamplePoint[]>>({})
  const [isSampling, setIsSampling] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  // Parametric state
  const [xExpr, setXExpr] = useState('cos(t)')
  const [yExpr, setYExpr] = useState('sin(t)')
  const [tMin, setTMin] = useState('0')
  const [tMax, setTMax] = useState('6.283185307179586')
  const [tSamples, setTSamples] = useState('300')
  const [paramPoints, setParamPoints] = useState<ParametricPoint[]>([])
  const [isParamSampling, setIsParamSampling] = useState(false)
  const [paramError, setParamError] = useState<string | null>(null)

  // Polar state
  const [rExpr, setRExpr] = useState('1 + 0.3theta')
  const [thetaMin, setThetaMin] = useState('0')
  const [thetaMax, setThetaMax] = useState('360')
  const [thetaSamples, setThetaSamples] = useState('360')
  const [polarPoints, setPolarPoints] = useState<PolarPoint[]>([])
  const [isPolarSampling, setIsPolarSampling] = useState(false)
  const [polarError, setPolarError] = useState<string | null>(null)

  // Trace & Analysis state
  const [traceX, setTraceX] = useState<number | null>(null)
  const [analysisResults, setAnalysisResults] = useState<{ roots: number[]; extrema: ExtremaPoint[] } | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  // Value table state (selected function = first function in the list)
  const [tableStart, setTableStart] = useState('-2')
  const [tableStep, setTableStep] = useState('0.5')
  const [tableCount, setTableCount] = useState('10')
  const [tableRows, setTableRows] = useState<TableRow[] | null>(null)
  const [isTableLoading, setIsTableLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [tableCopied, setTableCopied] = useState(false)

  // Derivative state
  const [derivPoint, setDerivPoint] = useState('1')
  const [derivResult, setDerivResult] = useState<DerivativeResult | null>(null)
  const [derivError, setDerivError] = useState<string | null>(null)
  const [isDerivLoading, setIsDerivLoading] = useState(false)
  const [showTangent, setShowTangent] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef<{ x: number; y: number; range: PlotRange }>({ x: 0, y: 0, range })
  const sampleAbortRef = useRef<AbortController | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const paramAbortRef = useRef<AbortController | null>(null)
  const polarAbortRef = useRef<AbortController | null>(null)

  const selectedFunc = funcs.find((f) => f.id === selectedId) ?? funcs[0]

  // Theme changes (light/dark toggle, palette switch) re-resolve the CSS
  // variables; redrawing picks up the new values. Observing class + style
  // mutations on <html> covers both the dark toggle and colour overrides.
  const [themeEpoch, setThemeEpoch] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeEpoch((e) => e + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-style', 'style'] })
    return () => observer.disconnect()
  }, [])

  // ---------------------------------------------------------------------------
  // 1. Worker sampling for each plot type, with fast cancellation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (plotType !== 'function') return
    if (sampleAbortRef.current) sampleAbortRef.current.abort()
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
        resolution,
        angleMode
      },
      { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
    )
      .then((batch) => {
        if (sampleAbortRef.current === controller) {
          setSampledPoints(batch.results)
          setIsSampling(false)
        }
      })
      .catch((err) => {
        if (sampleAbortRef.current === controller) {
          if (!(err instanceof CancelledError)) {
            setSampleError(err instanceof Error ? err.message : String(err))
          }
          setIsSampling(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [plotType, funcs, range, angleMode])

  useEffect(() => {
    if (plotType !== 'parametric') return
    if (paramAbortRef.current) paramAbortRef.current.abort()
    const controller = new AbortController()
    paramAbortRef.current = controller

    if (!xExpr.trim() || !yExpr.trim()) {
      setParamPoints([])
      setIsParamSampling(false)
      return
    }

    setIsParamSampling(true)
    setParamError(null)

    runGraphParametric(
      {
        xExpr,
        yExpr,
        tMin: Number(tMin) || 0,
        tMax: Number(tMax) || 1,
        samples: Number(tSamples) || 300,
        angleMode
      },
      { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
    )
      .then((pts) => {
        if (paramAbortRef.current === controller) {
          setParamPoints(pts)
          setIsParamSampling(false)
        }
      })
      .catch((err) => {
        if (paramAbortRef.current === controller) {
          if (!(err instanceof CancelledError)) {
            setParamError(err instanceof Error ? err.message : String(err))
          }
          setIsParamSampling(false)
          setParamPoints([])
        }
      })

    return () => {
      controller.abort()
    }
  }, [plotType, xExpr, yExpr, tMin, tMax, tSamples, angleMode])

  useEffect(() => {
    if (plotType !== 'polar') return
    if (polarAbortRef.current) polarAbortRef.current.abort()
    const controller = new AbortController()
    polarAbortRef.current = controller

    if (!rExpr.trim()) {
      setPolarPoints([])
      setIsPolarSampling(false)
      return
    }

    setIsPolarSampling(true)
    setPolarError(null)

    runGraphPolar(
      {
        rExpr,
        thetaMin: Number(thetaMin) || 0,
        thetaMax: Number(thetaMax) || 360,
        samples: Number(thetaSamples) || 300,
        angleMode
      },
      { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
    )
      .then((pts) => {
        if (polarAbortRef.current === controller) {
          setPolarPoints(pts)
          setIsPolarSampling(false)
        }
      })
      .catch((err) => {
        if (polarAbortRef.current === controller) {
          if (!(err instanceof CancelledError)) {
            setPolarError(err instanceof Error ? err.message : String(err))
          }
          setIsPolarSampling(false)
          setPolarPoints([])
        }
      })

    return () => {
      controller.abort()
    }
  }, [plotType, rExpr, thetaMin, thetaMax, thetaSamples, angleMode])

  // ---------------------------------------------------------------------------
  // 2. Main-thread Canvas Drawing (theme tokens resolved at draw time)
  // ---------------------------------------------------------------------------
  const drawPlot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Theme tokens, read fresh each draw so a light/dark or palette change
    // only needs a redraw, never a rebuild.
    const muted = readTriple('--muted')
    const accentFg = readTriple('--accent-fg')
    const warn = readTriple('--warn')

    ctx.clearRect(0, 0, width, height)

    const toScreenX = (x: number) => ((x - range.xMin) / (range.xMax - range.xMin)) * width
    const toScreenY = (y: number) => height - ((y - range.yMin) / (range.yMax - range.yMin)) * height

    // Grid
    ctx.strokeStyle = rgba(muted, 0.15)
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

    // Axes
    ctx.strokeStyle = rgba(muted, 0.6)
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

    const strokeSeries = (points: Array<{ px: number | null; py: number | null }>, triple: string) => {
      ctx.strokeStyle = rgba(triple, 1)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      let drawing = false
      for (const pt of points) {
        if (pt.px === null || pt.py === null) {
          drawing = false
          continue
        }
        const sx = toScreenX(pt.px)
        const sy = toScreenY(pt.py)
        if (!drawing) {
          ctx.moveTo(sx, sy)
          drawing = true
        } else {
          ctx.lineTo(sx, sy)
        }
      }
      ctx.stroke()
    }

    if (plotType === 'function') {
      funcs.forEach((fn, index) => {
        if (!fn.visible || !fn.expr.trim()) return
        const points = sampledPoints[fn.id]
        if (!points || points.length === 0) return
        strokeSeries(points.map((p) => ({ px: p.x, py: p.y })), readTriple(fn.colorVar) ?? FALLBACK_SERIES[index % FALLBACK_SERIES.length])
      })
    } else if (plotType === 'parametric') {
      strokeSeries(paramPoints.map((p) => ({ px: p.x, py: p.y })), accentFg)
    } else {
      strokeSeries(polarPoints.map((p) => ({ px: p.x, py: p.y })), accentFg)
    }

    // Tangent line for the derivative tool (function plots only)
    if (plotType === 'function' && showTangent && derivResult?.kind === 'ok') {
      const { x, f, derivative } = derivResult
      const dxSpan = (range.xMax - range.xMin) * 0.5
      const x1 = x - dxSpan
      const x2 = x + dxSpan
      ctx.strokeStyle = rgba(warn, 0.9)
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(toScreenX(x1), toScreenY(f + derivative * (x1 - x)))
      ctx.lineTo(toScreenX(x2), toScreenY(f + derivative * (x2 - x)))
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Trace cursor
    if (traceX !== null && traceX >= range.xMin && traceX <= range.xMax) {
      const sx = toScreenX(traceX)
      ctx.strokeStyle = rgba(warn, 0.8)
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [plotType, funcs, range, traceX, sampledPoints, paramPoints, polarPoints, derivResult, showTangent, themeEpoch])

  useEffect(() => {
    drawPlot()
  }, [drawPlot])

  // Mouse pan and drag
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY, range: { ...range } }
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
    const colorVar = SERIES_VARS[funcs.length % SERIES_VARS.length]
    const id = String(Date.now())
    setFuncs((prev) => [
      ...prev,
      { id, expr: newExpr.trim(), colorVar, visible: true }
    ])
    setSelectedId(id)
    setNewExpr('')
  }

  const handleRemoveFunction = (id: string) => {
    setFuncs((prev) => prev.filter((f) => f.id !== id))
    if (selectedId === id) {
      const remaining = funcs.filter((f) => f.id !== id)
      setSelectedId(remaining[0]?.id ?? null)
    }
    setSampledPoints((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handleAnalyze = async (expr: string) => {
    if (analysisAbortRef.current) analysisAbortRef.current.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller

    setIsAnalyzing(true)
    setAnalysisError(null)

    try {
      const res = await runGraphAnalysis(
        { expr, range, angleMode },
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

  const handleBuildTable = async () => {
    if (!selectedFunc) return
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setIsTableLoading(true)
    setTableError(null)

    try {
      const rows = await runGraphValueTable(
        { expr: selectedFunc.expr, start: Number(tableStart) || 0, step: Number(tableStep) || 1, count: Number(tableCount) || 10, angleMode },
        { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
      )
      setTableRows(rows)
    } catch (err) {
      setTableError(err instanceof Error ? err.message : String(err))
      setTableRows(null)
    } finally {
      setIsTableLoading(false)
    }
  }

  const tableText = useMemo(() => {
    if (!tableRows) return ''
    const header = 'x\ty'
    const body = tableRows
      .map((r) => `${r.x}\t${r.y === null ? 'undefined' : String(r.y)}`)
      .join('\n')
    return `${header}\n${body}`
  }, [tableRows])

  const handleCopyTable = async () => {
    if (!tableRows) return
    void navigator.clipboard.writeText(tableText)
    setTableCopied(true)
    setTimeout(() => setTableCopied(false), 1500)
  }

  const handleDerivative = async () => {
    if (!selectedFunc) return
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setIsDerivLoading(true)
    setDerivError(null)

    try {
      const res = await runGraphDerivative(
        { expr: selectedFunc.expr, point: Number(derivPoint) || 0, angleMode },
        { timeoutMs: GRAPH_DEFAULT_TIMEOUT_MS, signal: controller.signal }
      )
      setDerivResult(res)
    } catch (err) {
      setDerivError(err instanceof Error ? err.message : String(err))
      setDerivResult(null)
    } finally {
      setIsDerivLoading(false)
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
      <div className="seg" role="group" aria-label="Graph type">
        {(['function', 'parametric', 'polar'] as PlotType[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={plotType === t}
            onClick={() => setPlotType(t)}
          >
            {t === 'function' ? 'y = f(x)' : t === 'parametric' ? 'Parametric' : 'Polar'}
          </button>
        ))}
      </div>

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
                    className="btn py-0 px-1.5 text-[10px]"
                    onClick={handleCancelSampling}
                  >
                    Cancel
                  </button>
                </span>
              )}
              {isParamSampling && <span className="text-accent-fg">Sampling...</span>}
              {isPolarSampling && <span className="text-accent-fg">Sampling...</span>}
            </div>
            <div className="flex items-center gap-2">
              {traceX !== null && <span className="font-mono">x: {traceX.toFixed(2)}</span>}
              <button type="button" className="btn text-xs py-0.5 px-2" onClick={handleResetView}>
                Reset Zoom
              </button>
            </div>
          </div>
          {sampleError && <p className="text-xs text-neg w-full px-2 pt-1">{sampleError}</p>}
          {paramError && <p className="text-xs text-neg w-full px-2 pt-1">{paramError}</p>}
          {polarError && <p className="text-xs text-neg w-full px-2 pt-1">{polarError}</p>}
        </div>

        {/* Controls */}
        <div className="space-y-3">
          {plotType === 'function' && (
            <div className="rounded-lg border border-line bg-card p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Functions y = f(x)</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {funcs.map((f) => (
                  <div
                    key={f.id}
                    className={`flex items-center gap-2 text-xs ${f.id === selectedId ? 'bg-selected rounded px-1' : ''}`}
                    data-testid={`graph-func-row-${f.expr.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`}
                  >
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
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `rgb(${readTriple(f.colorVar)})` }} />
                    <button
                      type="button"
                      className="font-mono flex-1 truncate text-left hover:text-accent-fg"
                      onClick={() => setSelectedId(f.id)}
                      aria-label={`Select function ${f.expr}`}
                      title="Select for value table and derivative"
                    >
                      {f.expr}
                    </button>
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
                <button type="button" className="btn-primary text-xs px-2.5" onClick={handleAddFunction}>
                  Add
                </button>
              </div>
            </div>
          )}

          {plotType === 'parametric' && (
            <div className="rounded-lg border border-line bg-card p-3 space-y-2 text-xs">
              <h4 className="font-semibold uppercase tracking-wider text-muted">Parametric x(t), y(t)</h4>
              <label className="block">
                <span className="text-muted block mb-1">x(t)</span>
                <input className="field font-mono w-full" value={xExpr} onChange={(e) => setXExpr(e.target.value)} aria-label="x of t expression" />
              </label>
              <label className="block">
                <span className="text-muted block mb-1">y(t)</span>
                <input className="field font-mono w-full" value={yExpr} onChange={(e) => setYExpr(e.target.value)} aria-label="y of t expression" />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label>
                  <span className="text-muted block mb-1">t min</span>
                  <input className="field font-mono w-full" value={tMin} onChange={(e) => setTMin(e.target.value)} aria-label="t minimum" />
                </label>
                <label>
                  <span className="text-muted block mb-1">t max</span>
                  <input className="field font-mono w-full" value={tMax} onChange={(e) => setTMax(e.target.value)} aria-label="t maximum" />
                </label>
                <label>
                  <span className="text-muted block mb-1">Samples</span>
                  <input className="field font-mono w-full" value={tSamples} onChange={(e) => setTSamples(e.target.value)} aria-label="parametric samples" />
                </label>
              </div>
              <p className="text-muted text-[10px]">The variable is t. Sampling stops at the 10,000-point cap.</p>
            </div>
          )}

          {plotType === 'polar' && (
            <div className="rounded-lg border border-line bg-card p-3 space-y-2 text-xs">
              <h4 className="font-semibold uppercase tracking-wider text-muted">Polar r(theta)</h4>
              <label className="block">
                <span className="text-muted block mb-1">r(theta)</span>
                <input className="field font-mono w-full" value={rExpr} onChange={(e) => setRExpr(e.target.value)} aria-label="r of theta expression" />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label>
                  <span className="text-muted block mb-1">theta min</span>
                  <input className="field font-mono w-full" value={thetaMin} onChange={(e) => setThetaMin(e.target.value)} aria-label="theta minimum" />
                </label>
                <label>
                  <span className="text-muted block mb-1">theta max</span>
                  <input className="field font-mono w-full" value={thetaMax} onChange={(e) => setThetaMax(e.target.value)} aria-label="theta maximum" />
                </label>
                <label>
                  <span className="text-muted block mb-1">Samples</span>
                  <input className="field font-mono w-full" value={thetaSamples} onChange={(e) => setThetaSamples(e.target.value)} aria-label="polar samples" />
                </label>
              </div>
              <p className="text-muted text-[10px]">
                theta is read in the current angle mode ({angleMode.toUpperCase()}).
              </p>
            </div>
          )}

          {/* Analysis View */}
          {plotType === 'function' && isAnalyzing && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-1.5">
              <span className="text-muted">Analyzing function...</span>
            </div>
          )}

          {plotType === 'function' && analysisError && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs text-neg">{analysisError}</div>
          )}

          {plotType === 'function' && analysisResults && !isAnalyzing && (
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

          {/* Value table (selected function) */}
          {plotType === 'function' && selectedFunc && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-2" data-testid="graph-value-table">
              <h4 className="font-semibold uppercase tracking-wider text-muted">Value table — {selectedFunc.expr}</h4>
              <div className="grid grid-cols-3 gap-2">
                <label>
                  <span className="text-muted block mb-1">Start</span>
                  <input className="field font-mono w-full" value={tableStart} onChange={(e) => setTableStart(e.target.value)} aria-label="Table start" />
                </label>
                <label>
                  <span className="text-muted block mb-1">Step</span>
                  <input className="field font-mono w-full" value={tableStep} onChange={(e) => setTableStep(e.target.value)} aria-label="Table step" />
                </label>
                <label>
                  <span className="text-muted block mb-1">Count</span>
                  <input className="field font-mono w-full" value={tableCount} onChange={(e) => setTableCount(e.target.value)} aria-label="Table count" />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary text-xs px-2.5" onClick={() => void handleBuildTable()} disabled={isTableLoading}>
                  {isTableLoading ? 'Building...' : 'Build table'}
                </button>
                {tableRows && (
                  <button type="button" className="btn text-xs px-2.5" onClick={() => void handleCopyTable()}>
                    {tableCopied ? 'Copied' : 'Copy table'}
                  </button>
                )}
              </div>
              {tableError && <p className="text-neg">{tableError}</p>}
              {tableRows && (
                <div className="max-h-48 overflow-y-auto border border-line/20 rounded font-mono" data-testid="graph-table-rows">
                  <table className="w-full">
                    <thead>
                      <tr className="text-muted">
                        <th className="text-left px-2 py-1">x</th>
                        <th className="text-left px-2 py-1">{selectedFunc.expr}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, i) => (
                        <tr key={i} className="border-t border-line/20">
                          <td className="px-2 py-0.5">{row.x}</td>
                          <td className="px-2 py-0.5">{row.y === null ? 'undefined' : String(row.y)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Derivative at a point (selected function) */}
          {plotType === 'function' && selectedFunc && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-2" data-testid="graph-derivative">
              <h4 className="font-semibold uppercase tracking-wider text-muted">Derivative — {selectedFunc.expr}</h4>
              <div className="flex gap-2 items-end">
                <label className="flex-1">
                  <span className="text-muted block mb-1">At x =</span>
                  <input className="field font-mono w-full" value={derivPoint} onChange={(e) => setDerivPoint(e.target.value)} aria-label="Derivative point" />
                </label>
                <button type="button" className="btn-primary text-xs px-2.5" onClick={() => void handleDerivative()} disabled={isDerivLoading}>
                  {isDerivLoading ? 'Computing...' : "Compute f'(x)"}
                </button>
              </div>
              {derivResult?.kind === 'ok' && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={showTangent} onChange={(e) => setShowTangent(e.target.checked)} />
                  <span className="text-muted">Draw tangent line</span>
                </label>
              )}
              {derivError && <p className="text-neg">{derivError}</p>}
              {derivResult && (
                <div className="font-mono" data-testid="graph-derivative-result">
                  {derivResult.kind === 'ok' ? (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-muted">f&apos;(</span>
                        {derivResult.x}
                        <span className="text-muted">) = </span>
                        {derivResult.derivative}
                      </div>
                      <div className="text-muted text-[10px]">
                        central {derivResult.central.toPrecision(6)} · left {derivResult.left.toPrecision(6)} · right {derivResult.right.toPrecision(6)}
                      </div>
                    </div>
                  ) : (
                    <div className={derivResult.kind === 'notDifferentiable' ? 'text-warn' : 'text-neg'}>
                      {derivResult.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default GraphPanel
