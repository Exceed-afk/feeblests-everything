import { useMemo } from 'react'
import { CommandPalette } from './CommandPalette'
import { TOOLS } from '../tools'
import { ACTIONS } from '../actions'
import { actionItems, recentToolItems, toolItems } from '../lib/paletteItems'
import { useSettings } from '../lib/settingsStore'
import type { OpenTarget } from '../lib/navigation'

// Feeds the palette: the tools (tools.ts), the actions (actions.ts) and the recent tools (saved in the settings).
// Rendered only while the palette is open, so the rest of the app never re-renders because of it.
export function PaletteHost({ active, navigate, open, onClose }: {
  active: string // id of the tool on screen
  navigate: (where: string) => void
  open: (target: OpenTarget) => void
  onClose: () => void
}) {
  const { recentTools } = useSettings()
  const tools = useMemo(() => toolItems(TOOLS, active, navigate), [active, navigate])
  const items = useMemo(() => [...tools, ...actionItems(ACTIONS, { navigate, open })], [tools, navigate, open])
  const recent = useMemo(() => recentToolItems(tools, recentTools, active), [tools, recentTools, active])

  // Nothing opened yet: list every tool rather than an empty box.
  const emptyItems = useMemo(() => (recent.length > 0 ? recent : tools.filter((t) => !t.current)), [recent, tools])
  return <CommandPalette items={items} emptyItems={emptyItems} emptyHeading={recent.length > 0 ? 'Recent' : 'All tools'}
    placeholder={ACTIONS.length > 0 ? 'Search tools and actions…' : 'Search tools…'} onClose={onClose} />
}
