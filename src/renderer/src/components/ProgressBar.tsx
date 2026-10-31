// Fills up to 100% but is allowed to be exceeded in the numbers shown elsewhere.
// `tone`: "accent" (the default, a neutral measure), "pos" (a completed goal or habit), "mood" (a savings goal, in the
// neutral chart colour). A full bar is always the success colour, whatever the tone.
export function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'pos' | 'mood' }) {
  const shown = Math.max(0, Math.min(100, percent))
  const full = percent >= 100
  const color = full ? 'bg-pos' : tone === 'pos' ? 'bg-pos' : tone === 'mood' ? 'bg-mood' : 'bg-accent'
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
      <div className={`h-full rounded-full transition-all duration-200 ${color}`} style={{ width: `${shown}%` }} />
    </div>
  )
}
