// The dashboard's four stat tiles (Phase 6): total saved, trading P&L, trades
// logged and the logbook streak. Each one is a widget in its own right, so the
// customizer can arrange or drop them individually; they share ONE loader, so
// four tiles on the board still make one call to the dashboard summary.
//
// The numbers are the main process's (window.api.dashboard.summary), which
// already excludes trashed rows. Nothing is computed here.
import { BookOpen, CandlestickChart, PiggyBank } from 'lucide-react'
import type { DashboardData } from '../../../shared/types'
import { fmtAmount, fmtPnl, pnlColor } from '../lib/format'
import { WidgetBody } from '../components/WidgetBody'
import { loadSummary } from '../lib/dashboardSummary'
import type { WidgetProps } from '../widgets'

// The tile: label, big number, one quiet line under it. A button when the tile
// opens a page, a plain box while editing (so a click cannot navigate away).
function Tile({ label, value, sub, tone, icon: Icon, onOpen, editMode }: {
  label: string; value: string; sub: string; tone?: string
  icon: typeof PiggyBank; onOpen: () => void; editMode: boolean
}) {
  const body = (
    <>
      <span className="stat-label flex items-center gap-1.5"><Icon size={13} aria-hidden="true" className="text-muted" />{label}</span>
      <span className={`stat-value ${tone ?? ''}`}>{value}</span>
      <span className="stat-sub">{sub}</span>
    </>
  )
  const className = 'stat card card-pad-sm flex h-full flex-col text-left'
  if (editMode) return <div className={className}>{body}</div>
  return (
    <button className={`${className} card-interactive`} onClick={onOpen} aria-label={`${label}: ${value}. ${sub}`}>
      {body}
    </button>
  )
}

const tile = (label: string, data: DashboardData, onNavigate: WidgetProps['onNavigate'], editMode: boolean) => {
  switch (label) {
    case 'saved':
      return <Tile editMode={editMode} icon={PiggyBank} label="Total saved" value={fmtAmount(data.totalSaved)}
        sub={data.goals.length === 0 ? 'No goals yet' : `across ${data.goals.length} ${data.goals.length === 1 ? 'goal' : 'goals'}`}
        onOpen={() => onNavigate('savings')} />
    case 'trades-pnl': {
      const ts = data.tradeStats
      return <Tile editMode={editMode} icon={CandlestickChart} label="Trading P&L" value={ts.closed === 0 ? '-' : fmtPnl(ts.totalPnl)}
        tone={ts.closed === 0 ? '' : pnlColor(ts.totalPnl)}
        sub={ts.closed === 0 ? 'No closed trades yet' : `${ts.winRate === null ? '-' : Math.round(ts.winRate)}% win rate`}
        onOpen={() => onNavigate('trades')} />
    }
    case 'trades-count': {
      const ts = data.tradeStats
      return <Tile editMode={editMode} icon={CandlestickChart} label="Trades logged" value={String(ts.total)}
        sub={`${ts.closed} closed, ${ts.open} open`} onOpen={() => onNavigate('trades')} />
    }
    default: {
      const log = data.log
      return <Tile editMode={editMode} icon={BookOpen} label="Logbook streak" value={`${log.streak} ${log.streak === 1 ? 'day' : 'days'}`}
        sub={log.total === 0 ? 'Write your first entry'
          : log.streak === 0 ? 'Write today to start one'
            : `${log.thisMonth} ${log.thisMonth === 1 ? 'entry' : 'entries'} this month`}
        onOpen={() => onNavigate('logbook')} />
    }
  }
}

const makeTile = (which: 'saved' | 'trades-pnl' | 'trades-count' | 'log-streak') => {
  const Widget = (props: WidgetProps) => (
    <WidgetBody load={loadSummary}>
      {(data) => tile(which, data, props.onNavigate, props.editMode)}
    </WidgetBody>
  )
  Widget.displayName = `DashboardTile(${which})`
  return Widget
}

export const SavedWidget = makeTile('saved')
export const TradesPnlWidget = makeTile('trades-pnl')
export const TradesCountWidget = makeTile('trades-count')
export const LogStreakWidget = makeTile('log-streak')
