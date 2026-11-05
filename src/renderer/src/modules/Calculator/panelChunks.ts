import { lazy } from 'react'
import type { ComponentType } from 'react'
import type { ModuleProps } from '../../lib/navigation'

type PanelProps = ModuleProps & { onClose?: () => void }

/** Props the conversion panel accepts on top of ModuleProps (a clicked history row). */
export interface ConversionExtraProps {
  currencySeed?: { amount: string; from: string; to: string; set: string } | null
  onCurrencySeedUsed?: () => void
}

/** Props the graph panel accepts on top of ModuleProps (the app's angle mode). */
export interface GraphExtraProps {
  angleMode: 'deg' | 'rad' | 'grad'
}

const panel = <M, K extends keyof M>(
  load: () => Promise<M>,
  pick: K,
  name: string
) => lazy(async () => {
  const mod = await load()
  const component = mod[pick] as unknown
  if (typeof component !== 'function') throw new Error(`The calculator panel "${name}" could not be loaded.`)
  return { default: component as ComponentType<PanelProps> }
})

// The conversion panel additionally accepts a seed from history, so its type carries those props.
const conversionPanel = lazy(async () => {
  const mod = await import('./panels/ConversionPanel')
  const component = mod.ConversionPanel as unknown
  if (typeof component !== 'function') throw new Error('The calculator panel "conversion" could not be loaded.')
  return { default: component as ComponentType<PanelProps & ConversionExtraProps> }
})

// The graph panel additionally accepts the app's angle mode (polar plots).
const graphPanel = lazy(async () => {
  const mod = await import('./panels/GraphPanel')
  const component = mod.GraphPanel as unknown
  if (typeof component !== 'function') throw new Error('The calculator panel "graph" could not be loaded.')
  return { default: component as ComponentType<PanelProps & GraphExtraProps> }
})

export const Statistics = panel(() => import('./panels/StatisticsPanel'), 'StatisticsPanel', 'statistics')
export const Finance = panel(() => import('./panels/FinancePanel'), 'FinancePanel', 'finance')
export const Conversion = conversionPanel
export const Graph = graphPanel
export const Matrix = panel(() => import('./panels/MatrixPanel'), 'MatrixPanel', 'matrix')
export const CAS = panel(() => import('./panels/CASPanel'), 'CASPanel', 'cas')
export const Programming = panel(() => import('./panels/ProgrammingPanel'), 'ProgrammingPanel', 'programming')
export const DateTime = panel(() => import('./panels/DateTimePanel'), 'DateTimePanel', 'datetime')
