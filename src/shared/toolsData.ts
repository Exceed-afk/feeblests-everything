// The Tools hub's data shapes, owned here so both the main process and the
// renderer can import them without crossing into main-process code.
export interface Snippet {
  id: number
  title: string
  body: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface SnippetInput { title: string; body: string; tags: string[] }

export interface Scratchpad {
  id: number
  name: string
  content: string
  position: number
  createdAt: string
  updatedAt: string
}

// Names the renderer and the IPC bridge use.
export type SnippetDTO = Snippet
export type SnippetInputDTO = SnippetInput
export type ScratchpadDTO = Scratchpad
