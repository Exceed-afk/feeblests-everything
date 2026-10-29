import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRefreshOnCapture } from '../lib/dataChanged'
import { PiggyBank, Plus } from 'lucide-react'
import type { SavingsGoal } from '../../../shared/types'
import { progressPercent } from '../../../shared/savings'
import { round8 } from '../../../shared/math'
import { fmtAmount } from '../lib/format'
import { ProgressBar } from '../components/ProgressBar'
import { GoalDetail } from './GoalDetail'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import type { ModuleProps } from '../lib/navigation'
import { GoalEditor } from './GoalEditor'

export function Savings({ target, onTargetHandled }: ModuleProps) {
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editor, setEditor] = useState<SavingsGoal | 'new' | null>(null)

  const refresh = useCallback(async () => {
    setGoals(await window.api.savings.listGoals())
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useRefreshOnCapture(refresh) // something was saved from the Quick capture window

  // Opened from Search: show that goal's detail panel straight away.
  useEffect(() => {
    if (target?.module === 'savings') { setDetailId(target.goalId); onTargetHandled() }
  }, [target, onTargetHandled])

  // Ctrl+N starts a new goal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor('new') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = useMemo(() => round8(goals.reduce((sum, g) => sum + g.balance, 0)), [goals])
  const detail = goals.find((g) => g.id === detailId) ?? null

  return (
    <div className="page">
      <PageHeader title="Savings" subtitle={goals.length > 0 ? `${fmtAmount(total)} saved across ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}` : 'Goals and plain accounts, one balance each.'}>
        <button className="btn-primary" onClick={() => setEditor('new')} title="Ctrl+N">
          <Plus size={16} /> New goal
        </button>
      </PageHeader>

      {loaded && goals.length === 0 && (
        <EmptyState icon={PiggyBank} title="Every big balance starts with one goal."
          text="Name what you are saving for, set a target if you have one, then add your first deposit."
          action={<button className="btn-primary" onClick={() => setEditor('new')}><Plus size={16} /> Create your first goal</button>} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((g) => {
          const pct = progressPercent(g.balance, g.target)
          return (
            <article key={g.id} onClick={() => setDetailId(g.id)} tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setDetailId(g.id)}
              className="card card-pad card-interactive flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="truncate font-semibold">{g.name}</h2>
                {pct !== null && pct >= 100 && <span className="badge badge-pos shrink-0">Reached</span>}
              </div>
              <div className="stat-value">{fmtAmount(g.balance)}</div>
              {g.target !== null && pct !== null ? (
                <div className="mt-auto pt-4">
                  <ProgressBar percent={pct} />
                  <div className="meta mt-2 flex justify-between">
                    <span className="num font-medium text-fg">{Math.floor(pct)}%</span>
                    <span>of {fmtAmount(g.target)}</span>
                  </div>
                </div>
              ) : (
                <div className="meta mt-auto pt-4">No target set</div>
              )}
            </article>
          )
        })}
      </div>

      {detail && (
        <GoalDetail key={`detail-${detail.id}`} goal={detail} blocked={editor !== null}
          onChanged={refresh} onEditGoal={() => setEditor(detail)} onClose={() => setDetailId(null)} />
      )}
      {editor && (
        <GoalEditor key={editor === 'new' ? 'editor-new' : `editor-${editor.id}`} goal={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); refresh() }} />
      )}
    </div>
  )
}
