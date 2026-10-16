/**
 * Local-first web search types. Queries stay on this computer.
 * Reddit and X are not connectors. A result URL on those hosts is dropped.
 */

export const LOCAL_LAYER_ORDER = ['pack', 'history', 'project', 'cache', 'files'] as const

export type LocalLayer = (typeof LOCAL_LAYER_ORDER)[number]

export type Intent = 'finance' | 'legal' | 'code' | 'paper' | 'news' | 'general'

export interface LocalHit {
  layer: LocalLayer
  title: string
  text: string
  url: string
  pack: string
  version?: string
  fileName?: string
  score: number
}

export interface ConnectorHit {
  source: string
  title: string
  url: string
  snippet: string
  published: string | null
}

export interface RegionChoice {
  code: string
  label: string
  source: 'question' | 'setting' | 'ip' | 'global'
}

export const SEARCH_UA = 'SynapSurf/0.1 (+https://synap.surf; on-device research)'
