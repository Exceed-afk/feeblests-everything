// How one module asks the app to open an item in another module
// (for example: a search result that should open a logbook entry).
import type { LogEntry, Trade } from '../../../shared/types'

export type OpenTarget =
  | { module: 'logbook'; entry: LogEntry }
  | { module: 'trades'; trade: Trade }
  | { module: 'savings'; goalId: number }

// Props every module page receives. Most pages ignore them; pages that can be
// "jumped to" read `target`, open that item, then call onTargetHandled().
export interface ModuleProps {
  target: OpenTarget | null
  onTargetHandled: () => void
  onOpen: (target: OpenTarget) => void
  onNavigate: (moduleId: string) => void // go to a module's page (e.g. "View all")
}
