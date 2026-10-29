// Quick capture, the Electron side: a global keyboard shortcut and a tray icon that open a small always-on-top window
// for logging a note, trade, deposit or habit check-in without opening the whole app.
// Everything here uses Electron's own APIs (globalShortcut, Tray, BrowserWindow): no extra packages.
//
// The rules that can be tested without Electron (which shortcuts are allowed, how the form text becomes a valid
// entry) are in src/shared/capture.ts. The form itself is the renderer page modules/Capture.tsx (route "#capture").
//
// How it behaves:
//   - The capture window is created hidden at start-up, so the shortcut shows it at once instead of waiting for a page to load.
//   - It hides when it loses focus (like a launcher), and when closed it only hides. Whatever was typed stays until saved.
//   - A new shortcut is tried BEFORE it is saved, so a shortcut another program already owns never replaces one that works.
import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage, screen } from 'electron'
import { CAPTURE_SETTING_KEYS, checkAccelerator, formatAccelerator, readCaptureSettings } from '../shared/capture'
import { TRAY_ICON_16, TRAY_ICON_32, TRAY_TEMPLATE_16, TRAY_TEMPLATE_32 } from './trayIcon'
import type { CaptureConfigResult, CaptureSettings, CaptureStatus } from '../shared/types'

const WIDTH = 480
const MIN_HEIGHT = 200
const MAX_HEIGHT = 640

export interface CaptureDeps {
  appName: string
  preload: string // path of the preload script (the same one the main window uses)
  rendererUrl: string | undefined // dev server address, when running with `npm run dev`
  htmlFile: string // built page, when packaged
  background(): string // window colour, so a light-theme user does not see a dark flash
  readSettings(): Record<string, unknown> // every saved setting
  saveSetting(key: string, value: unknown): void
  showMain(): void // bring the main window up (re-creating it if it was closed)
  mainVisible(): boolean
  quit(): void
  isQuitting(): boolean
}

export interface Capture {
  apply(): CaptureStatus // make the shortcut, tray icon and window match the saved settings
  configure(patch: Partial<CaptureSettings>): CaptureConfigResult
  status(): CaptureStatus
  show(): void
  hide(restoreFocus?: boolean): void
  resize(height: number): void
  dispose(): void
}

export function createCapture(deps: CaptureDeps): Capture {
  const isMac = process.platform === 'darwin'
  let win: BrowserWindow | null = null
  let tray: Tray | null = null
  let loaded = false // the capture page has finished loading
  let showWhenLoaded = false
  let registered: string | null = null // the shortcut this app currently holds
  let problem: string | null = null
  let lastShown = 0
  let lastBlurHide = 0
  let lastKey = 0

  const settings = (): CaptureSettings => readCaptureSettings(deps.readSettings())

  // ---------- the shortcut ----------

  // Returns why it failed, or null when the system accepted it.
  function register(accelerator: string): string | null {
    try {
      return globalShortcut.register(accelerator, onShortcut) ? null : 'Another program is already using this shortcut. Choose a different one.'
    } catch {
      return 'The system did not accept this shortcut. Choose a different one.'
    }
  }
  function unregister(): void {
    if (registered) { try { globalShortcut.unregister(registered) } catch { /* already gone */ } }
    registered = null
  }
  const onShortcut = (): void => {
    const now = Date.now()
    if (now - lastKey < 250) return // holding the keys down must not flicker the window open and shut
    lastKey = now
    toggle()
  }

  // ---------- the window ----------

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) return win
    loaded = false
    const w = new BrowserWindow({
      title: `${deps.appName} quick capture`,
      width: WIDTH, height: 360, useContentSize: true,
      show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true,
      backgroundColor: deps.background(),
      webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false }
    })
    win = w
    w.setMenuBarVisibility(false)
    // Same rules as the main window: this page never navigates away or opens other windows.
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // Closing only hides, so the next shortcut press is instant. (A real quit still closes it.)
    w.on('close', (e) => { if (!deps.isQuitting()) { e.preventDefault(); w.hide() } })
    // Like a launcher: clicking anywhere else puts it away. The text stays, because the window is only hidden.
    w.on('blur', () => {
      if (Date.now() - lastShown < 250) return // a window that has only just appeared can lose focus once while the system settles
      if (w.webContents.isDevToolsOpened()) return
      lastBlurHide = Date.now()
      w.hide()
    })
    w.on('closed', () => { if (win === w) { win = null; loaded = false } })
    w.webContents.once('did-finish-load', () => {
      loaded = true
      if (showWhenLoaded) { showWhenLoaded = false; reveal(w) }
    })
    const page = deps.rendererUrl ? w.loadURL(`${deps.rendererUrl}#capture`) : w.loadFile(deps.htmlFile, { hash: 'capture' })
    page.catch((e) => console.error('Quick capture page failed to load:', e))
    return w
  }

  // Centred horizontally, in the upper part of the screen the mouse is on.
  function place(w: BrowserWindow): void {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [width, height] = w.getSize()
    const x = area.x + Math.round((area.width - width) / 2)
    const y = Math.min(area.y + Math.round(area.height * 0.2), area.y + area.height - height - 8)
    w.setPosition(x, Math.max(area.y, y))
  }

  function reveal(w: BrowserWindow): void {
    place(w)
    lastShown = Date.now()
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
    w.webContents.send('capture:shown') // the page reloads its lists and puts the cursor in the first field
  }

  function show(): void {
    const w = ensureWindow()
    if (!loaded) { showWhenLoaded = true; return }
    reveal(w)
  }

  // `restoreFocus`: after Esc or a save, hand the keyboard back to the program that was in use. On a Mac that means hiding
  // this app (unless the main window is up); Windows does it by itself. A click elsewhere (blur) must NOT do this, or
  // clicking the main window would hide it.
  function hide(restoreFocus = false): void {
    showWhenLoaded = false
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
      if (restoreFocus && isMac && !deps.mainVisible()) app.hide()
    }
  }

  function toggle(): void {
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hide(true)
    else show()
  }

  // The page measures its own content and asks for exactly that much height.
  function resize(height: number): void {
    if (!win || win.isDestroyed() || !Number.isFinite(height)) return
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)))
    if (win.getContentSize()[1] === next) return
    // GTK ignores size changes on a window that cannot be resized, so allow it for the moment.
    if (process.platform === 'linux') win.setResizable(true)
    win.setContentSize(WIDTH, next)
    if (process.platform === 'linux') win.setResizable(false)
  }

  // ---------- the tray icon ----------

  function trayImage(): Electron.NativeImage {
    const [small, large] = isMac ? [TRAY_TEMPLATE_16, TRAY_TEMPLATE_32] : [TRAY_ICON_16, TRAY_ICON_32]
    const image = nativeImage.createEmpty()
    image.addRepresentation({ scaleFactor: 1, width: 16, height: 16, dataURL: `data:image/png;base64,${small}` })
    image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, dataURL: `data:image/png;base64,${large}` })
    if (isMac) image.setTemplateImage(true) // macOS recolours it for light and dark menu bars
    return image
  }

  function ensureTray(hotkey: string): void {
    try {
      if (!tray || tray.isDestroyed()) {
        tray = new Tray(trayImage())
        // Windows and Linux: a plain click toggles the window. (On a Mac a click opens the menu instead.)
        tray.on('click', () => {
          // Clicking the tray took focus from the capture window, which hid it a moment ago: that click means "close it".
          if (Date.now() - lastBlurHide < 400) return
          toggle()
        })
      }
      tray.setToolTip(`${deps.appName}: quick capture (${formatAccelerator(hotkey, isMac)})`)
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Quick capture', click: () => show() },
        { label: `Open ${deps.appName}`, click: () => deps.showMain() },
        { type: 'separator' },
        { label: 'Quit', click: () => deps.quit() }
      ]))
    } catch {
      tray = null // some Linux desktops have no tray: the shortcut still works
    }
  }

  function removeTray(): void {
    if (tray && !tray.isDestroyed()) tray.destroy()
    tray = null
  }

  // ---------- putting it together ----------

  function status(): CaptureStatus {
    const s = settings()
    return { ...s, registered: s.enabled && registered === s.hotkey, platform: process.platform, problem: s.enabled ? problem : null }
  }

  function apply(): CaptureStatus {
    const s = settings()
    if (!s.enabled) {
      unregister(); problem = null
      removeTray()
      if (win && !win.isDestroyed()) { const w = win; win = null; loaded = false; w.destroy() } // frees its memory
      return status()
    }
    if (registered !== s.hotkey) {
      unregister()
      problem = register(s.hotkey)
      registered = problem ? null : s.hotkey
    }
    ensureTray(s.hotkey)
    ensureWindow()
    return status()
  }

  function configure(patch: Partial<CaptureSettings>): CaptureConfigResult {
    const next = settings()
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.keepRunning === 'boolean') next.keepRunning = patch.keepRunning
    if (patch.hotkey !== undefined) {
      const checked = checkAccelerator(patch.hotkey)
      if (!checked.ok) return { ok: false, error: checked.reason, status: status() }
      next.hotkey = checked.value
    }
    // Try the new shortcut before saving anything. If the system refuses it, put the old one back and say so.
    if (next.enabled && next.hotkey !== registered) {
      const previous = registered
      unregister()
      const why = register(next.hotkey)
      if (why) {
        if (previous && register(previous) === null) registered = previous
        return { ok: false, error: why, status: status() }
      }
      registered = next.hotkey
      problem = null
    }
    deps.saveSetting(CAPTURE_SETTING_KEYS.enabled, next.enabled)
    deps.saveSetting(CAPTURE_SETTING_KEYS.hotkey, next.hotkey)
    deps.saveSetting(CAPTURE_SETTING_KEYS.keepRunning, next.keepRunning)
    return { ok: true, error: null, status: apply() }
  }

  function dispose(): void {
    globalShortcut.unregisterAll()
    registered = null
    removeTray()
  }

  return { apply, configure, status, show, hide, resize, dispose }
}
