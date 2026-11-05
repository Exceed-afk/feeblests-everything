import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { Calculator } from './modules/Calculator/Calculator'
import type { Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { applyAppearance } from './lib/theme'
import './styles.css'

const settingsFor = (dark: boolean): Settings => ({ ...DEFAULT_SETTINGS, theme: dark ? 'dark' : 'light' })
applyAppearance(settingsFor(false))

// Screenshot harness for the calculator layout fixes. Not part of the app.
function Harness() {
  const [dark, setDark] = useState(false)
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark')
    applyAppearance(settingsFor(next))
    setDark(next)
  }
  return (
    <div className="flex h-full">
      <nav
        style={{ width: 210, flex: '0 0 auto', background: 'rgb(var(--sidebar))', borderRight: '1px solid rgb(var(--line))' }}
        className="p-3 text-sm"
      >
        <div className="font-semibold mb-2">Sidebar</div>
        <div className="text-muted">Calculator</div>
        <button type="button" className="btn btn-sm mt-4" onClick={toggle}>
          {dark ? 'Light' : 'Dark'}
        </button>
      </nav>
      <main tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none">
        <Calculator
          onNavigate={() => { }}
          onOpen={() => { }}
          onTargetHandled={() => { }}
          target={null}
        />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
