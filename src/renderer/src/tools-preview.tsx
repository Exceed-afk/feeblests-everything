// TEMPORARY QA HARNESS (delete after verification).
import { createRoot } from 'react-dom/client'
import { Tools } from './modules/ToolsHub'
import { applyAppearance } from './lib/theme'
import { DEFAULT_SETTINGS } from '../../shared/types'
import './styles.css'

applyAppearance(DEFAULT_SETTINGS)

const snippets = [
  { id: 1, title: 'Deploy command', body: 'docker compose up -d --build', tags: ['ops'], createdAt: '', updatedAt: '' },
  { id: 2, title: 'Standup reply', body: 'Yesterday: x\nToday: y\nBlockers: none', tags: ['work'], createdAt: '', updatedAt: '' }
]

window.api = {
  snippets: { list: async () => snippets, create: async () => snippets[0], update: async () => snippets[0], remove: async () => 'b' },
  scratchpads: {
    ensure: async () => ({ id: 1, name: 'Notes', content: 'quick text', position: 0, createdAt: '', updatedAt: '' }),
    list: async () => [{ id: 1, name: 'Notes', content: 'quick text', position: 0, createdAt: '', updatedAt: '' }],
    create: async () => ({ id: 2, name: 'Pad 2', content: '', position: 1, createdAt: '', updatedAt: '' }),
    update: async () => ({ id: 1, name: 'Notes', content: '', position: 0, createdAt: '', updatedAt: '' }),
    remove: async () => 'b',
    saveAsNote: async () => ({ id: 9, title: 'Notes' })
  },
  tools: { copyText: async () => { } },
  focus: { logManual: async () => ({} as never) },
  capture: { onDataChanged: () => () => { }, saved: async () => { } }
} as never

createRoot(document.getElementById('root')!).render(
  <div className="flex h-full"><main className="min-w-0 flex-1 overflow-y-auto">
    <Tools target={null} onTargetHandled={() => { }} onOpen={() => { }} onNavigate={() => { }} />
  </main></div>
)
