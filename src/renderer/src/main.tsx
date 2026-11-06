import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Capture } from './modules/Capture'
import { bootAppearance } from './lib/settingsStore'
// KaTeX's stylesheet and fonts are bundled by the build (no CDN, no network).
import 'katex/dist/katex.min.css'
import './styles.css'

bootAppearance() // apply the last-used look before the first paint
// The small Quick capture window loads this same page with "#capture" on the end (see src/main/capture.ts).
const isCaptureWindow = window.location.hash === '#capture'
createRoot(document.getElementById('root')!).render(<StrictMode>{isCaptureWindow ? <Capture /> : <App />}</StrictMode>)
