import type { EverythingApi } from '../../shared/types'
declare global {
  interface Window { api: EverythingApi }
}
export {}
