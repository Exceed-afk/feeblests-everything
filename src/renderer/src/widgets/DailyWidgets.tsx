// The dashboard's Daily widgets (Phase 6): habits today, tasks, focus time,
// the next content to publish, pinned notes, recent journal entries and the
// doors (briefing, review, insights).
//
// Each one reads the module's own API, so the numbers on the Dashboard and on
// the module's page are the same numbers, including the trashed-row rules.
import { BookOpen, CalendarCheck, Check, CheckSquare, ChevronRight, Circle, Clapperboard, Flame, Lightbulb, StickyNote, Timer, ClipboardCheck, Wrench } from 'lucide-react'
import type { DashboardData, HabitsToday, LogEntry } from '../../../shared/types'
import type { NoteDTO as Note } from '../../../shared/notesBridge'
import type { ContentItemDTO as ContentItem } from '../../../shared/notesBridge'
import type { FocusDashboardSummary } from '../../../shared/focus'
import { DEFAULT_INTELLIGENCE } from '../../../shared/types'
import { formatDuration } from '../../../shared/focus'
import { getCurrentSettings } from '../lib/settingsStore'
import { moodStyle } from '../lib/moods'
import { formatDate, today } from '../lib/dates'
import { loadSummary } from '../lib/dashboardSummary'
import { WidgetBody } from '../components/WidgetBody'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import type { WidgetProps } from '../widgets'

const MAX_HABITS = 6
const MAX_NOTES = 4
const MAX_ENTRIES = 4
const MAX_CONTENT = 3

function Head({ icon: Icon, title, action, editMode }: { icon: typeof Timer; title: string; action: () => void; editMode: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="section-title"><Icon size={15} /> {title}</h2>
      {!editMode && <button className="section-link" onClick={action}>Open <ChevronRight size={12} /></button>}
    </div>
  )
}

// ---------- Habits today ----------

export function HabitsWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={loadSummary}>
      {({ habits }) => <HabitsTile habits={habits} editMode={editMode} onOpenHabits={() => onNavigate('habits')} />}
    </WidgetBody>
  )
}

function HabitsTile({ habits, editMode, onOpenHabits }: { habits: HabitsToday; editMode: boolean; onOpenHabits: () => void }) {
  const shown = habits.items.slice(0, MAX_HABITS)
  const more = habits.items.length - shown.length
  const allDone = habits.due > 0 && habits.done === habits.due
  const head = <Head icon={CalendarCheck} title="Habits today" action={onOpenHabits} editMode={editMode} />

  if (habits.total === 0) {
    return (
      <section className="card card-pad h-full">
        {head}
        <div className="mt-3">
          <EmptyState compact title="No habits yet" text="Add one you can do even on a bad day."
            action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={onOpenHabits}>Add a habit</button>} />
        </div>
      </section>
    )
  }

  return (
    <section className="card card-pad h-full">
      {head}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="stat-value mt-0">{habits.done}<span className="text-muted"> / {habits.due}</span></div>
          <div className="stat-sub">{habits.due === 0 ? 'Nothing scheduled today' : allDone ? 'All done. Nicely done.' : 'due today'}</div>
        </div>
        <div className="meta flex items-center gap-1" title="Longest current streak among your habits">
          <Flame size={14} className={habits.longestStreak > 0 ? 'warn' : ''} />
          <span className="num font-medium text-fg">{habits.longestStreak}-day</span> best streak
        </div>
      </div>
      {habits.due > 0 && <div className="mt-3"><ProgressBar percent={(habits.done / habits.due) * 100} /></div>}
      {shown.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5">
          {shown.map((h) => (
            <li key={h.id} className="row-link" aria-label={`${h.name}: ${h.done ? 'done' : 'not done yet'}`}>
              <span className="flex min-w-0 items-center gap-2.5">
                {h.done
                  ? <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-on-accent"><Check size={11} strokeWidth={3} /></span>
                  : <Circle size={16} className="shrink-0 text-muted" />}
                <span className={`truncate text-sm ${h.done ? 'text-muted line-through decoration-muted/50' : ''}`}>{h.name}</span>
              </span>
              {h.streak > 0 && <span className="meta num flex shrink-0 items-center gap-0.5"><Flame size={12} className="warn" />{h.streak}</span>}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <div className="meta mt-1">+ {more} more</div>}
      {habits.topStreaks.length > 0 && (
        <div className="meta mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2" aria-label={`Top streaks: ${habits.topStreaks.map((s) => `${s.name}, ${s.current} days`).join('; ')}`}>
          <span className="flex shrink-0 items-center gap-1"><Flame size={12} className="warn" /> Top streaks</span>
          {habits.topStreaks.map((s) => (
            <span key={s.id} className="num">{s.name} <span className="font-medium text-fg">{s.current}</span></span>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- Tasks ----------

// The two next things worth doing, straight from the task list (overdue first,
// then due today), so the tile is useful rather than only a count.
interface TaskData { data: DashboardData['tasks']; next: { id: number; title: string; dueDate: string | null }[] }

export function TasksWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={async (): Promise<TaskData> => {
      const day = today()
      const [summary, tasks] = await Promise.all([
        loadSummary(),
        window.api.tasks.list({ view: 'upcoming' })
      ])
      const next = tasks.filter((t) => t.dueDate !== null && t.dueDate <= day && t.status !== 'done')
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id - b.id)
        .slice(0, 3).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate }))
      return { data: summary.tasks, next }
    }}>
      {({ data, next }) => (
        <section className={`card card-pad h-full ${editMode ? '' : 'card-interactive'}`}>
          <Head icon={CheckSquare} title="Tasks" action={() => onNavigate('tasks')} editMode={editMode} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div><div className="stat-value mt-0 text-sm"><span className="num">{data.dueToday}</span></div><div className="stat-sub">due today</div></div>
            <div><div className="stat-value mt-0 text-sm"><span className={`num ${data.overdue > 0 ? 'text-neg' : ''}`}>{data.overdue}</span></div><div className="stat-sub">overdue</div></div>
            <div><div className="stat-value mt-0 text-sm"><span className="num">{data.completedThisWeek}</span></div><div className="stat-sub">done this week</div></div>
          </div>
          {next.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5">
              {next.map((t) => (
                editMode
                  ? <li key={t.id} className="row-link"><span className="truncate text-sm">{t.title}</span></li>
                  : <li key={t.id}><button className="row-link" onClick={() => onNavigate('tasks')} aria-label={`${t.title}, due ${formatDate(t.dueDate ?? today())}`}>
                    <span className="truncate text-sm">{t.title}</span>
                    <span className={`meta shrink-0 ${t.dueDate && t.dueDate < today() ? 'text-neg' : ''}`}>{t.dueDate === today() ? 'Today' : formatDate(t.dueDate ?? '')}</span>
                  </button></li>
              ))}
            </ul>
          ) : (
            <p className="meta mt-2">Nothing due. A quiet day.</p>
          )}
        </section>
      )}
    </WidgetBody>
  )
}

// ---------- Focus today ----------

export function FocusWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={(): Promise<FocusDashboardSummary> => window.api.focus.summary(today())}>
      {(s) => (
        <section className={`card card-pad h-full ${editMode ? '' : 'card-interactive'}`}>
          <Head icon={Timer} title="Focus today" action={() => onNavigate('focus')} editMode={editMode} />
          <div className="mt-3">
            <div className="stat-value mt-0">{formatDuration(s.todayFocusSeconds)}</div>
            <div className="stat-sub">
              {s.completedRoundsToday} {s.completedRoundsToday === 1 ? 'round' : 'rounds'} finished
              {s.activeSession ? ' · a session is running' : ''}
            </div>
          </div>
          {!editMode && (
            <button className="btn btn-sm mt-3" onClick={() => onNavigate('focus')}>
              {s.activeSession ? 'Open the timer' : 'Start focusing'}
            </button>
          )}
        </section>
      )}
    </WidgetBody>
  )
}

// ---------- Next to publish ----------

export function ContentWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={(): Promise<ContentItem[]> => window.api.content.list()}>
      {(items) => {
        const upcoming = items.filter((i) => i.stage !== 'published')
          .sort((a, b) => (a.targetPublishDate ?? '9999-12-31').localeCompare(b.targetPublishDate ?? '9999-12-31') || a.position - b.position)
          .slice(0, MAX_CONTENT)
        return (
          <section className="card card-pad h-full">
            <Head icon={Clapperboard} title="Next to publish" action={() => onNavigate('content')} editMode={editMode} />
            {upcoming.length === 0 ? (
              <div className="mt-3">
                <EmptyState compact title={items.length === 0 ? 'No content items yet' : 'Everything is published'} text="Capture an idea and it starts at the top of the pipeline."
                  action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('content')}>Open content</button>} />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-0.5">
                {upcoming.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-1">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{i.title || 'Untitled'}</span>
                      <span className="meta capitalize">{i.stage}{i.platform ? ` · ${i.platform}` : ''}</span>
                    </span>
                    <span className="meta shrink-0">{i.targetPublishDate ? formatDate(i.targetPublishDate) : 'No date'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      }}
    </WidgetBody>
  )
}

// ---------- Pinned notes ----------

export function PinnedNotesWidget({ editMode, onNavigate }: WidgetProps) {
  return (
    <WidgetBody load={(): Promise<Note[]> => window.api.notes.list()}>
      {(notes) => {
        const pinned = notes.filter((n) => n.pinned).slice(0, MAX_NOTES)
        return (
          <section className="card card-pad h-full">
            <Head icon={StickyNote} title="Pinned notes" action={() => onNavigate('notes')} editMode={editMode} />
            {pinned.length === 0 ? (
              <div className="mt-3">
                <EmptyState compact title="Nothing pinned" text="Pin a note and it stays within reach on this dashboard."
                  action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('notes')}>Open notes</button>} />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-0.5">
                {pinned.map((n) => (
                  <li key={n.id} className="row-link">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{n.title || 'Untitled'}</span>
                      <span className="meta block truncate">{n.body.replace(/[#*`>\[\]]/g, '').slice(0, 90) || 'Empty note'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      }}
    </WidgetBody>
  )
}

// ---------- Recent journal entries ----------

export function RecentLogWidget({ editMode, onNavigate, onOpen }: WidgetProps) {
  return (
    <WidgetBody load={loadSummary}>
      {({ recentEntries }) => (
        <section className="card card-pad h-full">
          <Head icon={BookOpen} title="Recent log entries" action={() => onNavigate('logbook')} editMode={editMode} />
          {recentEntries.length === 0 ? (
            <div className="mt-3">
              <EmptyState compact title="Nothing written yet" text="One line about today is a good start."
                action={editMode ? undefined : <button className="btn-primary btn-sm" onClick={() => onNavigate('logbook')}>Write an entry</button>} />
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-0.5">
              {recentEntries.slice(0, MAX_ENTRIES).map((e: LogEntry) => (
                <Row key={e.id} editMode={editMode} onClick={() => onOpen({ module: 'logbook', entry: e })} label={`${e.title}, ${formatDate(e.date)}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{e.title}</span>
                    <span className="meta mt-0.5 flex items-center gap-2">
                      {e.mood && <span title={moodStyle(e.mood).label} className={`h-2 w-2 rounded-full ${moodStyle(e.mood).dot}`} />}
                      {formatDate(e.date)}
                      {e.mood && <span>{moodStyle(e.mood).label}</span>}
                    </span>
                  </span>
                </Row>
              ))}
            </div>
          )}
        </section>
      )}
    </WidgetBody>
  )
}

function Row({ onClick, editMode, children, label }: { onClick: () => void; editMode: boolean; children: React.ReactNode; label: string }) {
  if (editMode) return <div className="row-link">{children}</div>
  return <button className="row-link" onClick={onClick} aria-label={label}>{children}</button>
}

// ---------- Doors ----------
// The briefing and the review are destinations, not numbers. They stay as one
// widget so a minimal layout can drop them without losing anything.

export function DoorsWidget({ onNavigate, editMode }: WidgetProps) {
  const features = getCurrentSettings().intelligence?.features ?? DEFAULT_INTELLIGENCE.features
  const doors: { id: string; title: string; text: string; to: string; icon: typeof Lightbulb }[] = []
  if (features.dailyBriefing) doors.push({ id: 'briefing', title: 'Your daily briefing', text: 'Tasks due, habits left, savings, trades and your journal, for today.', to: 'briefing', icon: ClipboardCheck })
  if (features.insights) doors.push({ id: 'insights', title: 'See patterns', text: 'Habit days vs savings and trades, mood vs tasks, weekday breakdowns.', to: 'insights', icon: Lightbulb })
  doors.push({ id: 'review', title: 'Review your week', text: 'Trades, savings, habits and mood in one summary.', to: 'review', icon: ClipboardCheck })

  return (
    <section className="card card-pad h-full">
      <Head icon={ClipboardCheck} title="Daily doors" action={() => onNavigate('review')} editMode={editMode} />
      <ul className="mt-3 flex flex-col gap-0.5">
        {doors.map((d) => {
          const Icon = d.icon
          const body = (
            <>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-fg"><Icon size={16} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{d.title}</span>
                <span className="meta block truncate">{d.text}</span>
              </span>
            </>
          )
          return (
            <li key={d.id}>
              {editMode
                ? <div className="row-link">{body}</div>
                : <button className="row-link" onClick={() => onNavigate(d.to)} aria-label={`${d.title}. ${d.text}`}>{body}</button>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}



// ---------- Pinned tools ----------

export function PinnedToolsWidget({ editMode, onNavigate }: WidgetProps) {
  const tools = [
    { id: 'loan', label: 'Loan calculator', desc: 'Monthly payment & amortisation' },
    { id: 'stopwatch', label: 'Stopwatch', desc: 'Laps, splits & focus logging' },
    { id: 'scratchpad', label: 'Scratchpad', desc: 'Autosaving quick text pads' },
    { id: 'snippets', label: 'Snippets', desc: 'Copyable reusable text blocks' }
  ]

  return (
    <section className="card card-pad h-full">
      <Head icon={Wrench as never} title="Pinned tools" action={() => onNavigate('tools')} editMode={editMode} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {tools.map((t) => (
          <button
            key={t.id}
            disabled={editMode}
            onClick={() => onNavigate('tools')}
            className="flex flex-col gap-0.5 rounded-lg border border-line p-2 text-left hover:bg-fg/5 transition-colors disabled:opacity-75"
          >
            <span className="text-xs font-semibold text-fg">{t.label}</span>
            <span className="text-[11px] text-muted line-clamp-1">{t.desc}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
