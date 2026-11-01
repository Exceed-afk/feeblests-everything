// A DESIGN PREVIEW of the Review page, for checking the look in an ordinary browser (npm run preview).
// It is never part of the app: electron-vite builds only main.tsx into the real window. Every figure here is made up
// so the cards and charts can be seen with data, and the data shape is the real ReviewData, so what renders is what
// the app renders. Nothing is saved anywhere.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ReviewBody } from './modules/Review'
import type { ReviewData } from '../../shared/types'
import './styles.css'

// A fixed week with a little of everything: profits and losses, a goal, habits and moods.
const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const pnl = [182.5, -64.2, 240.15, 0, -128.4, 35.75, 0]
const closed = [3, 2, 4, 0, 2, 1, 0]
const trade = (id: number, asset: string, direction: 'long' | 'short', date: string, p: number) => ({
  id, date, asset, direction, entryPrice: 1, exitPrice: 1, quantity: 1, fees: 0, notes: '', tags: [], pnl: p, createdAt: '', updatedAt: ''
})
const data: ReviewData = {
  kind: 'week', start: days[0], end: days[6], today: '2026-10-31', complete: false,
  prevStart: '2026-10-19', prevEnd: '2026-10-25', label: '26 Oct to 1 Nov 2026', title: 'Weekly review 2026-10-26 to 2026-11-01',
  trades: {
    stats: { total: 12, open: 1, closed: 12, wins: 8, losses: 4, winRate: (8 / 12) * 100, totalPnl: 265.8, totalFees: 41.2, avgWin: null, avgLoss: null, profitFactor: null, best: null, worst: null },
    days: days.map((date, i) => ({ date, pnl: pnl[i], closed: closed[i] })),
    best: trade(1, 'XAUUSD', 'long', '2026-10-28', 240.15),
    worst: trade(2, 'EURUSD', 'short', '2026-10-30', -128.4),
    previous: { closed: 9, totalPnl: 210.1 }
  },
  savings: {
    deposits: 300, withdrawals: 120, net: 180, txCount: 4, startBalance: 3800, endBalance: 3980, previousNet: 150,
    goals: [
      { goalId: 1, name: 'Emergency fund', deposits: 250, withdrawals: 0, net: 250, startBalance: 5250, endBalance: 5500, target: 7000, reached: false },
      { goalId: 2, name: 'Japan trip', deposits: 50, withdrawals: 120, net: -70, startBalance: 1450, endBalance: 1380, target: 2000, reached: false }
    ],
    recent: [
      { id: 4, goalId: 1, goalName: 'Emergency fund', date: '2026-10-30', kind: 'deposit' as const, amount: 150, note: 'Payday' },
      { id: 3, goalId: 2, goalName: 'Japan trip', date: '2026-10-29', kind: 'withdrawal' as const, amount: 120, note: 'Flights' },
      { id: 2, goalId: 1, goalName: 'Emergency fund', date: '2026-10-27', kind: 'deposit' as const, amount: 100, note: '' },
      { id: 1, goalId: 2, goalName: 'Japan trip', date: '2026-10-26', kind: 'deposit' as const, amount: 50, note: '' }
    ]
  },
  habits: {
    due: 18, done: 13, rate: (13 / 18) * 100, bonus: 1, previousRate: 61, trackedFrom: days[0],
    habits: [
      { id: 1, name: 'Read 20 pages', due: 7, done: 5, rate: (5 / 7) * 100, bonus: 0, streak: 2, missed: ['2026-10-27', '2026-10-30'], days: [0, 1, 2, 3, 4, 5, 6], startDate: '2026-09-01' },
      { id: 2, name: 'Train', due: 4, done: 3, rate: 75, bonus: 1, streak: 3, missed: ['2026-10-29'], days: [0, 2, 4, 6], startDate: '2026-10-01' },
      { id: 3, name: 'No phone before 9', due: 4, done: 3, rate: 75, bonus: 0, streak: 0, missed: ['2026-10-26'], days: [0, 1, 2, 3, 4], startDate: '2026-10-28' }
    ],
    days: days.map((date, i) => ({ date, due: 3, done: [3, 2, 3, 2, 1, 2, 0][i] }))
  },
  tasks: { created: 6, completed: 4 },
  mood: {
    logged: 5, average: 3.4, previousAverage: 2.8,
    counts: { great: 1, good: 2, okay: 1, low: 1, rough: 0 },
    days: days.map((date, i) => ({ date, average: [4, null, 5, 3, 2, 3, null][i] })),
    lowest: { date: '2026-10-30', mood: 'low' as const }, trend: 'up' as const
  },
  journal: { entries: [{ id: 9, date: '2026-10-29', title: 'A slow start, a better end', body: '', mood: 'okay' as const, tags: [], createdAt: '', updatedAt: '' }], daysWritten: 1, reflection: null },
  insights: [], prompts: [{ id: 'went-well', text: 'What went well this week, and what do you want more of?' }, { id: 'change', text: 'What is one thing you will do differently next week?' }]
}

function Preview() {
  const [dark, setDark] = useState(false)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.style = 'modern'
  return (
    <div className="page page-lg">
      <header className="page-head">
        <div>
          <h1 className="page-title">Review</h1>
          <p className="page-sub">26 Oct to 1 Nov 2026 <span className="badge badge-open ml-1">In progress</span></p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => setDark((d) => !d)}>{dark ? 'Light theme' : 'Dark theme'}</button>
        </div>
      </header>
      <ReviewBody data={data} onOpen={() => undefined} onNavigate={() => undefined} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
