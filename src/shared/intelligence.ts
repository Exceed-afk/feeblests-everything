import { DEFAULT_INTELLIGENCE, type IntelligenceFeatureToggles } from './types'

export function mergeFeatures(
  saved: Partial<IntelligenceFeatureToggles> | undefined,
  patch: Partial<IntelligenceFeatureToggles>
): IntelligenceFeatureToggles {
  return { ...DEFAULT_INTELLIGENCE.features, ...saved, ...patch }
}
