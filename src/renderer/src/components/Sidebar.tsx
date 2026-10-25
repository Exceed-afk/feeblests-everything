import { MODULES } from '../modules'

export function Sidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-line bg-panel p-3">
      <div className="px-3 pb-4 pt-2 text-[15px] font-semibold tracking-tight">Feeblest's Everything</div>
      {MODULES.map((m, i) => {
        const on = m.id === active
        return (
          <button key={m.id} onClick={() => onSelect(m.id)} title={`Ctrl+${i + 1}`}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
              on ? 'bg-accent/15 font-medium text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
            <m.icon size={18} />
            {m.label}
          </button>
        )
      })}
    </nav>
  )
}
