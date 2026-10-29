import { useCallback, useEffect, useState } from 'react'
import { Sidebar, SIDEBAR_NARROW } from './components/Sidebar'
import { PaletteHost } from './components/PaletteHost'
import { START_TOOL, findTool, toolByShortcut } from './tools'
import { getCurrentSettings, loadSettings, updateSettings } from './lib/settingsStore'
import type { OpenTarget } from './lib/navigation'
import { pushRecent } from '../../shared/palette'

export default function App() {
  const [active, setActive] = useState(START_TOOL.id)
  // An item another page asked us to open (e.g. a search result). The page
  // that receives it opens the item, then clears it.
  const [target, setTarget] = useState<OpenTarget | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  // Go to a tool by id ("trades") or route ("/trades"). An unknown name is ignored, so a typo cannot blank the app.
  // Every way of changing tool goes through here (sidebar, shortcuts, palette, "View all"), so "recent tools" sees them all.
  const navigate = useCallback((where: string) => {
    const t = findTool(where)
    if (!t) return
    setActive(t.id)
    const recent = getCurrentSettings().recentTools // read live, so quick successive moves never use an old list
    const next = pushRecent(recent, t.id)
    if (next !== recent) updateSettings({ recentTools: next }) // unchanged (already the newest) = nothing to save
  }, [])
  const open = useCallback((t: OpenTarget) => { setTarget(t); navigate(t.module) }, [navigate])
  const clearTarget = useCallback(() => setTarget(null), [])

  // Load the saved look (theme, colours, tag colours) once at startup.
  useEffect(() => { loadSettings() }, [])

  // Ctrl+K (Cmd+K on a Mac) opens or closes the command palette. Ctrl+<digit> opens the tool that declares that
  // shortcut (see tools.ts). Ctrl+B collapses or expands the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!e.repeat) setPaletteOpen((o) => !o) // holding the keys down must not flicker it open and shut
        return
      }
      if (!e.ctrlKey) return
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        // In a narrow window the sidebar is icons-only whatever the setting says (and the button is disabled), so
        // flipping the saved choice would change nothing on screen and surprise the user when the window is widened.
        if (!matchMedia(SIDEBAR_NARROW).matches) updateSettings({ sidebarCollapsed: !getCurrentSettings().sidebarCollapsed })
        return
      }
      const t = toolByShortcut(e.key)
      if (t) { e.preventDefault(); navigate(t.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const Page = (findTool(active) ?? START_TOOL).component
  return (
    <div className="flex h-full">
      <Sidebar active={active} onSelect={navigate} />
      {/* tabIndex -1: the palette can hand focus to the page when the element that had it is gone */}
      <main tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none"><Page target={target} onTargetHandled={clearTarget} onOpen={open} onNavigate={navigate} /></main>
      {paletteOpen && <PaletteHost active={active} navigate={navigate} open={open} onClose={closePalette} />}
    </div>
  )
}
