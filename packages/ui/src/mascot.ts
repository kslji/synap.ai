/**
 * Mascot timing manifest. The character is the blob in blob.ts: one SVG,
 * stepped with requestAnimationFrame. No audio, no video, and no frames
 * from animation/mp4.
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
  engine: 'svg'
  states: Record<'idle' | 'searching' | 'thinking' | 'success' | 'error', MascotMotion>
  clicks: MascotMotion[]
}

export const MASCOT_MANIFEST: MascotManifest = {
  audio: false,
  shipReferenceClips: false,
  referenceDir: 'animation/mp4',
  engine: 'svg',
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

/** The animate setting runs the loop. Reduced motion keeps the loop and lowers the amplitude. */
export function shouldAnimate(animate: boolean, _reducedMotion = false): boolean {
  return animate
}

/** Amplitude multiplier from the reference file when the OS asks for less motion. */
export function motionScale(reducedMotion: boolean): number {
  return reducedMotion ? 0.3 : 1
}
