import { useEffect, useState } from 'react'
import type { ImportPreview } from '../../../shared/types'
import { today } from '../lib/dates'
import { errMsg } from '../lib/errors'
import { TAG_PALETTE, setTagColors, useTagColors } from '../lib/tagColors'
import { useSettings, updateSettings } from '../lib/settingsStore'
import { TagChip } from '../components/TagChip'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { CaptureSettings } from '../components/CaptureSettings'
import { TemplatesSettings } from '../components/TemplatesSettings'
import { PageHeader } from '../components/PageHeader'
import { TOOLS } from '../tools' // circular with the registry, but only read while rendering, never at load time

type Tab = 'appearance' | 'modules' | 'templates' | 'capture' | 'tags' | 'data' | 'shortcuts'
const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' }, { id: 'modules', label: 'Modules' }, { id: 'templates', label: 'Templates' }, { id: 'capture', label: 'Quick capture' }, { id: 'tags', label: 'Tags' }, { id: 'data', label: 'Data' }, { id: 'shortcuts', label: 'Shortcuts' }
]

export function SettingsPage() {
  const settings = useSettings()
  const [tab, setTab] = useState<Tab>('appearance')
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([])
  const tagColors = useTagColors()
  const [busy, setBusy] = useState<string | null>(null) // which action is running (null = none)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.app.dataPath().then(setPath)
    // Every tag used in the logbook or on a trade, with its combined count.
    Promise.all([window.api.logbook.tags(), window.api.trades.meta()]).then(([l, t]) => {
      const n = new Map<string, number>()
      for (const x of [...l, ...t.tags]) n.set(x.tag, (n.get(x.tag) ?? 0) + x.count)
      setAllTags([...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)))
    })
  }, [])

  // null = back to the default (accent) colour. Shown at once, then saved.
  const setTagColor = (tag: string, hex: string | null) => {
    const next = { ...tagColors }
    if (hex) next[tag] = hex; else delete next[tag]
    setTagColors(next)
    window.api.settings.set('tagColors', next)
  }

  // Runs one backup action and shows its result (or the error) under the buttons.
  const run = async (key: string, job: () => Promise<string | null>) => {
    setBusy(key); setMsg(null)
    try {
      const text = await job()
      if (text) setMsg({ ok: true, text })
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }) }
    setBusy(null)
  }
  const exportJson = () => run('json', async () => {
    const r = await window.api.backup.exportJson(today())
    return r && `Saved ${r.counts.entries} entries, ${r.counts.trades} trades, ${r.counts.goals} goals, ${r.counts.transactions} transactions, ${r.counts.habits} habits and ${r.counts.checkins} check-ins to ${r.path}`
  })
  const exportCsv = () => run('csv', async () => {
    const r = await window.api.backup.exportTradesCsv(today())
    return r && `Saved ${r.counts.trades} trades to ${r.path}`
  })
  const chooseImport = () => run('choose', async () => { setPreview(await window.api.backup.chooseImport()); return null })
  const applyImport = () => run('apply', async () => {
    await window.api.backup.applyImport()
    window.location.reload() // every page loads its data again from the restored database
    return null
  })
  const fmtCounts = (c: ImportPreview['counts']) =>
    `${c.entries} entries, ${c.trades} trades, ${c.goals} savings goals, ${c.transactions} transactions, ${c.habits} habits, ${c.checkins} check-ins`

  return (
    <div className="page page-sm">
      <PageHeader title="Settings" subtitle="Look, modules, templates, quick capture, tags, your data and shortcuts. Everything saves as you go." />

      <div className="seg mb-5" role="group" aria-label="Settings sections">
        {TABS.map((t) => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'appearance' && <div className="space-y-4"><AppearanceSettings /></div>}

      {tab === 'modules' && (
        <section className="card card-pad-lg">
          <h2 className="section-title">Modules</h2>
          <p className="mt-2 text-sm text-muted">
            Toggle modules on or off to keep your sidebar focused on the tools you use. Disabled modules are hidden from navigation and the command palette.
          </p>
          <ul className="mt-4 flex flex-col divide-y divide-line/60">
            {TOOLS.filter((t) => !t.footer && t.id !== 'dashboard').map((t) => {
              const Icon = t.icon
              const isOff = (settings.disabledModules ?? []).includes(t.id)
              return (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-muted">
                      <Icon size={18} />
                    </span>
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs capitalize text-muted">{t.category}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!isOff}
                    aria-label={`Toggle ${t.name}`}
                    onClick={() => {
                      const cur = settings.disabledModules ?? []
                      const next = isOff ? cur.filter((id) => id !== t.id) : [...cur, t.id]
                      updateSettings({ disabledModules: next })
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      !isOff ? 'bg-accent' : 'bg-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        !isOff ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {tab === 'templates' && <TemplatesSettings />}

      {tab === 'capture' && <div className="space-y-4"><CaptureSettings /></div>}

      {tab === 'shortcuts' && (
        <section className="card card-pad-lg">
          <h2 className="section-title">Keyboard shortcuts</h2>
          <ul className="mt-4 flex flex-col divide-y divide-line/60 text-sm">
            {TOOLS.filter((t) => t.shortcut).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2"><span>Go to {t.name}</span><kbd className="kbd">Ctrl+{t.shortcut}</kbd></li>
            ))}
            <li className="flex items-center justify-between py-2"><span>Command palette: jump to any tool (Cmd+K on a Mac)</span><kbd className="kbd">Ctrl+K</kbd></li>
            <li className="flex items-center justify-between py-2"><span>New item on the current page</span><kbd className="kbd">Ctrl+N</kbd></li>
            <li className="flex items-center justify-between py-2"><span>Collapse or expand the sidebar</span><kbd className="kbd">Ctrl+B</kbd></li>
          </ul>
        </section>
      )}

      {tab === 'tags' && (
      <section className="card card-pad-lg">
        <h2 className="section-title">Tag colours</h2>
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
      )}

      {tab === 'data' && (<>
      <section className="card card-pad-lg">
        <h2 className="section-title">Trash retention</h2>
        <p className="mt-2 text-sm text-muted">Items moved to Trash are permanently purged automatically after this number of days.</p>
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            Auto-purge after
            <input
              type="number"
              min="1"
              max="365"
              className="field w-20 py-1"
              value={settings.trash?.purgeDays ?? 30}
              onChange={(e) => {
                const days = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 30))
                updateSettings({ trash: { purgeDays: days } })
              }}
            />
            days
          </label>
        </div>
      </section>

      <section className="mt-4 card card-pad-lg">
        <h2 className="section-title">Your data</h2>
        <p className="mt-2 break-all text-sm text-muted">{path}</p>
        <p className="mt-1 text-sm text-muted">A dated backup is saved here automatically each day, but it sits next to your data. Export a copy to somewhere else (USB drive, cloud folder) to be safe from a dead disk or a reinstall.</p>
        <button onClick={() => window.api.app.openDataFolder()} className="btn mt-4">Open data folder</button>
      </section>

      <section className="mt-4 card card-pad-lg">
        <h2 className="section-title">Export and import</h2>
        <p className="mt-2 text-sm text-muted">The JSON backup holds everything: logbook, trades, savings and settings. The CSV holds trades only, for Excel.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportJson} disabled={busy !== null} aria-busy={busy === 'json'} className="btn-primary">Export everything (JSON)</button>
          <button onClick={exportCsv} disabled={busy !== null} aria-busy={busy === 'csv'} className="btn">Export trades (CSV)</button>
          <button onClick={chooseImport} disabled={busy !== null} aria-busy={busy === 'choose'} className="btn">Import backup…</button>
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-line p-4 text-sm">
            <p className="font-medium">Restore from {preview.fileName}?</p>
            <p className="mt-2 text-muted">File (exported {new Date(preview.exportedAt).toLocaleString()}): {fmtCounts(preview.counts)}.</p>
            <p className="mt-1 text-muted">Right now in the app: {fmtCounts(preview.current)}.</p>
            <p className="mt-3">This <strong>replaces</strong> everything in the app with the contents of the file. A copy of your current data is saved first, so you can undo it.</p>
            <div className="mt-3 flex gap-3">
              <button onClick={applyImport} disabled={busy !== null} aria-busy={busy === 'apply'} className="btn-primary">Replace my data</button>
              <button onClick={() => setPreview(null)} disabled={busy !== null} className="btn">Cancel</button>
            </div>
          </div>
        )}

        {msg && <p role="status" className={`mt-4 break-all text-sm ${msg.ok ? 'text-muted' : 'text-neg'}`}>{msg.text}</p>}
      </section>
      </>)}
    </div>
  )
}
