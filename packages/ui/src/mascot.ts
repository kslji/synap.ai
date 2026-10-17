/**
 * Pip timing manifest. The character is the blob in blob.ts: one SVG,
 * stepped with requestAnimationFrame. No audio and no video.
 */

export interface MascotMotion {
  id: string
  className: string
  durationMs: number
}

export const PIP_STATE_IDS = [
  'idle',
  'thinking',
  'working',
  'happy',
  'oops',
  'searching',
  'reading',
  'writing',
  'permission',
  'typing',
  'offline',
  'sleepy',
  'benchmark',
  'wink',
  'guiding',
  'notification',
  'dizzy',
] as const

export type PipStateId = (typeof PIP_STATE_IDS)[number]

export interface MascotManifest {
  audio: false
  shipReferenceClips: false
  engine: 'svg'
  states: Record<PipStateId, MascotMotion>
  clicks: MascotMotion[]
}

function motion(id: PipStateId, durationMs = 0): MascotMotion {
  return { id, className: `is-${id}`, durationMs }
}

export const MASCOT_MANIFEST: MascotManifest = {
  audio: false,
  shipReferenceClips: false,
  engine: 'svg',
  states: {
    idle: motion('idle'),
    thinking: motion('thinking', 2200),
    working: motion('working'),
    happy: motion('happy'),
    oops: motion('oops'),
    searching: motion('searching', 700),
    reading: motion('reading'),
    writing: motion('writing'),
    permission: motion('permission'),
    typing: motion('typing'),
    offline: motion('offline'),
    sleepy: motion('sleepy'),
    benchmark: motion('benchmark'),
    wink: motion('wink'),
    guiding: motion('guiding'),
    notification: motion('notification'),
    dizzy: motion('dizzy'),
  },
  clicks: [
    { id: 'poke-squash', className: 'is-poke-squash', durationMs: 0 },
    { id: 'poke-dizzy', className: 'is-poke-dizzy', durationMs: 0 },
    { id: 'wink', className: 'is-wink', durationMs: 0 },
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

/** Amplitude multiplier when the OS asks for less motion. */
export function motionScale(reducedMotion: boolean): number {
  return reducedMotion ? 0.3 : 1
}
