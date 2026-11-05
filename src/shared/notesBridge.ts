// The names the renderer and the preload bridge use for Phase 2/3 modules.
// Aliases of the real types, so nothing is re-shaped between layers.
export type { Note as NoteDTO, NoteFilter as NoteFilterDTO, NoteInput as NoteInputDTO } from './notes'
export type { ContentAsset, ContentInput as ContentInputDTO, ContentItem as ContentItemDTO, ContentStage } from './content'
