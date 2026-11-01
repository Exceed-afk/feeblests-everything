import { useMemo, useEffect, useState, useCallback } from 'react'
import { Brain, Trash2, Zap } from 'lucide-react'
import { DEFAULT_INTELLIGENCE, type IntelligenceFeatureToggles } from '../../../shared/types'
import { DEFAULT_AUTOMATIONS, type AutomationSettings, type AutomationActivity } from '../../../shared/automations'
import {
  CLOUD_CONFIRM_PHRASE, keyStateLabel, MAX_ASSISTANT_MODEL_LENGTH, MAX_ASSISTANT_URL_LENGTH,
  type AssistantKeyStatus, type AssistantSettings
} from '../../../shared/assistant'
import { errMsg } from '../lib/errors'

const PLATFORM = typeof process !== 'undefined' ? process.platform : 'unknown'
import { applyFromMain, useSettings } from '../lib/settingsStore'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

// Per-feature toggle card. Matches the existing Settings page style (no hardcoded colours).
function FeatureCard({
  name, description, enabled, onToggle
}: {
  name: string
  description: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <label className="card card-pad card-interactive cursor-pointer" aria-pressed={enabled}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="mt-0.5 shrink-0 rounded border-line text-accent focus:ring-accent/40"
          aria-describedby={`${name}-desc`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{name}</div>
          <p id={`${name}-desc`} className="text-sm text-muted mt-0.5">{description}</p>
        </div>
      </div>
    </label>
  )
}

const FEATURES: { key: keyof IntelligenceFeatureToggles; name: string; description: string }[] = [
  { key: 'dailyBriefing', name: 'Daily briefing', description: 'A short summary of the day\'s activity shown on the dashboard.' },
  { key: 'automations', name: 'Automations', description: 'Rule-based actions that run automatically, like moving money when a goal is close.' },
  { key: 'smartQuickAdd', name: 'Smart quick-add', description: 'Suggestions when capturing something quickly, based on what you usually log.' },
  { key: 'insights', name: 'Insights', description: 'Cross-tool observations, like mood on days you finished every habit.' },
  { key: 'aiAssistant', name: 'AI assistant', description: 'An AI helper that can answer questions about your data. Needs an AI provider to be chosen below.' }
]

export function Intelligence() {
  const s = useSettings()
  const features = s.intelligence?.features ?? DEFAULT_INTELLIGENCE.features
  const [automations, setAutomations] = useState<AutomationSettings>(DEFAULT_AUTOMATIONS)
  const [activity, setActivity] = useState<AutomationActivity[]>([])
  const [saveError, setSaveError] = useState('')

  const refreshAutomation = () => {
    window.api.intelligence.automations.get().then(setAutomations).catch(() => undefined)
    window.api.intelligence.automations.activity().then(setActivity).catch(() => undefined)
  }
  useEffect(() => { refreshAutomation() }, [])

  const toggle = (key: keyof IntelligenceFeatureToggles) => {
    setSaveError('')
    void window.api.intelligence.set({ [key]: !features[key] })
      .then((intelligence) => applyFromMain({ intelligence }))
      .catch((error) => setSaveError(errMsg(error)))
  }

  const setAutomation = (patch: Partial<AutomationSettings>) => {
    setAutomations((prev) => ({ ...prev, ...patch }))
    window.api.intelligence.automations.set(patch).then((next) => setAutomations(next)).catch(() => undefined)
  }

  // Group features: everything except AI assistant comes first, then the AI section.
  const regularFeatures = FEATURES.filter(f => f.key !== 'aiAssistant')
  const aiFeature = FEATURES.find(f => f.key === 'aiAssistant')!

  return (
    <div className="page page-sm">
      <PageHeader title="Intelligence" subtitle="Turn individual features on or off. Everything runs on your computer unless you choose Cloud for the assistant.">
        <Brain size={20} className="text-accent" />
      </PageHeader>

      {saveError && <p role="alert" className="text-sm text-neg">{saveError}</p>}

      <div className="space-y-5">
        {/* ---- Feature toggles ---- */}
        <section className="card card-pad-lg" aria-labelledby="features-title">
          <h2 id="features-title" className="section-title">Features</h2>
          <p className="mt-1 text-sm text-muted">Each feature works on its own. Turn on only what you want to use.</p>

          <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Feature toggles">
            {regularFeatures.map(({ key, name, description }) => (
              <FeatureCard
                key={key}
                name={name}
                description={description}
                enabled={features[key]}
                onToggle={() => toggle(key)}
              />
            ))}
          </div>

          {/* AI assistant — only meaningful when an AI provider is available */}
          <div className="mt-4 flex flex-col gap-2">
            <FeatureCard
              name={aiFeature.name}
              description={aiFeature.description}
              enabled={features.aiAssistant}
              onToggle={() => toggle('aiAssistant')}
            />
          </div>
        </section>

        {/* ---- Automations (step 3) ---- */}
        <section className="card card-pad-lg" aria-labelledby="automations-title">
          <h2 id="automations-title" className="section-title flex items-center gap-2"><Zap size={15} /> Automations</h2>
          <p className="mt-1 text-sm text-muted">
            Small, predictable helpers. Each one works on its own and is off until you turn it on.
            They only create drafts or show messages — they never edit or delete anything you made.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <FeatureCard name="Loss reflection drafts" description="When a trade closes at a loss bigger than your threshold, create a draft logbook entry with a reflection prompt (tagged #automation)."
              enabled={automations.lossReflection} onToggle={() => setAutomation({ lossReflection: !automations.lossReflection })} />
            {automations.lossReflection && (
              <label className="flex items-center gap-3 text-sm pl-9">
                <span className="text-muted">Loss threshold</span>
                <input type="number" min="0" step="1" className="field w-24" value={automations.lossThreshold}
                  onChange={(e) => setAutomation({ lossThreshold: Math.max(0, Number(e.target.value) || 0) })}
                  aria-label="Loss threshold: create a reflection draft when a closed trade loses more than this" />
              </label>
            )}
            <FeatureCard name="Goal celebrations" description="When a savings goal reaches its target, show a celebration message and suggest setting a new goal."
              enabled={automations.goalCelebration} onToggle={() => setAutomation({ goalCelebration: !automations.goalCelebration })} />
            <FeatureCard name="Broken streak notes" description="When a habit streak of 7 or more days breaks, show a gentle note on the dashboard."
              enabled={automations.streakReminder} onToggle={() => setAutomation({ streakReminder: !automations.streakReminder })} />
            <FeatureCard name="Stale overdue tasks" description="When a task has been overdue for more than N days, surface it in the daily briefing."
              enabled={automations.overdueTaskNudge} onToggle={() => setAutomation({ overdueTaskNudge: !automations.overdueTaskNudge })} />
            {automations.overdueTaskNudge && (
              <label className="flex items-center gap-3 text-sm pl-9">
                <span className="text-muted">Overdue after</span>
                <input type="number" min="0" step="1" className="field w-24" value={automations.overdueDays}
                  onChange={(e) => setAutomation({ overdueDays: Math.max(0, Number(e.target.value) || 0) })}
                  aria-label="Surface a task in the daily briefing once it has been overdue for more than this many days" />
                <span className="text-muted">days</span>
              </label>
            )}
          </div>
        </section>

        {/* ---- Activity: what the automations did and when ---- */}
        <section className="card card-pad-lg" aria-labelledby="activity-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="activity-title" className="section-title">Automation activity</h2>
            {activity.length > 0 && (
              <button className="btn btn-sm" onClick={async () => { await window.api.intelligence.automations.clearActivity(); refreshAutomation() }}>
                Clear list
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">Everything an automation did, and when. Nothing here is silent; nothing here is hidden.</p>
          {activity.length === 0 ? (
            <div className="mt-4">
              <EmptyState compact title="Nothing yet" text="Automations will list what they do here, each with the time it happened." />
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-1.5">
              {activity.map((a) => (
                <li key={a.id} className="card card-pad-sm flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">{a.label}</div>
                    <div className="meta mt-0.5">{new Date(a.at).toLocaleString()} · {a.rule}</div>
                  </div>
                  <button className="btn-icon hover:text-neg" aria-label={`Delete this activity record`}
                    onClick={async () => { await window.api.intelligence.automations.deleteActivity(a.id); refreshAutomation() }}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Privacy statement ---- */}
        <section className="card card-pad-lg" aria-labelledby="privacy-title">
          <h2 id="privacy-title" className="section-title flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-pos">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Your data stays on this computer
          </h2>
          <p className="mt-2 text-sm leading-relaxed">
            The rule-based intelligence features — daily briefing, automations, smart quick-add and insights — run entirely offline.
            They read your data from this app's local database and never send anything over the network. Nothing leaves this computer.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your trades, savings, habits, journal entries and tasks are stored in a SQLite database on your machine.
            The app does not phone home, does not call any external service, and does not include analytics.
          </p>
        </section>

        {/* ---- AI provider (step 6) ---- */}
        {aiFeature.name && (
          <AssistantProviderSection
            features={features}
          />
        )}
      </div>
    </div>
  )
}

// The provider picker, key storage and the cloud confirmation. Settings changes go to
// the main process (which owns safeStorage); the master toggle above stays separate.
function AssistantProviderSection({ features }: {
  features: IntelligenceFeatureToggles
}) {
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null)
  const [keyState, setKeyState] = useState<AssistantKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [keyError, setKeyError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [model, setModel] = useState('')
  const [localUrl, setLocalUrl] = useState('')
  const [cloudUrl, setCloudUrl] = useState('')

  const reload = useCallback(async () => {
    const [s, k] = await Promise.all([window.api.intelligence.assistant.get(), window.api.intelligence.assistant.keyStatus()])
    setAssistant(s); setKeyState(k); setModel(s.model); setLocalUrl(s.localUrl); setCloudUrl(s.cloudUrl)
  }, [])
  useEffect(() => { reload() }, [reload])

  if (!assistant || !keyState) return null
  const patch = async (p: Partial<AssistantSettings>): Promise<void> => {
    try {
      const next = await window.api.intelligence.assistant.set(p)
      setAssistant(next)
      setSettingsError('')
    } catch (error) {
      setSettingsError(errMsg(error))
    }
  }
  const aiProvider = assistant.provider
  const setAiProvider = (provider: AssistantSettings['provider']) => {
    setSettingsError('')
    void patch({ provider })
  }

  return (
    <section className="card card-pad-lg" aria-labelledby="ai-provider-title">
      <h2 id="ai-provider-title" className="section-title">AI provider</h2>
      <p className="mt-1 text-sm text-muted">The assistant answers questions about your own data. Off by default; nothing has ever been sent until you choose otherwise.</p>

      <div className="seg mt-4" role="group" aria-label="AI provider">
        <button aria-pressed={aiProvider === 'off'} onClick={() => setAiProvider('off')}>Off</button>
        <button aria-pressed={aiProvider === 'local'} onClick={() => setAiProvider('local')}>Local model</button>
        <button aria-pressed={aiProvider === 'cloud'} onClick={() => setAiProvider('cloud')}>Cloud</button>
      </div>
      {settingsError && <p role="alert" className="mt-2 text-sm text-neg">{settingsError}</p>}

      <dl className="mt-4 text-sm">
        <div>
          <dt className="meta font-medium">What leaves this computer</dt>
          <dd className="mt-1 leading-relaxed">
            {aiProvider === 'off' && <>Nothing. Ever. There is no request to send.</>}
            {aiProvider === 'local' && <>One short text block per question — your question's words — to <span className="num">{assistant.localUrl}</span>. Loopback only: it cannot point anywhere else. No data rows, no history, no key (none is needed).</>}
            {aiProvider === 'cloud' && <>The same one text block per question, plus your API key in a header, over https to <span className="num">{assistant.cloudUrl}</span>. Read the provider's privacy policy first. Under every answer the Assistant page shows exactly what was sent.</>}
          </dd>
        </div>
      </dl>

      {aiProvider === 'cloud' && !assistant.cloudConfirmed && (
        <div className="mt-4 rounded-xl border border-neg/60 p-4">
          <p className="text-sm font-medium">Confirmation required</p>
          <p className="mt-1 text-sm text-muted">Type “{CLOUD_CONFIRM_PHRASE}” to confirm you understand that questions are sent over the internet to the provider above.</p>
          <div className="mt-2 flex gap-2">
            <input className="field" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label={`Type ${CLOUD_CONFIRM_PHRASE} to confirm`} />
            <button className="btn-primary" disabled={confirmText.trim() !== CLOUD_CONFIRM_PHRASE}
              onClick={() => patch({ cloudConfirmed: true })}>Confirm</button>
          </div>
        </div>
      )}
      {aiProvider === 'cloud' && assistant.cloudConfirmed && (
        <p className="meta mt-3" role="status">Confirmed for this address. Changing the address asks again.</p>
      )}

      {aiProvider !== 'off' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-muted">Address ({aiProvider === 'local' ? 'localhost only' : 'https required'})
            <input className="field mt-1" value={aiProvider === 'local' ? localUrl : cloudUrl} maxLength={MAX_ASSISTANT_URL_LENGTH}
              onChange={(e) => (aiProvider === 'local' ? setLocalUrl : setCloudUrl)(e.target.value)}
              onBlur={() => patch(aiProvider === 'local' ? { localUrl } : { cloudUrl })}
              aria-label="Provider address" />
          </label>
          <label className="flex flex-col text-xs text-muted">Model name
            <input className="field mt-1" value={model} maxLength={MAX_ASSISTANT_MODEL_LENGTH} onChange={(e) => setModel(e.target.value)}
              onBlur={() => patch({ model })} aria-label="Model name" />
          </label>
        </div>
      )}

      {aiProvider === 'cloud' && (
        <div className="mt-4 rounded-xl border border-line/60 p-4">
          <p className="text-sm font-medium">API key</p>
          {keyStateLabel(keyState) === 'unreadable' && (
            <p role="alert" className="mt-2 text-sm text-neg">A key is saved but cannot be read on this computer. Paste it again.</p>
          )}
          {!keyState.encryptionOk ? (
            <p className="mt-1 text-sm text-neg">This system cannot encrypt a key right now (no OS keyring available{PLATFORM === 'linux' ? ' — a gnome-keyring or KWallet backend is needed' : ''}), so a key cannot be saved: it would have to be written in plain text. Use Local model mode, which needs no key.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Stored with the operating system's encryption ({PLATFORM === 'win32' ? 'Windows DPAPI' : PLATFORM === 'darwin' ? 'the macOS Keychain' : 'the desktop keyring'}). Never shown again, never logged, never included in exports.</p>
              {keyStateLabel(keyState) === 'ok'
                ? <div className="mt-2 flex items-center gap-2">
                    <span className="badge badge-pos">Key saved</span>
                    <button className="btn btn-sm" onClick={async () => { await window.api.intelligence.assistant.clearKey(); reload() }}>Remove key</button>
                  </div>
                : <div className="mt-2 flex gap-2">
                    <input type="password" className="field" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="Paste the API key" aria-label="API key" autoComplete="off" />
                    <button className="btn-primary" disabled={!keyInput.trim()}
                      onClick={async () => {
                        setKeyMsg(''); setKeyError('')
                        const r = await window.api.intelligence.assistant.setKey(keyInput)
                        if (r.ok) { setKeyInput(''); setKeyMsg('Key saved, encrypted.') } else setKeyError(r.error)
                        reload()
                      }}>Save key</button>
                  </div>}
              {keyMsg && <p className="meta mt-2 text-pos" role="status">{keyMsg}</p>}
              {keyError && <p className="meta mt-2 text-neg" role="alert">{keyError}</p>}
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        The assistant is read-only: it can compute one number per question and nothing else. It cannot create, edit or delete anything.
        {features.aiAssistant ? ' The AI-assistant toggle above is on.' : ' Turn on the AI-assistant toggle above to make the Assistant page appear.'}
      </p>
    </section>
  )
}
