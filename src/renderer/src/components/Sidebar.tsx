import { useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { ChevronDown, Moon, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Sun } from 'lucide-react'
import { TOOLS, type ToolDef } from '../tools'
import { sidebarLayout, toggleId } from '../../../shared/tools'
import { getCurrentSettings, useSettings, updateSettings, toggleTheme } from '../lib/settingsStore'
import { isDark } from '../lib/theme'

export const SIDEBAR_NARROW = '(max-width: 999px)' // below this the sidebar shrinks to icons so the page keeps its room (App.tsx reads it too)
const PINNED_GROUP = 'pinned' // the id used to remember whether the Pinned section is open

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(SIDEBAR_NARROW).matches)
  useEffect(() => {
    const q = matchMedia(SIDEBAR_NARROW)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}

// A tooltip for the icons-only sidebar. It is drawn at a fixed position next to the icon,
// because the sidebar itself clips anything that sticks out of it.
interface Tip { label: string; hint: string | null; top: number }

// Left navigation, read from the tool registry (tools.ts):
//  - a "Pinned" section on top (the user's own pins), then one collapsible group per category
//  - full width with labels, or an icons-only rail (collapse button, Ctrl+B, or automatically in a narrow window)
// What is pinned, which groups are closed and whether the rail is icons-only are saved in the settings.
export function Sidebar({ active, onSelect, tools: visible = TOOLS }: { active: string; onSelect: (id: string) => void; tools?: ToolDef[] }) {
  const settings = useSettings()
  const narrow = useNarrow()
  const collapsed = settings.sidebarCollapsed || narrow
  const dark = isDark(settings)
  const navRef = useRef<HTMLElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  const layout = useMemo(() => sidebarLayout(visible, settings.pinnedTools), [visible, settings.pinnedTools])
  const closed = useMemo(() => new Set(settings.sidebarClosedGroups), [settings.sidebarClosedGroups])
  const pinnedIds = new Set(layout.pinned.map((t) => t.id))

  // Pinning moves a tool to another group, which re-creates its buttons. So: open the group the tool is moving into (it
  // must not vanish into a folded one), and afterwards hand keyboard focus to the tool's pin button in its new place.
  const pinFocus = useRef<string | null>(null)
  const togglePin = (id: string) => {
    const now = getCurrentSettings() // read live, so fast clicks never use an old list
    const destination = now.pinnedTools.includes(id) ? TOOLS.find((t) => t.id === id)?.category : PINNED_GROUP
    pinFocus.current = id
    updateSettings({
      pinnedTools: toggleId(now.pinnedTools, id),
      ...(destination && now.sidebarClosedGroups.includes(destination) ? { sidebarClosedGroups: toggleId(now.sidebarClosedGroups, destination) } : {})
    })
  }
  useEffect(() => {
    const id = pinFocus.current
    if (!id) return
    pinFocus.current = null
    const lost = !document.activeElement || document.activeElement === document.body // the button that had focus was replaced
    if (lost) navRef.current?.querySelector<HTMLElement>(`[data-pin-for="${id}"]`)?.focus()
  }, [settings.pinnedTools])
  const toggleGroup = (id: string) => updateSettings({ sidebarClosedGroups: toggleId(getCurrentSettings().sidebarClosedGroups, id) })

  // Hover or keyboard focus on an icon shows its name (and shortcut) beside it. Only used in the icons-only rail.
  const tipHandlers = (label: string, hint: string | null) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => showTip(e.currentTarget, label, hint),
    onFocus: (e: FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, label, hint) },
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null)
  })
  useEffect(() => setTip(null), [collapsed]) // a tip left over from before the rail was opened must not come back with it
  const showTip = (el: HTMLElement, label: string, hint: string | null) => {
    if (!collapsed) return
    const r = el.getBoundingClientRect()
    setTip({ label, hint, top: r.top + r.height / 2 })
  }

  const row = (t: ToolDef) => {
    const hint = t.shortcut ? `Ctrl+${t.shortcut}` : null // the same keys App.tsx listens for
    const pinnable = !t.footer
    const isPinned = pinnedIds.has(t.id)
    return (
      <div key={t.id} className="sb-row" data-pinnable={pinnable && !collapsed}>
        <button className="sb-item" onClick={() => onSelect(t.id)}
          title={collapsed ? undefined : hint ? `${t.name} (${hint})` : t.name}
          aria-label={collapsed ? t.name : undefined} aria-current={t.id === active ? 'page' : undefined}
          aria-keyshortcuts={t.shortcut ? `Control+${t.shortcut}` : undefined}
          {...tipHandlers(t.name, hint)}>
          <t.icon size={18} />
          <span className="sb-label">{t.name}</span>
          {hint && <kbd className="sb-kbd" aria-hidden="true">{hint}</kbd>}
        </button>
        {pinnable && !collapsed && (
          <button className="sb-pin" data-pin-for={t.id} onClick={() => togglePin(t.id)}
            aria-label={isPinned ? `Unpin ${t.name}` : `Pin ${t.name} to the top`} title={isPinned ? 'Unpin' : 'Pin to the top'}>
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )}
      </div>
    )
  }

  // One group of tools. A flat group has no heading and is always open; the others open and close.
  const group = (id: string, name: string, tools: ToolDef[], flat = false) => {
    const open = flat || !closed.has(id)
    const hasActive = tools.some((t) => t.id === active)
    const bodyId = `sb-group-${id}`
    return (
      <div key={id} className="sb-group" data-open={open} data-has-active={hasActive}>
        {!flat && (
          <button className="sb-group-head" onClick={() => toggleGroup(id)} aria-expanded={open} aria-controls={bodyId}>
            <ChevronDown size={14} className="sb-chevron" aria-hidden="true" />
            <span className="sb-group-name">{name}</span>
            {!open && hasActive && <span className="sr-only"> (contains the current page)</span>}
          </button>
        )}
        <div className="sb-group-body" id={bodyId} role="group" aria-label={name}>
          <div className="sb-group-inner">{tools.map(row)}</div>
        </div>
      </div>
    )
  }

  const themeLabel = dark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <nav ref={navRef} className="sb" data-collapsed={collapsed} aria-label="Main navigation">
      <div className="sb-head">
        <div className="sb-logo" aria-hidden="true">F</div>
        <div className="sb-title">Feeblest's Everything</div>
        <button className="btn-icon" onClick={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
          disabled={narrow} aria-expanded={!collapsed} title={narrow ? 'The window is too narrow for the full sidebar' : collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="sb-nav" onScroll={() => setTip(null)}>
        {layout.pinned.length > 0 && group(PINNED_GROUP, 'Pinned', layout.pinned)}
        {layout.groups.map((g) => group(g.id, g.name, g.tools, g.flat))}
      </div>

      <div className="sb-foot">
        <button className="sb-item" onClick={toggleTheme} title={collapsed ? undefined : themeLabel} aria-label={themeLabel} {...tipHandlers(dark ? 'Light mode' : 'Dark mode', null)}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          <span className="sb-label">{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        {layout.footer.map(row)}
      </div>

      {collapsed && tip && (
        <div className="sb-tip" role="tooltip" style={{ top: tip.top, left: (navRef.current?.getBoundingClientRect().right ?? 0) + 8 }}>
          {tip.label}{tip.hint && <kbd className="kbd">{tip.hint}</kbd>}
        </div>
      )}
    </nav>
  )
}
