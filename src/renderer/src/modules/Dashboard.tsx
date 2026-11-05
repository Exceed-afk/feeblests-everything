// The Dashboard (Phase 6): a 12-column grid of widgets, arranged by the user.
//
// - Every cell is a widget from src/renderer/src/widgets.ts, loaded lazily and
//   fetched only when it is on screen.
// - The arrangement is an ordered list of { id, size } saved in settings
//   (dashboardLayout, as JSON). The placement arithmetic, the presets and the
//   move/add/remove rules are pure and live in src/shared/dashboardLayout.ts.
// - Edit mode: add, remove, reorder (drag, or the arrow buttons, which also
//   answer Alt+ArrowUp / Alt+ArrowDown from the keyboard) and resize between
//   the widget's preset sizes. Nothing is free-form: no drag-resize.
// - A widget whose module is switched off (Settings > Modules) is skipped;
//   the stored layout is left alone, so turning the module back on brings the
//   widget back where it was.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import type { ModuleProps } from '../lib/navigation'
import { updateSettings, useSettings } from '../lib/settingsStore'
import { formatDate, today } from '../lib/dates'
import { useRefreshOnCapture } from '../lib/dataChanged'
import {
  DASHBOARD_PRESETS, LAYOUT_PRESETS, WIDGET_SIZE_LABELS, WIDGET_SIZES, addWidget, moveWidgetBy,
  normaliseSize, parseLayout, placeWidgets, removeWidget, resolveLayout, serializeLayout, setWidgetSize,
  type DashboardPreset, type WidgetSize
} from '../../../shared/dashboardLayout'
import { WIDGETS, findWidget, hasWidget, widgetAllowed, type WidgetProps } from '../widgets'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { invalidateSummary } from '../lib/dashboardSummary'

const greeting = (): string => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

// How often the grid changes its column count: 12 on a wide window, 6 when
// the page is narrower, and 1 (stack) on small screens.
function useGridColumns(ref: React.RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(() => {
    if (typeof window === 'undefined') return 12
    const w = window.innerWidth
    return w >= 1060 ? 12 : w >= 660 ? 6 : 1
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      setColumns(w >= 1000 ? 12 : w >= 620 ? 6 : 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return columns
}

// Where the saved layout lives: the `dashboardLayout` settings key (JSON text),
// read through useSettings() and written through updateSettings(). It is one
// settings key, so it rides along in the JSON backup like every other choice.

export function Dashboard({ onOpen, onNavigate }: ModuleProps) {
  const settings = useSettings()
  const disabled = settings.disabledModules ?? []
  const gridRef = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(gridRef)

  // The layout as the user last saved it. The settings value is JSON text; an
  // unreadable value falls back to the shipped arrangement.
  const stored = useMemo(() => parseLayout(settings.dashboardLayout) ?? LAYOUT_PRESETS.default, [settings.dashboardLayout])
  // Widgets whose module is off (or that no longer exist) are skipped, not deleted.
  const allowed = useCallback((id: string) => {
    const def = findWidget(id)
    return def !== undefined && widgetAllowed(def, disabled)
  }, [disabled])
  const layout = useMemo(() => resolveLayout(stored, allowed), [stored, allowed])

  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')

  const save = useCallback((next: { id: string; size: WidgetSize }[]) => {
    updateSettings({ dashboardLayout: serializeLayout(next) })
    invalidateSummary()
  }, [])

  // Widgets read fresh numbers whenever something was saved elsewhere (Quick
  // capture, undo of a delete) by remounting: the key changes with the reload.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => { invalidateSummary(); setReloadKey((k) => k + 1) }, [])
  useRefreshOnCapture(reload)

  const indexOf = (id: string) => layout.findIndex((w) => w.id === id)
  const titleOf = (id: string) => findWidget(id)?.title ?? id

  const move = (id: string, delta: number) => {
    const from = indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= layout.length) return
    save(moveWidgetBy(layout, id, delta))
    setAnnounce(`${titleOf(id)} moved to position ${to + 1} of ${layout.length}.`)
    // Focus follows the widget, so repeated presses keep moving the same one.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-handle="${id}"]`)?.focus())
  }
  const drop = (targetId: string | null) => {
    const id = dragging
    setDragging(null)
    setOverId(null)
    if (!id) return
    if (targetId === null) { move(id, layout.length - indexOf(id)); return }
    if (targetId === id) return
    const from = indexOf(id)
    const to = indexOf(targetId)
    if (from < 0 || to < 0) return
    save(moveWidgetBy(layout, id, to - from))
    setAnnounce(`${titleOf(id)} moved to position ${to + 1} of ${layout.length}.`)
  }
  const remove = (id: string) => {
    save(removeWidget(layout, id))
    setAnnounce(`${titleOf(id)} removed from the dashboard.`)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-add-widget]')?.focus())
  }
  const add = (id: string) => {
    const def = findWidget(id)
    save(addWidget(layout, id, def?.sizes.includes('m') ? 'm' : def?.sizes[0] ?? 'm'))
    setAnnounce(`${titleOf(id)} added to the dashboard.`)
  }
  const resize = (id: string, size: WidgetSize) => {
    save(setWidgetSize(layout, id, size))
    setAnnounce(`${titleOf(id)} is now ${WIDGET_SIZE_LABELS[size].toLowerCase()}.`)
  }
  const applyPreset = (preset: DashboardPreset) => {
    save(LAYOUT_PRESETS[preset])
    setAnnounce(preset === 'default' ? 'The dashboard is back to its default arrangement.' : `The ${DASHBOARD_PRESETS.find((p) => p.id === preset)?.name} layout is applied.`)
  }

  // Escape leaves edit mode, whichever control has focus.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const slots = placeWidgets(layout, columns)
  const toAdd = WIDGETS.filter((w) => widgetAllowed(w, disabled) && !layout.some((p) => p.id === w.id))
  const widgetProps: WidgetProps = { editMode: editing, onNavigate, onOpen }

  return (
    <div className="page page-lg">
      <PageHeader title={greeting()} subtitle={`${formatDate(today())}. Your data stays on this computer.`}>
        {!editing ? (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            <Settings2 size={14} aria-hidden="true" /> Customize
          </button>
        ) : (
          <button className="btn-primary btn-sm" onClick={() => setEditing(false)}>
            <Check size={14} aria-hidden="true" /> Done
          </button>
        )}
      </PageHeader>

      {editing && (
        <section className="card card-pad-sm mb-4 border border-line shadow-sm" aria-label="Dashboard layout options">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Layout</span>
              <div className="seg" role="group" aria-label="Dashboard presets">
                {DASHBOARD_PRESETS.map((p) => (
                  <button key={p.id} onClick={() => applyPreset(p.id)} title={p.hint}>
                    {p.id === 'default' ? <span className="flex items-center gap-1"><RotateCcw size={12} aria-hidden="true" />{p.name}</span> : p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="widget-to-add" className="text-xs font-semibold uppercase tracking-wider text-muted">Add widget</label>
              <select id="widget-to-add" data-add-widget className="field w-48 py-1 text-xs" value=""
                onChange={(e) => { if (e.target.value) add(e.target.value); e.target.value = '' }}>
                <option value="" disabled>{toAdd.length === 0 ? 'All widgets added' : 'Choose a widget…'}</option>
                {toAdd.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              </select>
              <button className="btn btn-sm" disabled={toAdd.length === 0} onClick={() => toAdd[0] && add(toAdd[0].id)} aria-label="Add a widget">
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className="meta mt-2 text-xs">
            Drag a card by its handle to move it, or use the arrow buttons. Alt+Up and Alt+Down also move the focused card.
            Each card can be small, medium or large. Changes save as you go.
          </p>
        </section>
      )}

      {/* Screen-reader feedback for every move and change */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      <p role="status" aria-live="polite" className={`${announce ? '' : 'hidden'} mb-3 text-sm text-muted`}>{announce}</p>

      {layout.length === 0 ? (
        <div className="card card-pad">
          <EmptyState title="An empty dashboard" text="Add the widgets you want to see each morning: savings, habits, tasks, spending."
            action={<button className="btn-primary" onClick={() => setEditing(true)}><Plus size={14} aria-hidden="true" /> Add widgets</button>} />
        </div>
      ) : (
        <div ref={gridRef} className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(12, columns))}, minmax(0, 1fr))` }}>
          {slots.map((slot, i) => {
            const def = findWidget(slot.id)
            if (!def) return null
            const size = normaliseSize(slot.size, def.sizes)
            return (
              <div
                key={`${slot.id}-${reloadKey}`}
                style={{ gridColumn: `${slot.offset + 1} / span ${slot.columns}` }}
                className={overId === slot.id && dragging !== slot.id ? 'rounded-[inherit] outline outline-2 -outline-offset-2 outline-accent' : ''}
                onDragOver={editing ? (e) => { if (dragging) { e.preventDefault(); setOverId(slot.id) } } : undefined}
                onDragLeave={editing ? () => setOverId((o) => (o === slot.id ? null : o)) : undefined}
                onDrop={editing ? (e) => { e.preventDefault(); drop(slot.id) } : undefined}
              >
                <div className={`dash-widget-box ${editing ? 'dash-editing' : ''}`}>
                  {editing && (
                    <div className="dash-widget-bar">
                      {/* Left: Reorder controls */}
                      <div className="flex items-center gap-1">
                        <div
                          data-widget-handle={slot.id}
                          role="button"
                          tabIndex={0}
                          draggable
                          aria-label={`Drag to move ${def.title}. Position ${i + 1} of ${layout.length}. Alt+Up and Alt+Down move it.`}
                          onDragStart={(e) => { setDragging(slot.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', slot.id) }}
                          onDragEnd={() => { setDragging(null); setOverId(null) }}
                          onKeyDown={(e) => {
                            if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(slot.id, -1) }
                            if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(slot.id, 1) }
                          }}
                          className="flex cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-fg hover:bg-fg/10 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <GripVertical size={13} className="shrink-0 text-muted" aria-hidden="true" />
                          <span>Move</span>
                        </div>
                        <button
                          className="dash-ctrl-btn"
                          aria-label={`Move ${def.title} up`}
                          title={`Move ${def.title} up (Alt+Up)`}
                          disabled={i === 0}
                          onClick={() => move(slot.id, -1)}
                        >
                          <ArrowUp size={12} aria-hidden="true" />
                        </button>
                        <button
                          className="dash-ctrl-btn"
                          aria-label={`Move ${def.title} down`}
                          title={`Move ${def.title} down (Alt+Down)`}
                          disabled={i === layout.length - 1}
                          onClick={() => move(slot.id, 1)}
                        >
                          <ArrowDown size={12} aria-hidden="true" />
                        </button>
                      </div>

                      {/* Right: Size selector and Remove */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {def.sizes.length > 1 && (
                          <div className="dash-size-seg" role="group" aria-label={`Size of ${def.title}`}>
                            {WIDGET_SIZES.filter((s) => def.sizes.includes(s)).map((s) => (
                              <button
                                key={s}
                                aria-pressed={size === s}
                                onClick={() => resize(slot.id, s)}
                                title={`${WIDGET_SIZE_LABELS[s]} (${s.toUpperCase()})`}
                                className="dash-size-btn"
                              >
                                {s.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          className="dash-ctrl-btn hover:text-neg hover:bg-neg/10"
                          aria-label={`Remove ${def.title} from the dashboard`}
                          title={`Remove ${def.title}`}
                          onClick={() => remove(slot.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="dash-widget-content">
                    <Suspense fallback={<WidgetLoading title={def.title} />}>
                      <def.component {...widgetProps} />
                    </Suspense>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && toAdd.length > 0 && (
        <section className="mt-4" aria-label="Widgets you can add">
          <h2 className="section-title"><Plus size={15} /> Available widgets</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {toAdd.map((w) => <button key={w.id} className="btn btn-sm" onClick={() => add(w.id)}><Plus size={12} aria-hidden="true" /> {w.title}</button>)}
          </div>
        </section>
      )}
    </div>
  )
}

// The card shape shown while a widget's code is still arriving.
function WidgetLoading({ title }: { title: string }) {
  return (
    <div className="card card-pad-sm">
      <div className="section-title flex items-center gap-2 text-sm">{title}</div>
      <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
        <div className="h-6 w-1/3 rounded bg-fg/10" />
        <div className="h-2 w-full rounded bg-fg/10" />
      </div>
    </div>
  )
}

// Exported for the widget registry's own sanity check and for tests: every id a
// preset or the default layout names must be a widget that exists.
export const KNOWN_WIDGET_IDS = (): string[] => WIDGETS.map((w) => w.id)
export const hasWidgetId = hasWidget
