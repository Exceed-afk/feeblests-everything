// THE list of palette actions: things Ctrl+K can DO, as opposed to the tools it can open (those come from tools.ts).
// It starts empty. The palette shows whatever is here, ranked and highlighted the same way as tools, so adding
// an action never means touching the palette.
//
// To add an action: add ONE entry to ACTIONS below. Example:
//
//   { id: 'toggle-theme', title: 'Switch theme', icon: Moon, keywords: ['dark', 'light', 'mode', 'appearance'],
//     run: () => toggleTheme() },
//
//   id        lowercase letters, digits and dashes, unique among actions
//   title     the row's text
//   keywords  optional, lowercase: extra words that should find it
//   icon      optional lucide icon
//   run       called when the user presses Enter on it; the palette closes right after.
//             It receives { navigate, open } for actions that go somewhere (see ActionContext).
import type { LucideIcon } from 'lucide-react'
import { PenLine } from 'lucide-react'
import { validateActions, type ActionMeta } from '../../shared/palette'
import type { OpenTarget } from './lib/navigation'

// What an action's `run` can use. Both are the same functions the pages receive as onNavigate / onOpen.
export interface ActionContext {
  navigate: (where: string) => void // a tool by id or route: navigate('trades')
  open: (target: OpenTarget) => void // an item inside a tool (see lib/navigation.ts)
}

export interface ActionDef extends ActionMeta {
  icon?: LucideIcon
  run: (ctx: ActionContext) => void
}

export const ACTIONS: ActionDef[] = [
  { id: 'quick-capture', title: 'Quick capture', icon: PenLine, keywords: ['note', 'log', 'add', 'trade', 'deposit', 'habit', 'check in', 'window'],
    run: () => { window.api.capture.open() } }
]

// A mistake in an entry stops the app at start-up with a readable message (see shared/palette.ts for the rules).
const problems = validateActions(ACTIONS)
if (problems.length > 0) throw new Error(`actions.ts has a mistake:\n- ${problems.join('\n- ')}`)
