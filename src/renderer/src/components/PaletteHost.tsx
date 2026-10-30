// Feeds the palette: the tools (tools.ts), the actions (actions.ts) and the recent tools (saved in the settings).
// Rendered only while the palette is open, so the rest of the app never re-renders because of it.
// Quick add (step 4): when the Intelligence page's smartQuickAdd toggle is on, the palette also
// understands sentences like "task call dentist friday" and shows an editable preview before saving.
import { useMemo } from 'react'
import { CommandPalette } from './CommandPalette'
import { TOOLS, type ToolDef } from '../tools'
import { ACTIONS } from '../actions'
import { actionItems, recentToolItems, toolItems } from '../lib/paletteItems'
import { useSettings } from '../lib/settingsStore'
import { DEFAULT_INTELLIGENCE } from '../../../shared/types'
import type { OpenTarget } from '../lib/navigation'

export function PaletteHost({ active, navigate, open, onClose, tools: visibleTools = TOOLS }: {
  active: string // id of the tool on screen
  navigate: (where: string) => void
  open: (target: OpenTarget) => void
  onClose: () => void
  tools?: ToolDef[]
}) {
  const s = useSettings()
  const { recentTools } = useSettings()
  const tools = useMemo(() => toolItems(visibleTools, active, navigate), [visibleTools, active, navigate])
  const items = useMemo(() => [...tools, ...actionItems(ACTIONS, { navigate, open })], [tools, navigate, open])
  const recent = useMemo(() => recentToolItems(tools, recentTools, active), [tools, recentTools, active])

  // Nothing opened yet: list every tool rather than an empty box.
  const emptyItems = useMemo(() => (recent.length > 0 ? recent : tools.filter((t) => !t.current)), [recent, tools])

  // Quick add only when the feature is on; goals/habits are fetched lazily on confirm.
  const quickAddOn = s.intelligence?.features.smartQuickAdd ?? DEFAULT_INTELLIGENCE.features.smartQuickAdd
  const quickAdd = quickAddOn
    ? {
      goals: async () => {
        const [goals, habits] = await Promise.all([window.api.savings.listGoals(), window.api.habits.list()])
        return { goals, habits: habits.habits }
      }
    }
    : null

  return <CommandPalette items={items} emptyItems={emptyItems} emptyHeading={recent.length > 0 ? 'Recent' : 'All tools'}
    placeholder={ACTIONS.length > 0 ? 'Search tools and actions…' : 'Search tools…'} onClose={onClose}
    quickAdd={quickAdd} />
}
