// The Daily Briefing page: everything about today, in one quiet summary. Rule-based and fully
// offline — the deciding lives in src/shared/briefing.ts (tested in tests/briefing.ts); this
// file only fetches and shows. The feature can be switched off on the Intelligence page, which
// removes the page from the sidebar and the dashboard card from the home page.
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, CalendarCheck, CheckSquare, CandlestickChart, ChevronRight, PiggyBank, Plus, Sunrise, Zap } from 'lucide-react'
import type { DailyBriefing } from '../../../shared/types'
import { formatDate, today } from '../lib/dates'
import { fmtAmount } from '../lib/format'
import { errMsg } from '../lib/errors'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { moodStyle } from '../lib/moods'
import type { ModuleProps } from '../lib/navigation'
import { EntryEditor } from './EntryEditor'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { ProgressBar } from '../components/ProgressBar'
import { Pnl } from '../components/Pnl'

// How many items each section lists before "+N more" keeps the page one screen tall.
const MAX_ITEMS = 6

export function Briefing({ onNavigate, onOpen }: ModuleProps) {
  const [data, setData] = useState<DailyBriefing | null>(null)
  const [error, setError] = useState('')
  const [writing, setWriting] = useState(false)

  const load = useCallback(() => {
    window.api.briefing.build(today()).then(setData).catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(() => { load() }, [load])
  useRefreshOnCapture(load)

  return (
    <div className="page page-sm">
      <PageHeader title="Daily briefing" subtitle={data ? formatDate(data.today) + '. ' + data.summary : 'Your day at a glance.'}>
        <Sunrise size={20} className="text-accent" />
      </PageHeader>
      {error && <p role="alert" className="text-sm text-neg">{error}</p>}

      {data && (
        <div className="mt-5 flex flex-col gap-4" aria-live="polite">
          <AutomationsSection briefing={data} onNavigate={onNavigate} />
          {data.tasks && <TasksSection tasks={data.tasks} onNavigate={onNavigate} />}
          {data.habits && <HabitsSection briefing={data.habits} onNavigate={onNavigate} />}
          {data.savings && <SavingsSection briefing={data.savings} onNavigate={onNavigate} onOpen={onOpen} />}
          {data.trades && <TradesSection briefing={data.trades} onNavigate={onNavigate} onOpen={onOpen} />}
          <JournalSection briefing={data.journal} today={data.today} onNavigate={onNavigate} onOpen={onOpen} onWrite={() => setWriting(true)} />
        </div>
      )}

      {data && data.tasks === null && data.habits === null && data.savings === null && data.trades === null && data.journal === null && (
        <div className="mt-5">
          <EmptyState icon={Sunrise} title="Nothing on the books for today yet"
            text="Add a task, a habit or a savings goal and the briefing fills in on its own."
            action={<button className="btn-primary" onClick={() => onNavigate('tasks')}>Open tasks</button>} />
        </div>
      )}

      {writing && <EntryEditor entry={null} knownTags={[]} onClose={() => setWriting(false)}
        onSaved={() => { setWriting(false); load() }} />}
    </div>
  )
}

// A card with a heading and an "Open <tool>" link, like the dashboard's panels.
function Section({ title, icon, onOpen, openLabel, children }: {
  title: string; icon: React.ReactNode; onOpen: () => void; openLabel: string; children: React.ReactNode
}) {
  return (
    <section className="card card-pad">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{icon} {title}</h2>
        <button className="section-link" onClick={onOpen}>{openLabel} <ChevronRight size={12} /></button>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

// Automation output on the briefing: stale overdue tasks surfaced by the rule,
// plus the newest things the automations did (the transparency trail).
function AutomationsSection({ briefing, onNavigate }: { briefing: DailyBriefing; onNavigate: (to: string) => void }) {
  if (briefing.staleOverdueTasks.length === 0 && briefing.automations.length === 0) return null
  return (
    <section className="card card-pad" aria-label="From your automations">
      <h2 className="section-title"><Zap size={15} /> From your automations</h2>
      {briefing.staleOverdueTasks.length > 0 && (
        <div className="mt-2">
          <div className="text-sm">{briefing.staleOverdueTasks.length} task{briefing.staleOverdueTasks.length === 1 ? ' has' : 's have'} been overdue a while:</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {briefing.staleOverdueTasks.slice(0, 5).map((t) => (
              <li key={t.id} className="text-sm text-muted">"{t.title}" — {t.daysOverdue} days overdue</li>
            ))}
          </ul>
          <button className="section-link mt-1" onClick={() => onNavigate('tasks')}>Open tasks <ChevronRight size={12} /></button>
        </div>
      )}
      {briefing.automations.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {briefing.automations.map((a) => (
            <li key={a.id} className="text-sm">{a.label}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TasksSection({ tasks, onNavigate }: { tasks: NonNullable<DailyBriefing['tasks']>; onNavigate: (to: string) => void }) {
  const line = (t: { id: number; title: string; priority: string; dueDate?: string }) => (
    <li key={t.id}>
      <button className="row-link" onClick={() => onNavigate('tasks')}>
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`badge badge-${t.priority === 'high' ? 'neg' : 'muted'}`}>{t.priority}</span>
          <span className="truncate">{t.title}</span>
        </span>
        {'dueDate' in t && t.dueDate && <span className="meta shrink-0">{formatDate(t.dueDate)}</span>}
      </button>
    </li>
  )
  return (
    <Section title="Tasks" icon={<CheckSquare size={15} />} onOpen={() => onNavigate('tasks')} openLabel="Open tasks">
      {tasks.due.length > 0 && (
        <>
          <div className="meta font-medium">{tasks.due.length} due today</div>
          <ul className="mt-1.5 flex flex-col gap-0.5">{tasks.due.slice(0, MAX_ITEMS).map(line)}</ul>
          {tasks.due.length > MAX_ITEMS && <div className="meta mt-1">+ {tasks.due.length - MAX_ITEMS} more</div>}
        </>
      )}
      {tasks.overdue.length > 0 && (
        <>
          <div className="meta mt-3 font-medium text-neg">{tasks.overdue.length} overdue</div>
          <ul className="mt-1.5 flex flex-col gap-0.5">{tasks.overdue.slice(0, MAX_ITEMS).map(line)}</ul>
          {tasks.overdue.length > MAX_ITEMS && <div className="meta mt-1">+ {tasks.overdue.length - MAX_ITEMS} more</div>}
        </>
      )}
      {tasks.doneThisWeek.length > 0 && (
        <p className="meta mt-3">{tasks.doneThisWeek.length} done this week already. Keep the streak going.</p>
      )}
    </Section>
  )
}

function HabitsSection({ briefing, onNavigate }: { briefing: NonNullable<DailyBriefing['habits']>; onNavigate: (to: string) => void }) {
  return (
    <Section title="Habits today" icon={<CalendarCheck size={15} />} onOpen={() => onNavigate('habits')} openLabel="Open habits">
      <p className="meta">{briefing.label}</p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {briefing.items.slice(0, MAX_ITEMS).map((h) => (
          <li key={h.id}>
            <button className="row-link" onClick={() => onNavigate('habits')}
              aria-label={`${h.name}, ${h.done ? 'done' : 'still to do'}, current streak ${h.current} ${h.current === 1 ? 'day' : 'days'}`}>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${h.done ? 'bg-accent' : 'bg-muted'}`} aria-hidden="true" />
                <span className="truncate">{h.name}</span>
                <span className="meta shrink-0">{h.schedule}</span>
              </span>
              <span className="meta num shrink-0">
                {h.current > 0 && <span title="Current streak">{h.current}-day</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {briefing.items.length > MAX_ITEMS && <div className="meta mt-1">+ {briefing.items.length - MAX_ITEMS} more</div>}
    </Section>
  )
}

function SavingsSection({ briefing, onNavigate, onOpen }: {
  briefing: NonNullable<DailyBriefing['savings']>
  onNavigate: (to: string) => void
  onOpen: ModuleProps['onOpen']
}) {
  return (
    <Section title="Savings" icon={<PiggyBank size={15} />} onOpen={() => onNavigate('savings')} openLabel="Open savings">
      <div className="flex items-baseline justify-between gap-3">
        <div className="stat-value mt-0">{fmtAmount(briefing.totalBalance)}</div>
        <div className="meta text-right">
          across {briefing.goals.length} {briefing.goals.length === 1 ? 'goal' : 'goals'}
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {briefing.goals.slice(0, MAX_ITEMS).map((g) => (
          <li key={g.goalId}>
            <button className="row-link" onClick={() => onOpen({ module: 'savings', goalId: g.goalId })}>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{g.name}</span>
                  <span className="shrink-0 text-sm">{fmtAmount(g.balance)}</span>
                </div>
                {g.percent !== null && <div className="mt-1.5"><ProgressBar percent={g.percent} /></div>}
                <div className="meta mt-1 flex justify-between">
                  <span>{g.percent === null ? 'No target' : g.percent >= 100 ? 'Goal reached' : `${g.percent}%`}</span>
                  {g.target !== null && <span>Target {fmtAmount(g.target)}</span>}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {briefing.goals.length > MAX_ITEMS && <div className="meta mt-1">+ {briefing.goals.length - MAX_ITEMS} more</div>}
      {briefing.lastDeposit && (
        <p className="meta mt-2">Last deposit {fmtAmount(briefing.lastDeposit.amount)} to {briefing.lastDeposit.goalName} on {formatDate(briefing.lastDeposit.date)}.</p>
      )}
    </Section>
  )
}

function TradesSection({ briefing, onNavigate, onOpen }: {
  briefing: NonNullable<DailyBriefing['trades']>
  onNavigate: (to: string) => void
  onOpen: ModuleProps['onOpen']
}) {
  return (
    <Section title="Trading" icon={<CandlestickChart size={15} />} onOpen={() => onNavigate('trades')} openLabel="Open trades">
      {briefing.open.length > 0 ? (
        <>
          <div className="meta font-medium">{briefing.open.length} open</div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {briefing.open.slice(0, MAX_ITEMS).map((t) => (
              <li key={t.id}>
                <button className="row-link" onClick={() => onOpen({ module: 'trades', trade: t })}>
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate font-medium">{t.asset}</span>
                    <span className={`badge capitalize ${t.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>{t.direction}</span>
                    <span className="meta shrink-0">{formatDate(t.date)}</span>
                  </span>
                  <span className="badge badge-open shrink-0">Open</span>
                </button>
              </li>
            ))}
          </ul>
          {briefing.open.length > MAX_ITEMS && <div className="meta mt-1">+ {briefing.open.length - MAX_ITEMS} more</div>}
        </>
      ) : briefing.yesterdayResult && (
        <div>
          <div className="stat-value mt-0">
            <Pnl value={briefing.yesterdayResult.pnl} />
          </div>
          <p className="meta mt-1">
            {briefing.yesterdayResult.count} {briefing.yesterdayResult.count === 1 ? 'trade' : 'trades'} closed yesterday.
          </p>
        </div>
      )}
    </Section>
  )
}

function JournalSection({ briefing, today: _today, onNavigate, onOpen, onWrite }: {
  briefing: DailyBriefing['journal']
  today: string
  onNavigate: (to: string) => void
  onOpen: ModuleProps['onOpen']
  onWrite: () => void
}) {
  // Always shown: even with nothing written it offers the "write today's entry" button.
  if (!briefing) {
    return (
      <Section title="Journal" icon={<BookOpen size={15} />} onOpen={() => onNavigate('logbook')} openLabel="Open logbook">
        <EmptyState compact title="Nothing written yet" text="One line about today is a good start."
          action={<button className="btn-primary" onClick={onWrite}><Plus size={14} /> Write today's entry</button>} />
      </Section>
    )
  }
  return (
    <Section title="Journal" icon={<BookOpen size={15} />} onOpen={() => onNavigate('logbook')} openLabel="Open logbook">
      {briefing.yesterdayMood && (
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${moodStyle(briefing.yesterdayMood.mood).dot}`} aria-hidden="true" />
          <span>Yesterday was <strong>{moodStyle(briefing.yesterdayMood.mood).label}</strong>.</span>
        </div>
      )}
      {briefing.lastEntry && (
        <button className="row-link mt-2" onClick={() => onNavigate('logbook')}>
          <span className="truncate text-sm font-medium">{briefing.lastEntry.title}</span>
          <span className="meta shrink-0">{formatDate(briefing.lastEntry.date)}</span>
        </button>
      )}
      <button className="btn-primary mt-3" onClick={onWrite}><Plus size={14} /> Write today's entry</button>
    </Section>
  )
}
