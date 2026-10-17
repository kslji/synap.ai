/**
 * The sidebar Surf chip. Colour and text follow the real sync state.
 * A successful sync shows Synced briefly, then returns to Surf.
 */

export const SURF_NAME = 'Surf'
export const SYNCED_HOLD_MS = 4000

/** Pip's orange. Black text on this orange stays above WCAG AA. */
export const SURF_SYNC_ORANGE = '#f2740f'
export const SURF_SYNC_INK = '#1c1917'
export const SURF_OK_BG = '#15803d'
export const SURF_OK_INK = '#f0fdf4'
export const SURF_FAIL_BG_LIGHT = '#fef2f2'
export const SURF_FAIL_INK_LIGHT = '#991b1b'
export const SURF_FAIL_BG_DARK = '#3f1212'
export const SURF_FAIL_INK_DARK = '#fecaca'
/** Muted text on the elevated chip. Same hexes as tokens.css --muted and --bg-elev. */
export const SURF_MUTED_LIGHT = '#6f6a78'
export const SURF_CHIP_LIGHT = '#ffffff'
export const SURF_MUTED_DARK = '#b7b1c4'
export const SURF_CHIP_DARK = '#221f2a'

export type SurfSyncState = 'uptodate' | 'syncing' | 'failed' | 'offline'
export type SurfChipPhase = 'idle' | 'syncing' | 'synced' | 'failed' | 'offline'

export interface SurfChipHold {
  phase: SurfChipPhase
  holdUntil: number
}

export const SURF_CHIP_IDLE: SurfChipHold = { phase: 'idle', holdUntil: 0 }

export function surfChipStep(hold: SurfChipHold, state: SurfSyncState, now: number, holdMs = SYNCED_HOLD_MS): SurfChipHold {
  if (state === 'syncing') return { phase: 'syncing', holdUntil: 0 }
  if (state === 'failed') return { phase: 'failed', holdUntil: 0 }
  if (state === 'offline') return { phase: 'offline', holdUntil: 0 }
  if (hold.phase === 'syncing') return { phase: 'synced', holdUntil: now + holdMs }
  if (hold.phase === 'synced' && now < hold.holdUntil) return hold
  return SURF_CHIP_IDLE
}

export interface SurfChipTone {
  background: string
  color: string
  borderColor: string
}

/** Idle and offline keep the default chip. Offline text uses the muted token. */
export function surfChipTone(phase: SurfChipPhase, theme: 'light' | 'dark'): SurfChipTone | null {
  if (phase === 'syncing') return { background: SURF_SYNC_ORANGE, color: SURF_SYNC_INK, borderColor: '#c2410c' }
  if (phase === 'synced') return { background: SURF_OK_BG, color: SURF_OK_INK, borderColor: '#166534' }
  if (phase === 'failed') {
    return theme === 'dark'
      ? { background: SURF_FAIL_BG_DARK, color: SURF_FAIL_INK_DARK, borderColor: '#7f1d1d' }
      : { background: SURF_FAIL_BG_LIGHT, color: SURF_FAIL_INK_LIGHT, borderColor: '#fecaca' }
  }
  return null
}

export function surfChipText(phase: SurfChipPhase): string {
  if (phase === 'synced') return `${SURF_NAME} · Synced`
  if (phase === 'failed') return 'Sync failed'
  if (phase === 'offline') return 'Offline'
  return SURF_NAME
}

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)
}

/** WCAG contrast ratio for two #rrggbb colours. */
export function contrastRatio(ink: string, background: string): number {
  const lighter = Math.max(luminance(ink), luminance(background))
  const darker = Math.min(luminance(ink), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}
