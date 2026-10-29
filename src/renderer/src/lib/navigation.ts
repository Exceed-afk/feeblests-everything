// How one tool asks the app to open an item in another tool
// (for example: a search result that should open a logbook entry).
import type { LogEntry, Trade } from '../../../shared/types'

export type OpenTarget =
  | { module: 'logbook'; entry: LogEntry }
  | { module: 'trades'; trade: Trade }
  | { module: 'savings'; goalId: number }

// Props every tool page receives. Most pages ignore them; pages that can be
// "jumped to" read `target`, open that item, then call onTargetHandled().
export interface ModuleProps {
  target: OpenTarget | null
  onTargetHandled: () => void
  onOpen: (target: OpenTarget) => void
  onNavigate: (where: string) => void // go to a tool's page by id or route (e.g. "View all"): "trades" or "/trades"
}
