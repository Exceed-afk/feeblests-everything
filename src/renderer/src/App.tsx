import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { MODULES } from './modules'
import { applyTheme } from './lib/theme'
import { setTagColors } from './lib/tagColors'
import type { OpenTarget } from './lib/navigation'

export default function App() {
  const [active, setActive] = useState(MODULES[0].id)
  // An item another page asked us to open (e.g. a search result). The page
  // that receives it opens the item, then clears it.
  const [target, setTarget] = useState<OpenTarget | null>(null)
  const open = useCallback((t: OpenTarget) => { setTarget(t); setActive(t.module) }, [])
  const clearTarget = useCallback(() => setTarget(null), [])

  // Load saved theme once at startup.
  useEffect(() => { window.api.settings.getAll().then((s) => { applyTheme(s); setTagColors(s.tagColors) }) }, [])

  // Ctrl+1..6 switches module. Ctrl+K jumps to Search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setActive('search'); return }
      const m = MODULES[Number(e.key) - 1]
      if (m) { e.preventDefault(); setActive(m.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Page = MODULES.find((m) => m.id === active)!.page
  return (
    <div className="flex h-full">
      <Sidebar active={active} onSelect={setActive} />
      <main className="flex-1 overflow-y-auto"><Page target={target} onTargetHandled={clearTarget} onOpen={open} onNavigate={setActive} /></main>
    </div>
  )
}
