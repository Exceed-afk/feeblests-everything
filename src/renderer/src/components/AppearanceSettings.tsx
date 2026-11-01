import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Density, FontChoice, Radius, TextSize, ThemeMode, UiStyle } from '../../../shared/types'
import { FONT_STACKS, OVERRIDE_KEYS, PALETTES, STYLE_PRESETS, cardBorder, contrast, hexToRgb, resolveTokens, rgbToHex } from '../../../shared/appearance'
import { ACCENT_PRESETS, isDark } from '../lib/theme'
import { resetAppearance, updateSettings, useSettings } from '../lib/settingsStore'
import { ProgressBar } from './ProgressBar'

// Every control here calls updateSettings(): the whole app changes at once and the choice is saved.

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; label: string; font?: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)} style={o.font ? { fontFamily: o.font } : undefined}>{o.label}</button>
      ))}
    </div>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card card-pad-lg">
    <h2 className="text-base font-semibold">{title}</h2>
    <div className="mt-4">{children}</div>
  </section>
)

// A tiny drawing of each interface style, so the choice can be made by eye.
function StylePreview({ minimal }: { minimal: boolean }) {
  const r = minimal ? 2 : 7
  const line = '1px solid rgb(var(--line))'
  return (
    <div className="flex h-20 overflow-hidden" style={{ background: 'rgb(var(--bg))', border: line, borderRadius: minimal ? 3 : 10 }}>
      <div className="flex flex-col" style={{ width: 30, gap: 4, padding: '8px 5px', borderRight: line, background: minimal ? 'rgb(var(--bg))' : 'rgb(var(--panel))' }}>
        <i style={{ height: 7, borderRadius: r, background: minimal ? 'transparent' : 'rgb(var(--accent) / .3)', boxShadow: minimal ? 'inset 2px 0 rgb(var(--accent))' : 'none' }} />
        <i style={{ height: 7, borderRadius: r, background: 'rgb(var(--fg) / .12)' }} />
        <i style={{ height: 7, borderRadius: r, background: 'rgb(var(--fg) / .12)' }} />
      </div>
      <div className="grid flex-1 grid-cols-2" style={{ gap: 6, padding: 8 }}>
        {[0, 1].map((i) => (
          <i key={i} style={{ borderRadius: r, background: 'rgb(var(--card))', border: line, boxShadow: minimal ? 'none' : 'var(--shadow-pop)' }} />
        ))}
      </div>
    </div>
  )
}

function ThemePreview({ tokens, minimal }: { tokens: ReturnType<typeof resolveTokens>; minimal: boolean }) {
  const border = rgbToHex(cardBorder(tokens, minimal ? 'minimal' : 'modern'))
  const bg = minimal ? tokens.bg : tokens.surface
  return (
    <div className="flex h-16 overflow-hidden" style={{ background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: minimal ? 3 : 8 }}>
      <div className="flex w-7 shrink-0 flex-col justify-center gap-1 border-r p-1" style={{ background: minimal ? tokens.bg : tokens.sidebar, borderColor: tokens.border }}>
        <i className="h-1 rounded-full" style={{ background: tokens.text }} />
        <i className="h-1 rounded-full" style={{ background: tokens.muted }} />
        <i className="h-1 rounded-full" style={{ background: tokens.muted }} />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-1 p-1.5">
        {[0, 1].map((index) => <i key={index} className="rounded-sm border" style={{ background: bg, borderColor: border }} />)}
      </div>
    </div>
  )
}

const COLOR_LABELS: Record<(typeof OVERRIDE_KEYS)[number], string> = {
  bg: 'Page background', sidebar: 'Sidebar', surface: 'Cards', text: 'Text'
}

// Four cards, spaced by the parent (SettingsPage wraps them in `space-y-4`).
export function AppearanceSettings() {
  const s = useSettings()
  const dark = isDark(s)
  const mode = dark ? 'dark' : 'light'
  const tokens = resolveTokens(s, dark)
  const [confirmReset, setConfirmReset] = useState(false)

  const setColor = (key: (typeof OVERRIDE_KEYS)[number], hex: string | null) => {
    const next = { ...s.colors[mode] }
    if (hex) next[key] = hex; else delete next[key]
    updateSettings({ colors: { ...s.colors, [mode]: next } })
  }
  const hasCustom = Object.keys(s.colors[mode]).length > 0
  const textContrast = contrast(hexToRgb(tokens.text), hexToRgb(tokens.bg))
  const pickStyle = (uiStyle: UiStyle) => updateSettings({ uiStyle, ...STYLE_PRESETS[uiStyle] })

  return (
    <>
      <Card title="Appearance">
        <Group title="Mode">
          <Segmented<ThemeMode> label="Mode" value={s.theme} onChange={(theme) => updateSettings({ theme })}
            options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }]} />
        </Group>

        <Group title="Interface style" hint="Picking a style also sets corner roundness and spacing below; you can still change those afterwards.">
          <div className="grid max-w-lg grid-cols-2 gap-3">
            {([['modern', 'Modern', 'Rounded cards with soft shadows'], ['minimal', 'Classic minimal', 'Flat, thin lines, compact']] as const).map(([id, name, desc]) => (
              <button key={id} className="opt" aria-pressed={s.uiStyle === id} onClick={() => pickStyle(id)}>
                <StylePreview minimal={id === 'minimal'} />
                <span className="opt-name"><span className="font-medium">{name}</span><br /><span className="text-muted">{desc}</span></span>
              </button>
            ))}
          </div>
        </Group>
      </Card>

      <Card title="Colours">
        <Group title="Colour themes" hint="Every theme has light and dark variants. Accent and custom colours are independent.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PALETTES.map((p) => {
              const t = resolveTokens({ palette: p.id, colors: { light: {}, dark: {} } }, dark)
              return (
                <button key={p.id} className="opt" aria-pressed={s.palette === p.id} onClick={() => updateSettings({ palette: p.id })}>
                  <ThemePreview tokens={t} minimal={s.uiStyle === 'minimal'} />
                  <span className="opt-name">{p.name}</span>
                </button>
              )
            })}
          </div>
        </Group>

        <Group title="Accent colour" hint="Buttons, highlights and progress bars. Text and icons adjust automatically for contrast.">
          <div className="flex flex-wrap items-center gap-3">
            {ACCENT_PRESETS.map((a) => (
              <button key={a.hex} title={a.name} aria-label={a.name} aria-pressed={s.accent === a.hex} onClick={() => updateSettings({ accent: a.hex })}
                style={{ backgroundColor: a.hex }}
                className={`h-8 w-8 rounded-full transition-transform hover:scale-110 active:scale-95 ${s.accent === a.hex ? 'ring-2 ring-fg ring-offset-2 ring-offset-card' : ''}`} />
            ))}
            <input type="color" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value })}
              aria-label="Custom accent colour" title="Pick any colour" className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-transparent" />
          </div>
        </Group>

        <details className="mt-6 rounded-xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Customise colours{hasCustom ? ' (in use)' : ''}</summary>
          <p className="mt-2 text-sm text-muted">
            You are editing the <strong className="text-fg">{mode}</strong> colours. Switch mode above to edit the other set.
            Borders and secondary text are worked out from your choices.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {OVERRIDE_KEYS.map((k) => (
              <li key={k} className="flex items-center gap-3">
                <input type="color" value={tokens[k]} onChange={(e) => setColor(k, e.target.value)} aria-label={COLOR_LABELS[k]}
                  className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-transparent" />
                <span className="w-36 text-sm">{COLOR_LABELS[k]}</span>
                <code className="text-xs text-muted">{tokens[k]}</code>
                <button className="btn btn-sm ml-auto" onClick={() => setColor(k, null)} disabled={!s.colors[mode][k]}>Reset</button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className={textContrast < 4.5 ? 'text-neg' : 'text-muted'} role="status">
              Text contrast {textContrast.toFixed(1)}:1{textContrast < 4.5 ? ' (hard to read, aim for 4.5 or more)' : ' (good)'}
            </span>
            <button className="btn btn-sm ml-auto" onClick={() => updateSettings({ colors: { ...s.colors, [mode]: {} } })} disabled={!hasCustom}>Reset {mode} colours</button>
          </div>
        </details>
      </Card>

      <Card title="Shape, spacing and text">
        <Group title="Corner roundness">
          <Segmented<Radius> label="Corner roundness" value={s.radius} onChange={(radius) => updateSettings({ radius })}
            options={[{ id: 'sharp', label: 'Sharp' }, { id: 'soft', label: 'Soft' }, { id: 'round', label: 'Round' }]} />
        </Group>
        <Group title="Spacing" hint="How much room there is inside cards, lists and buttons.">
          <Segmented<Density> label="Spacing" value={s.density} onChange={(density) => updateSettings({ density })}
            options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'spacious', label: 'Spacious' }]} />
        </Group>
        <Group title="Text size">
          <Segmented<TextSize> label="Text size" value={s.textSize} onChange={(textSize) => updateSettings({ textSize })}
            options={[{ id: 'small', label: 'Small' }, { id: 'default', label: 'Default' }, { id: 'large', label: 'Large' }]} />
        </Group>
        <Group title="Font" hint="Fonts already on your computer; nothing is downloaded.">
          <Segmented<FontChoice> label="Font" value={s.font} onChange={(font) => updateSettings({ font })}
            options={([['system', 'Default'], ['clean', 'Clean'], ['serif', 'Serif'], ['mono', 'Mono']] as const).map(([id, label]) => ({ id, label, font: FONT_STACKS[id] }))} />
        </Group>
        <Group title="Sidebar" hint="Also: the button at the top of the sidebar, or Ctrl+B. In a narrow window it collapses by itself.">
          <Segmented<'open' | 'rail'> label="Sidebar" value={s.sidebarCollapsed ? 'rail' : 'open'} onChange={(v) => updateSettings({ sidebarCollapsed: v === 'rail' })}
            options={[{ id: 'open', label: 'Expanded' }, { id: 'rail', label: 'Icons only' }]} />
        </Group>
      </Card>

      <Card title="Preview">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary">Primary</button>
          <button className="btn">Default</button>
          <button className="btn" disabled>Disabled</button>
          <button className="btn-primary" aria-busy="true" disabled>Saving</button>
          <button className="btn-danger">Delete</button>
          <button className="btn btn-sm">Small</button>
        </div>
        <div className="mt-4 max-w-sm"><ProgressBar percent={62} /></div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-muted">Resets mode, style, colours, shape and text. Your data and tag colours stay as they are.</p>
          <button className={confirmReset ? 'btn-danger shrink-0' : 'btn shrink-0'} onBlur={() => setConfirmReset(false)}
            onClick={() => { if (confirmReset) { resetAppearance(); setConfirmReset(false) } else setConfirmReset(true) }}>
            {confirmReset ? 'Click again to reset' : 'Reset appearance'}
          </button>
        </div>
      </Card>
    </>
  )
}
