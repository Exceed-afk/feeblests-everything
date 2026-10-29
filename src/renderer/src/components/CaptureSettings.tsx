// Settings > Quick capture: turn the global shortcut and tray icon on or off, choose the shortcut, and decide whether
// closing the window leaves the app running in the tray. A change goes to the main process, which tries the shortcut
// FIRST and only saves it if the system accepts it, so what is shown here is what really works.
import { useEffect, useState } from 'react'
import type { CaptureSettings as Settings, CaptureStatus } from '../../../shared/types'
import { DEFAULT_HOTKEY, acceleratorFromKeyEvent, checkAccelerator, formatAccelerator } from '../../../shared/capture'
import { errMsg } from '../lib/errors'

export function CaptureSettings() {
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('') // why the last change was refused
  const isMac = /mac/i.test(navigator.platform)

  useEffect(() => { window.api.capture.status().then(setStatus).catch((e) => setError(errMsg(e))) }, [])

  const change = async (patch: Partial<Settings>): Promise<void> => {
    setError('')
    try {
      const r = await window.api.capture.configure(patch)
      setStatus(r.status)
      if (!r.ok) setError(r.error ?? 'That could not be saved.')
    } catch (e) { setError(errMsg(e)) }
  }

  // While "recording", the next allowed key combination becomes the shortcut. Esc cancels. Listening in the capture phase
  // and stopping the event keeps the app's own shortcuts (Ctrl+K and so on) from reacting to what is being pressed.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopPropagation()
      if (e.code === 'Escape') { setRecording(false); setError(''); return }
      const pressed = acceleratorFromKeyEvent(e, isMac)
      if (!pressed) return // only modifier keys so far: keep waiting
      const checked = checkAccelerator(pressed)
      if (!checked.ok) { setError(checked.reason); return } // say why, and keep listening
      setRecording(false)
      change({ hotkey: checked.value })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, isMac])

  if (!status) return <section className="card card-pad-lg" aria-busy="true"><h2 className="section-title">Quick capture</h2>{error && <p role="alert" className="mt-2 text-sm text-neg">{error}</p>}</section>

  return (
    <section className="card card-pad-lg">
      <h2 className="section-title">Quick capture</h2>
      <p className="mt-2 text-sm text-muted">
        A small window for logging a note, a trade, a deposit or a habit check-in without opening the whole app.
        Open it from any program with the shortcut, or from the tray icon.
      </p>

      <label className="mt-4 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={status.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
        Turn on the shortcut and the tray icon
      </label>

      {status.enabled && (<>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm">Shortcut</span>
          <kbd className="kbd" aria-live="polite">{recording ? 'Press the new shortcut, Esc to cancel' : formatAccelerator(status.hotkey, isMac)}</kbd>
          <button className="btn btn-sm" onClick={() => { setError(''); setRecording((r) => !r) }}>{recording ? 'Cancel' : 'Change'}</button>
          {status.hotkey !== DEFAULT_HOTKEY && !recording && <button className="btn btn-sm" onClick={() => change({ hotkey: DEFAULT_HOTKEY })}>Reset</button>}
        </div>

        {error ? <p role="alert" className="mt-2 text-sm text-neg">{error}</p>
          : status.problem ? <p role="alert" className="mt-2 text-sm text-neg">{status.problem}</p>
          : status.registered ? <p role="status" className="mt-2 text-sm text-muted">The shortcut is active. It works in any program while this app is running.</p>
          : null}

        {!isMac && (
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={status.keepRunning} onChange={(e) => change({ keepRunning: e.target.checked })} />
            <span>
              Keep running in the tray when I close the window
              <span className="mt-0.5 block text-xs text-muted">
                The shortcut and tray icon keep working, so capture is always one keypress away. Quit from the tray icon's menu.
              </span>
            </span>
          </label>
        )}
        {isMac && <p className="mt-4 text-xs text-muted">On a Mac the app keeps running in the menu bar when its window is closed. Quit it from the menu bar icon.</p>}

        <button className="btn mt-4" onClick={() => window.api.capture.open()}>Try it now</button>
        {status.platform === 'linux' && (
          <p className="mt-3 text-xs text-muted">
            Some Linux desktops hide tray icons, and on Wayland a program cannot listen for shortcuts while another window has focus.
            If either applies, the shortcut or the icon may do nothing; use "Quick capture" in the command palette (Ctrl+K) instead.
          </p>
        )}
      </>)}
    </section>
  )
}
