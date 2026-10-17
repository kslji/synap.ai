/**
 * Original Surf Bot motion. The star drawing stays; a face and squash-and-stretch
 * are drawn in SVG and stepped in JavaScript. No audio, no video, and no frames
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

export type MascotMouth = 'smile' | 'grin' | 'flat' | 'open' | 'frown'

export interface MascotPose {
  scaleX: number
  scaleY: number
  x: number
  y: number
  rotate: number
  eyeOpen: number
  pupilX: number
  pupilY: number
  mouth: MascotMouth
  wink: boolean
}

/** Mouth shapes drawn on the star. Each path is original. */
export const MOUTH_PATH: Record<MascotMouth, string> = {
  smile: 'M28 62 Q50 76 72 62',
  grin: 'M24 58 Q50 82 76 58',
  flat: 'M34 64 H66',
  open: 'M38 58 Q50 76 62 58 Q50 66 38 58',
  frown: 'M30 72 Q50 58 70 72',
}

const STILL: MascotPose = {
  scaleX: 1,
  scaleY: 1,
  x: 0,
  y: 0,
  rotate: 0,
  eyeOpen: 1,
  pupilX: 0,
  pupilY: 0,
  mouth: 'smile',
  wink: false,
}

export function pickClick(seed: number): MascotMotion {
  const list = MASCOT_MANIFEST.clicks
  const index = Math.abs(Math.floor(seed * list.length)) % list.length
  return list[index] ?? list[0]!
}

/** Motion runs only when the setting is on and the OS is not asking for less motion. */
export function shouldAnimate(animate: boolean, reducedMotion: boolean): boolean {
  return animate && !reducedMotion
}

/** Gap before the next idle blink. The seed is 0..1 from Math.random. */
export function blinkDelayMs(seed: number): number {
  const unit = ((seed % 1) + 1) % 1
  return 1800 + Math.floor(unit * 3200)
}

export function stillPose(): MascotPose {
  return { ...STILL }
}

function wave(tMs: number, periodMs: number): number {
  return Math.sin((tMs / periodMs) * Math.PI * 2)
}

function hop(tMs: number, periodMs: number): Pick<MascotPose, 'scaleX' | 'scaleY' | 'y' | 'rotate'> {
  const p = (tMs % periodMs) / periodMs
  if (p < 0.22) {
    return { scaleX: 1.14, scaleY: 0.84, y: 3, rotate: -4 }
  }
  if (p < 0.58) {
    const up = (p - 0.22) / 0.36
    return { scaleX: 0.9, scaleY: 1.12, y: -16 * Math.sin(up * Math.PI), rotate: 6 }
  }
  const land = (p - 0.58) / 0.42
  return { scaleX: 1.1 - land * 0.1, scaleY: 0.88 + land * 0.12, y: (1 - land) * 3, rotate: -2 * (1 - land) }
}

/** Pose at tMs for a state or a tap. blink closes both eyes, except a wink which closes one. */
export function poseAt(motionId: string, tMs: number, blink = false): MascotPose {
  const pose = stillPose()
  const idle = MASCOT_MANIFEST.states.idle.durationMs
  const think = MASCOT_MANIFEST.states.thinking.durationMs
  const search = MASCOT_MANIFEST.states.searching.durationMs
  const success = MASCOT_MANIFEST.states.success.durationMs
  const error = MASCOT_MANIFEST.states.error.durationMs

  if (motionId === 'idle' || motionId === 'guiding' || motionId === 'notification') {
    const period = motionId === 'guiding' ? 1150 : motionId === 'notification' ? 850 : idle
    const b = wave(tMs, period)
    pose.y = b * (motionId === 'idle' ? -4 : -8)
    pose.scaleY = 1 + b * 0.04
    pose.scaleX = 1 - b * 0.025
    pose.rotate = b * (motionId === 'idle' ? 3 : 8)
    pose.mouth = motionId === 'notification' ? 'open' : 'smile'
    if (motionId === 'guiding') pose.pupilX = Math.sign(b) || 0
  } else if (motionId === 'arrive') {
    const p = Math.min(1, Math.max(0, tMs) / 1500)
    pose.y = (1 - p) * 28
    pose.scaleX = 0.8 + p * 0.2 + (p > 0.45 && p < 0.7 ? 0.12 : 0)
    pose.scaleY = 1.12 - p * 0.12 - (p > 0.45 && p < 0.7 ? 0.16 : 0)
    pose.rotate = (1 - p) * -12
    pose.mouth = 'grin'
  } else if (motionId === 'thinking') {
    const b = wave(tMs, think)
    pose.y = b * -2
    pose.scaleY = 1 + Math.abs(b) * 0.03
    pose.scaleX = 1 - Math.abs(b) * 0.02
    pose.rotate = b * 5
    pose.pupilY = -0.7
    pose.pupilX = b * 0.25
    pose.mouth = 'flat'
  } else if (motionId === 'searching') {
    const b = wave(tMs, search)
    pose.rotate = b * 10
    pose.pupilX = b
    pose.y = Math.abs(b) * -3
    pose.scaleX = 1 + Math.abs(b) * 0.05
    pose.scaleY = 1 - Math.abs(b) * 0.04
    pose.mouth = 'open'
  } else if (motionId === 'success') {
    const hopPose = hop(tMs, success)
    pose.scaleX = hopPose.scaleX
    pose.scaleY = hopPose.scaleY
    pose.y = hopPose.y
    pose.rotate = hopPose.rotate
    pose.mouth = 'grin'
  } else if (motionId === 'error') {
    const b = wave(tMs, error)
    pose.x = b * 4
    pose.rotate = 7 + b * 5
    pose.scaleX = 1.05
    pose.scaleY = 0.92
    pose.pupilY = 0.4
    pose.mouth = 'frown'
    pose.eyeOpen = 0.75
  } else if (motionId === 'click-hop') {
    const hopPose = hop(tMs, 800)
    pose.scaleX = hopPose.scaleX
    pose.scaleY = hopPose.scaleY
    pose.y = hopPose.y
    pose.rotate = hopPose.rotate
    pose.mouth = 'grin'
  } else if (motionId === 'click-spin') {
    const p = Math.min(1, Math.max(0, tMs) / 900)
    pose.rotate = p * 360
    pose.scaleX = 1 + Math.sin(p * Math.PI) * 0.08
    pose.scaleY = 1 - Math.sin(p * Math.PI) * 0.05
    pose.mouth = 'grin'
  } else if (motionId === 'click-spark') {
    const p = Math.min(1, Math.max(0, tMs) / 1000)
    const pop = Math.sin(p * Math.PI)
    pose.scaleX = 1 - pop * 0.06
    pose.scaleY = 1 + pop * 0.1
    pose.y = -10 * pop
    pose.wink = p > 0.15 && p < 0.55
    pose.mouth = 'grin'
  }

  if (blink && !pose.wink) pose.eyeOpen = 0.08
  return pose
}
