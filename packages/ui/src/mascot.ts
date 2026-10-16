/**
 * Original Surf Bot motion. CSS on the star drawing only.
 * No audio, no video, and no frames from animation/mp4.
 * Durations match the keyframes in star-surf.css.
 */

export interface MascotMotion {
  id: string
  className: string
  durationMs: number
}

export interface MascotManifest {
  audio: false
  shipReferenceClips: false
  referenceDir: 'animation/mp4'
  states: Record<'idle' | 'searching' | 'thinking' | 'success' | 'error', MascotMotion>
  clicks: MascotMotion[]
}

export const MASCOT_MANIFEST: MascotManifest = {
  audio: false,
  shipReferenceClips: false,
  referenceDir: 'animation/mp4',
  states: {
    idle: { id: 'idle', className: 'is-idle', durationMs: 3600 },
    searching: { id: 'searching', className: 'is-searching', durationMs: 700 },
    thinking: { id: 'thinking', className: 'is-thinking', durationMs: 2200 },
    success: { id: 'success', className: 'is-success', durationMs: 900 },
    error: { id: 'error', className: 'is-error', durationMs: 550 },
  },
  clicks: [
    { id: 'click-hop', className: 'is-click-hop', durationMs: 800 },
    { id: 'click-spin', className: 'is-click-spin', durationMs: 900 },
    { id: 'click-spark', className: 'is-click-spark', durationMs: 1000 },
  ],
}

export function pickClick(seed: number): MascotMotion {
  const list = MASCOT_MANIFEST.clicks
  const index = Math.abs(Math.floor(seed * list.length)) % list.length
  return list[index] ?? list[0]!
}
