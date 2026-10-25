import { useEffect, useState } from 'react'
import type { ImportPreview, Settings, ThemeMode } from '../../../shared/types'
import { today } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { ACCENT_PRESETS, applyTheme } from '../lib/theme'
import { TAG_PALETTE, setTagColors, useTagColors } from '../lib/tagColors'
import { TagChip } from '../components/TagChip'

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }
]

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([])
  const tagColors = useTagColors()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.settings.getAll().then(setS)
    window.api.app.dataPath().then(setPath)
    // Every tag used in the logbook or on a trade, with its combined count.
    Promise.all([window.api.logbook.tags(), window.api.trades.meta()]).then(([l, t]) => {
      const n = new Map<string, number>()
      for (const x of [...l, ...t.tags]) n.set(x.tag, (n.get(x.tag) ?? 0) + x.count)
      setAllTags([...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)))
    })
  }, [])
  if (!s) return null

  // Update the screen immediately, then save to the database.
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...s, [key]: value }
    setS(next)
    applyTheme(next)
    window.api.settings.set(key, value)
  }

  // null = back to the default (accent) colour. Shown at once, then saved.
  const setTagColor = (tag: string, hex: string | null) => {
    const next = { ...tagColors }
    if (hex) next[tag] = hex; else delete next[tag]
    setTagColors(next)
    window.api.settings.set('tagColors', next)
  }

  // Runs one backup action and shows its result (or the error) under the buttons.
  const run = async (job: () => Promise<string | null>) => {
    setBusy(true); setMsg(null)
    try {
      const text = await job()
      if (text) setMsg({ ok: true, text })
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }) }
    setBusy(false)
  }
  const exportJson = () => run(async () => {
    const r = await window.api.backup.exportJson(today())
    return r && `Saved ${r.counts.entries} entries, ${r.counts.trades} trades, ${r.counts.goals} goals and ${r.counts.transactions} transactions to ${r.path}`
  })
  const exportCsv = () => run(async () => {
    const r = await window.api.backup.exportTradesCsv(today())
    return r && `Saved ${r.counts.trades} trades to ${r.path}`
  })
  const chooseImport = () => run(async () => { setPreview(await window.api.backup.chooseImport()); return null })
  const applyImport = () => run(async () => {
    await window.api.backup.applyImport()
    window.location.reload() // every page loads its data again from the restored database
    return null
  })
  const fmtCounts = (c: ImportPreview['counts']) =>
    `${c.entries} entries, ${c.trades} trades, ${c.goals} savings goals, ${c.transactions} transactions`

  return (
    <div className="mx-auto max-w-2xl px-10 py-16">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="mt-8 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="text-sm font-medium">Theme</h2>
        <div className="mt-3 inline-flex rounded-xl border border-line p-1">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => change('theme', m.id)}
              className={`rounded-lg px-4 py-1.5 text-sm ${s.theme === m.id ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}>
              {m.label}
            </button>
          ))}
        </div>

        <h2 className="mt-6 text-sm font-medium">Accent color</h2>
        <div className="mt-3 flex items-center gap-3">
          {ACCENT_PRESETS.map((a) => (
            <button key={a.hex} title={a.name} aria-label={a.name} onClick={() => change('accent', a.hex)}
              style={{ backgroundColor: a.hex }}
              className={`h-8 w-8 rounded-full ${s.accent === a.hex ? 'ring-2 ring-fg ring-offset-2 ring-offset-card' : ''}`} />
          ))}
          <input type="color" value={s.accent} onChange={(e) => change('accent', e.target.value)}
            aria-label="Custom accent color" className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-transparent" />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="text-sm font-medium">Tag colours</h2>
        <p className="mt-2 text-sm text-muted">Pick a colour for a tag and it is used everywhere: logbook, trades and search. A tag has the same colour on both.</p>
        {allTags.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No tags yet. Add a tag to a log entry or a trade and it shows up here.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {allTags.map(({ tag, count }) => (
              <li key={tag} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-40 shrink-0"><TagChip tag={tag} /> <span className="ml-1 text-xs text-muted">{count}</span></span>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Colour for ${tag}`}>
                  {TAG_PALETTE.map((c) => (
                    <button key={c.hex} title={c.name} aria-label={`${c.name} for ${tag}`} aria-pressed={tagColors[tag]?.toLowerCase() === c.hex}
                      onClick={() => setTagColor(tag, c.hex)} style={{ backgroundColor: c.hex }}
                      className={`h-5 w-5 rounded-full ${tagColors[tag]?.toLowerCase() === c.hex ? 'ring-2 ring-fg ring-offset-2 ring-offset-card' : ''}`} />
                  ))}
                  <button onClick={() => setTagColor(tag, null)} disabled={!tagColors[tag]}
                    className="ml-1 text-xs text-muted hover:text-fg disabled:opacity-40">Reset</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="text-sm font-medium">Your data</h2>
        <p className="mt-2 break-all text-sm text-muted">{path}</p>
        <p className="mt-1 text-sm text-muted">A dated backup is saved here automatically each day, but it sits next to your data. Export a copy to somewhere else (USB drive, cloud folder) to be safe from a dead disk or a reinstall.</p>
        <button onClick={() => window.api.app.openDataFolder()}
          className="mt-4 rounded-xl border border-line px-4 py-2 text-sm hover:bg-fg/5">Open data folder</button>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="text-sm font-medium">Export and import</h2>
        <p className="mt-2 text-sm text-muted">The JSON backup holds everything: logbook, trades, savings and settings. The CSV holds trades only, for Excel.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportJson} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">Export everything (JSON)</button>
          <button onClick={exportCsv} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-fg/5 disabled:opacity-50">Export trades (CSV)</button>
          <button onClick={chooseImport} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-fg/5 disabled:opacity-50">Import backup…</button>
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-line p-4 text-sm">
            <p className="font-medium">Restore from {preview.fileName}?</p>
            <p className="mt-2 text-muted">File (exported {new Date(preview.exportedAt).toLocaleString()}): {fmtCounts(preview.counts)}.</p>
            <p className="mt-1 text-muted">Right now in the app: {fmtCounts(preview.current)}.</p>
            <p className="mt-3">This <strong>replaces</strong> everything in the app with the contents of the file. A copy of your current data is saved first, so you can undo it.</p>
            <div className="mt-3 flex gap-3">
              <button onClick={applyImport} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-white disabled:opacity-50">Replace my data</button>
              <button onClick={() => setPreview(null)} disabled={busy} className="rounded-xl border border-line px-4 py-2 hover:bg-fg/5">Cancel</button>
            </div>
          </div>
        )}

        {msg && <p role="status" className={`mt-4 break-all text-sm ${msg.ok ? 'text-muted' : 'text-red-500'}`}>{msg.text}</p>}
      </section>
    </div>
  )
}
