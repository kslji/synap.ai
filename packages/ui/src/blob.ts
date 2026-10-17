/**
 * Surf Bot body, ported from the reference blob: a 12-point spline, pill eyes,
 * blink, glance, squash, and sparkles. No video and no audio.
 */

export const DEFAULT_BLOB_COLOR = '#f2740f'
export const LIGHT_EYE = '#fff4e8'
export const DARK_EYE = '#2b1204'

export const BLOB_SWATCHES = [
  { id: 'orange', label: 'Orange', hex: '#f2740f' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'green', label: 'Green', hex: '#1f9d62' },
  { id: 'pink', label: 'Pink', hex: '#e85d9a' },
  { id: 'purple', label: 'Purple', hex: '#8b5cf6' },
  { id: 'teal', label: 'Teal', hex: '#0f9b8e' },
  { id: 'yellow', label: 'Yellow', hex: '#e0a106' },
  { id: 'red', label: 'Red', hex: '#e24b4b' },
] as const

export type BlobMood =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'happy'
  | 'oops'
  | 'searching'
  | 'reading'
  | 'writing'
  | 'permission'
  | 'typing'
  | 'offline'
  | 'sleepy'
  | 'benchmark'
  | 'wink'
  | 'guiding'
  | 'notification'
  | 'dizzy'

export type BlobVariant = 'full' | 'avatar' | 'mark'

interface Rgb { r: number; g: number; b: number }

export interface BlobPalette {
  top: string
  bottom: string
  glow: string
  eye: string
  sparks: [string, string, string, string]
}

interface Pose {
  erl: number
  err: number
  ehl: number
  ehr: number
  amp: number
  spd: number
  bob: number
  bs: number
  tilt: number
  es: number
  op: number
  sy0: number
}

const POSE_KEYS = ['erl', 'err', 'ehl', 'ehr', 'amp', 'spd', 'bob', 'bs', 'tilt', 'es', 'op', 'sy0'] as const

const IDLE: Pose = { erl: 12, err: 12, ehl: 1, ehr: 1, amp: 5, spd: 1, bob: 3, bs: 1.6, tilt: 0, es: 1, op: 1, sy0: 1 }

/** The five poses from the reference file. Eye and body numbers are unchanged. */
export const FILE_POSES: Record<'idle' | 'thinking' | 'working' | 'happy' | 'oops', Pose> = {
  idle: IDLE,
  thinking: { ...IDLE, erl: 78, err: 6, ehr: 1.08, amp: 7, spd: 1.6, bob: 2, bs: 2.2, tilt: -5, es: 0.96, op: 0.8, sy0: 1 },
  working: { ...IDLE, erl: 0, err: 0, amp: 6, spd: 4, bob: 5, bs: 5.5, op: 0.82, sy0: 1 },
  happy: { ...IDLE, erl: 0, err: 0, ehl: 1.2, ehr: 1.2, amp: 10, spd: 5, bob: 4, bs: 6, es: 1.12, sy0: 1 },
  oops: { ...IDLE, erl: -24, err: 24, ehl: 0.85, ehr: 0.85, amp: 3, spd: 0.8, bob: 1.5, bs: 1, tilt: 6, es: 0.93, op: 0.75, sy0: 0.94 },
}

const EXTRA: Record<Exclude<BlobMood, keyof typeof FILE_POSES>, Pose> = {
  searching: { ...IDLE, amp: 6, spd: 2.4, bob: 2.4, bs: 2.2, tilt: 8, es: 1.02 },
  reading: { ...IDLE, amp: 3.2, spd: 1.05, bob: 2, bs: 1.3, tilt: 3, es: 1 },
  writing: { ...IDLE, amp: 4, spd: 1.35, bob: 3.6, bs: 3.3, es: 1.04 },
  permission: { ...IDLE, amp: 0.6, spd: 0.35, bob: 0.35, bs: 0.6, tilt: -7, es: 1.08, ehl: 1.06, ehr: 1.06 },
  typing: { ...IDLE, amp: 3.5, spd: 1.1, bob: 2, bs: 1.5, tilt: 5, es: 1.08 },
  offline: { ...IDLE, ehl: 0.55, ehr: 0.55, amp: 2, spd: 0.5, bob: 1.4, bs: 1, op: 0.9, es: 0.98 },
  sleepy: { ...IDLE, ehl: 0.1, ehr: 0.1, amp: 1.6, spd: 0.4, bob: 6, bs: 0.55, op: 0.75, es: 0.96 },
  benchmark: { ...IDLE, ehl: 0.42, ehr: 0.42, amp: 8, spd: 5.6, bob: 2, bs: 6.4, es: 0.96 },
  wink: { ...IDLE, ehl: 0.14, ehr: 1.14, es: 1.04, amp: 3.5 },
  guiding: { ...IDLE, tilt: -6, amp: 3, spd: 0.9, bob: 2.2, bs: 1.4, es: 1.05 },
  notification: { ...IDLE, es: 1.08, amp: 5, bob: 3.2, bs: 2.1 },
  dizzy: { ...IDLE, amp: 9, spd: 3.2, bob: 3, bs: 4, es: 1.16 },
}

const POSES: Record<BlobMood, Pose> = { ...FILE_POSES, ...EXTRA }

const ALIAS: Record<string, BlobMood> = {
  error: 'oops',
  success: 'happy',
  done: 'happy',
  answering: 'writing',
  arrive: 'idle',
}

const N = 12
const CX = 200
const CY = 205
const SPARK_D = 'M0,-9L2.4,-2.4L9,0L2.4,2.4L0,9L-2.4,2.4L-9,0L-2.4,-2.4Z'

export function blobStateFor(kind: string): BlobMood {
  if (kind in POSES) return kind as BlobMood
  return ALIAS[kind] ?? 'idle'
}

/** Which expression wins. Real cues only; the caller decides what is actually happening. */
export function resolveBlobState(input: {
  task?: string | null
  permission?: boolean
  benchmark?: boolean
  typing?: boolean
  offline?: boolean
  sleepy?: boolean
}): BlobMood {
  const task = blobStateFor(input.task ?? 'idle')
  if (task === 'oops') return 'oops'
  if (input.permission) return 'permission'
  if (input.benchmark) return 'benchmark'
  if (task === 'searching' || task === 'reading' || task === 'writing' || task === 'thinking' || task === 'happy' || task === 'working') return task
  if (input.typing) return 'typing'
  if (input.offline) return 'offline'
  if (input.sleepy) return 'sleepy'
  return task === 'idle' ? 'idle' : task
}

export function parseHex(input: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(input.trim())
  if (!match?.[1]) return null
  const n = Number.parseInt(match[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function hex(c: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function luminance(c: Rgb): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

function rgbToHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

/** Light top stop and darker bottom stop. The default orange keeps the file's exact stops. */
export function paletteFor(input: string, muted = false): BlobPalette {
  const parsed = parseHex(input) ?? parseHex(DEFAULT_BLOB_COLOR)!
  const grey = { r: 138, g: 132, b: 124 }
  const bottomRgb = muted ? mix(parsed, grey, 0.48) : parsed
  let topRgb: Rgb
  if (!muted && hex(parsed) === DEFAULT_BLOB_COLOR) topRgb = parseHex('#ffc27a')!
  else {
    const hsl = rgbToHsl(bottomRgb)
    topRgb = hslToRgb(hsl.h, Math.min(1, hsl.s * 0.92 + 0.05), Math.min(0.84, hsl.l + 0.24))
  }
  const white = { r: 255, g: 255, b: 255 }
  const eye = luminance(bottomRgb) < 0.38 ? LIGHT_EYE : DARK_EYE
  return {
    top: hex(topRgb),
    bottom: hex(bottomRgb),
    glow: hex(bottomRgb),
    eye,
    sparks: [
      hex(mix(bottomRgb, white, 0.72)),
      hex(mix(bottomRgb, white, 0.28)),
      hex(mix(bottomRgb, white, 0.84)),
      hex(mix(bottomRgb, white, 0.93)),
    ],
  }
}

export function poseFor(state: string): Pose {
  return { ...POSES[blobStateFor(state)] }
}

/** Where the eyes want to look, in -1..1. Scripted states ignore the pointer. */
export function gazeTarget(state: string, t: number, pointer: { x: number; y: number } | null): { x: number; y: number } {
  const mood = blobStateFor(state)
  if (mood === 'thinking') return { x: -0.75 + 0.15 * Math.sin(t * 0.8), y: -0.85 }
  if (mood === 'working') return { x: Math.sin(t * 2.2), y: 0.45 }
  if (mood === 'oops') return { x: 0, y: 0.85 }
  if (mood === 'searching') return { x: Math.sin(t * 7.5), y: -0.06 }
  if (mood === 'reading') {
    const pos = ((t % 2.8) / 2.8) * 4
    const line = Math.floor(pos)
    const along = pos - line
    return { x: -0.9 + along * 1.8, y: -0.72 + line * 0.42 }
  }
  if (mood === 'writing') return { x: -0.85 + ((t % 1) * 1.7), y: 0.2 }
  if (mood === 'permission') return { x: 0.42, y: 0.62 }
  if (mood === 'guiding') return { x: 0.15, y: 0.35 }
  if (mood === 'typing') return { x: 0.08 * Math.sin(t * 0.7), y: 0.92 }
  if (mood === 'offline') return { x: 0, y: 0.18 }
  if (mood === 'sleepy') return { x: 0, y: 0.3 }
  if (mood === 'benchmark') return { x: Math.sin(t * 5) * 0.16, y: -0.04 }
  if (mood === 'wink') return { x: 0.15, y: 0 }
  if (mood === 'dizzy') return { x: Math.sin(t * 8) * 0.35, y: Math.cos(t * 8) * 0.28 }
  if (pointer) return pointer
  return { x: 0, y: 0 }
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function bodyPath(points: Array<[number, number]>): string {
  const p = points
  let o = `M${p[0]![0]},${p[0]![1]}`
  for (let i = 0; i < N; i += 1) {
    const a = p[(i + N - 1) % N]!
    const b = p[i]!
    const c = p[(i + 1) % N]!
    const d = p[(i + 2) % N]!
    o += `C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (d[0] - b[0]) / 6},${c[1] - (d[1] - b[1]) / 6} ${c[0]},${c[1]}`
  }
  return `${o}Z`
}

export interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  sc: number
  r: number
  color: string
}

export interface Sim {
  P: Pose
  cur: BlobMood
  hy: number
  hv: number
  sq: number
  sqv: number
  nextHop: number
  nextBlink: number
  blinkU: number
  nextSac: number
  shakeUntil: number
  ptrT: number
  L: { x: number; y: number }
  sac: { x: number; y: number }
  ptr: { x: number; y: number }
  dizzyUntil: number
  winkUntil: number
  wideUntil: number
  taps: number[]
  sparks: Spark[]
  entered: boolean
}

export interface DrawCmd {
  d: string
  group: string
  face: string
  eyeL: string
  eyeR: string
  shadowRx: number
  shadowOp: number
  glint: number
  showSpark: boolean
  showGlow: boolean
  showShadow: boolean
  showHighlight: boolean
}

export function createSim(): Sim {
  return {
    P: { ...IDLE },
    cur: 'idle',
    hy: 0,
    hv: 0,
    sq: 0,
    sqv: 0,
    nextHop: 0,
    nextBlink: 2,
    blinkU: -1,
    nextSac: 1.4,
    shakeUntil: 0,
    ptrT: -9,
    L: { x: 0, y: 0 },
    sac: { x: 0, y: 0 },
    ptr: { x: 0, y: 0 },
    dizzyUntil: 0,
    winkUntil: 0,
    wideUntil: 0,
    taps: [],
    sparks: [],
    entered: false,
  }
}

export interface AdvanceInput {
  state: string
  reduced: boolean
  variant: BlobVariant
  poke?: boolean
  wink?: boolean
  caret?: number | null
  pointer?: { x: number; y: number } | null
  hover?: boolean
  snap?: boolean
  glance?: { x: number; y: number }
  random?: () => number
}

function spawn(sim: Sim, n: number, x: number, y: number, big: boolean, colors: string[], rnd: () => number): void {
  for (let i = 0; i < n; i += 1) {
    const a = rnd() * 6.28
    const v = (big ? 160 : 90) + rnd() * 120
    sim.sparks.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 120,
      life: 0.9 + rnd() * 0.5,
      max: 1,
      sc: 0.6 + rnd() * 0.9,
      r: rnd() * 360,
      color: colors[i % colors.length] ?? colors[0]!,
    })
  }
}

export function advance(sim: Sim, t: number, dtIn: number, input: AdvanceInput, colors: string[] = paletteFor(DEFAULT_BLOB_COLOR).sparks): DrawCmd {
  const dt = Math.min(0.05, Math.max(0, dtIn))
  const rnd = input.random ?? Math.random
  const requested = blobStateFor(input.state)
  const reduced = input.reduced
  const variant = input.variant
  if (!sim.entered || sim.cur !== requested) {
    if (requested === 'happy' && sim.cur !== 'happy') {
      sim.hv = reduced ? 0 : 420
      sim.nextHop = t + 1.25
      if (!reduced && variant === 'full') spawn(sim, 16, 200, 200, true, colors, rnd)
    }
    if (requested === 'oops' && sim.cur !== 'oops') sim.shakeUntil = t + 0.5
    if (sim.cur === 'sleepy' && requested !== 'sleepy' && sim.entered) sim.blinkU = 0
    sim.cur = requested
    sim.entered = true
  }
  if (input.wink) sim.winkUntil = Math.max(sim.winkUntil, t + 0.38)
  if (input.poke) {
    sim.sq = -0.2
    sim.sqv = 0
    sim.wideUntil = t + 0.16
    sim.blinkU = -0.12
    sim.taps = sim.taps.filter((at) => t - at < 1.2)
    sim.taps.push(t)
    if (sim.taps.length >= 3) sim.dizzyUntil = t + 1.15
    if (!reduced && variant === 'full') spawn(sim, 5, 200, 170, false, colors, rnd)
  }
  const shown: BlobMood = t < sim.dizzyUntil ? 'dizzy' : requested
  const target = POSES[shown]
  if (input.snap) {
    sim.P = { ...target }
    const g = input.glance ?? gazeTarget(shown, t, null)
    sim.L = { ...g }
  } else {
    const k = 1 - Math.exp(-dt * 8)
    for (const key of POSE_KEYS) sim.P[key] += (target[key] - sim.P[key]) * k
  }

  sim.hv -= 1500 * dt
  sim.hy += sim.hv * dt
  if (sim.hy < 0) {
    if (sim.hv < -200 && !reduced) sim.sq = -Math.min(0.2, -sim.hv / 2500)
    sim.hy = 0
    sim.hv = 0
  }
  sim.sqv += (-220 * sim.sq - 11 * sim.sqv) * dt
  sim.sq += sim.sqv * dt
  if (shown === 'happy' && sim.hy === 0 && t > sim.nextHop && !reduced && variant !== 'avatar') {
    sim.hv = 400
    sim.nextHop = t + 1.25
  }

  const blinkDur = shown === 'sleepy' ? 0.42 : 0.17
  if (t > sim.nextBlink && sim.blinkU < 0 && shown !== 'permission') {
    sim.blinkU = 0
    const gap = shown === 'sleepy' ? 4.2 + rnd() * 2.4 : 2.2 + rnd() * 3
    sim.nextBlink = t + gap
    if (shown !== 'sleepy' && rnd() < 0.2) sim.nextBlink = t + 0.35
  }
  if (sim.blinkU >= -0.001 && sim.blinkU < 1) sim.blinkU += dt / blinkDur
  if (sim.blinkU >= 1) sim.blinkU = -1
  const close = shown === 'sleepy' ? 0.98 : 0.93
  const bm = sim.blinkU >= 0 ? 1 - Math.sin(Math.max(0, sim.blinkU) * Math.PI) * close : 1

  if (input.pointer && input.hover) {
    sim.ptr = input.pointer
    sim.ptrT = t
  }
  const scripted = shown !== 'idle' && shown !== 'happy' && shown !== 'notification'
  let tx: number
  let ty: number
  if (scripted) {
    const g = gazeTarget(shown === 'writing' && input.caret != null ? 'idle' : shown, t, null)
    if (shown === 'writing' && input.caret != null) {
      tx = -0.85 + clamp(input.caret, 0, 1) * 1.7
      ty = 0.22
    } else {
      tx = g.x
      ty = g.y
    }
  } else if (t - sim.ptrT < 2.6) {
    tx = sim.ptr.x
    ty = sim.ptr.y
  } else {
    if (t > sim.nextSac) {
      sim.sac = { x: (rnd() * 2 - 1) * 0.9, y: (rnd() * 2 - 1) * 0.55 }
      sim.nextSac = t + 1 + rnd() * 2.2
    }
    tx = sim.sac.x
    ty = sim.sac.y
  }
  const lookRate = shown === 'working' ? 10 : shown === 'searching' || shown === 'reading' ? 22 : shown === 'permission' ? 6 : 16
  if (input.snap) {
    sim.L = { x: tx, y: ty }
  } else {
    const kl = 1 - Math.exp(-dt * lookRate)
    sim.L.x += (tx - sim.L.x) * kl
    sim.L.y += (ty - sim.L.y) * kl
  }
  if (input.glance && input.snap) sim.L = { ...input.glance }

  const ampScale = (reduced ? 0.3 : 1) * (variant === 'avatar' ? 0.65 : 1)
  const A = sim.P.amp * ampScale
  const pts: Array<[number, number]> = []
  for (let i = 0; i < N; i += 1) {
    const a = (i / N) * 6.2832
    const s = Math.sin(a)
    const c = Math.cos(a)
    const w = Math.sin(t * sim.P.spd * (0.8 + 0.13 * i) + i * 1.9) * A
    const br = 1 + 0.012 * Math.sin(t * 1.6)
    pts.push([
      CX + (124 + w) * (1 + 0.07 * s) * br * c + sim.L.x * 7 * Math.max(0, -s),
      CY + (108 + w) * br * s,
    ])
  }
  const d = bodyPath(pts)
  const wide = t < sim.wideUntil ? 1.28 : 1
  const sy = sim.P.sy0 * (1 + sim.sq + clamp(sim.hv / 2600, -0.1, 0.16))
  const sx = 1 - (sy - 1) * 0.7
  let by = sim.P.bob * (reduced ? 0.3 : 1) * Math.sin(t * sim.P.bs)
  if (shown === 'reading') {
    const lineT = (t % 0.7) / 0.7
    by += Math.sin(lineT * Math.PI) * (reduced ? 1.1 : 3.6)
  }
  const lean = shown === 'searching' ? (reduced ? 3 : 10) : 0
  const shake = t < sim.shakeUntil ? Math.sin(t * 60) * (reduced ? 2 : 6) * ((sim.shakeUntil - t) / 0.5) : 0
  const tl = sim.P.tilt + sim.L.x * 3
  const group = `translate(${200 + shake},${330 - sim.hy - by - lean}) rotate(${tl}) scale(${sx},${sy}) translate(-200,-330)`
  const face = `translate(${200 + sim.L.x * 11},${215 + sim.L.y * 7})`
  const wb = shown === 'working'
    ? Math.sin(t * 3.2) * 16
    : shown === 'benchmark'
      ? Math.sin(t * 8) * 12
      : Math.sin(t * 1.3) * 3
  const spin = shown === 'dizzy' ? t * 640 : 0
  const eo = sim.P.es * sim.P.op * bm * wide
  const winkL = t < sim.winkUntil ? 0.12 : 1
  const eyeL = `translate(${-40 + sim.L.x * 10},${-8 + sim.L.y * 8}) rotate(${sim.P.erl + sim.L.x * 14 + wb + spin}) scale(${sim.P.es * wide},${eo * sim.P.ehl * winkL})`
  const eyeR = `translate(${40 + sim.L.x * 10},${-8 + sim.L.y * 8}) rotate(${sim.P.err + sim.L.x * 14 - wb * 0.6 - spin * 0.8}) scale(${sim.P.es * wide},${eo * sim.P.ehr})`

  for (let i = sim.sparks.length - 1; i >= 0; i -= 1) {
    const p = sim.sparks[i]!
    p.vy += 300 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
    if (p.life <= 0) sim.sparks.splice(i, 1)
  }
  if (reduced) sim.sparks.length = 0

  const glint = shown === 'searching' ? 0.35 + 0.65 * Math.abs(Math.sin(t * 7.5)) : 0
  return {
    d,
    group,
    face,
    eyeL,
    eyeR,
    shadowRx: 90 * (1 - sim.hy / 300),
    shadowOp: 0.18 * (1 - sim.hy / 260),
    glint: variant === 'avatar' ? 0 : glint,
    showSpark: variant === 'full' && !reduced,
    showGlow: variant === 'full',
    showShadow: variant !== 'avatar',
    showHighlight: variant !== 'avatar',
  }
}

/** Spread of the spline at time t. Reduced motion keeps a smaller wobble. */
export function bodySpread(state: string, t: number, reduced: boolean): number {
  const sim = createSim()
  sim.P = { ...poseFor(state) }
  sim.cur = blobStateFor(state)
  sim.entered = true
  const draw = advance(sim, t, 0, { state, reduced, variant: 'full', snap: true, random: () => 0.5 })
  const nums = draw.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  let max = 0
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const dx = (nums[i] ?? CX) - CX
    const dy = (nums[i + 1] ?? CY) - CY
    max = Math.max(max, Math.hypot(dx, dy))
  }
  return max
}

export function markSvg(): string {
  const sim = createSim()
  const pal = paletteFor(DEFAULT_BLOB_COLOR)
  const draw = advance(sim, 0.35, 0, {
    state: 'idle',
    reduced: false,
    variant: 'mark',
    snap: true,
    glance: { x: 0.18, y: -0.12 },
    random: () => 0.4,
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.top}"/>
      <stop offset="1" stop-color="${pal.bottom}"/>
    </linearGradient>
    <radialGradient id="gh" cx="0.3" cy="0.22" r="0.55">
      <stop offset="0" stop-color="#fff" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="200" cy="374" rx="${draw.shadowRx.toFixed(2)}" ry="11" fill="#000" opacity="${draw.shadowOp.toFixed(3)}"/>
  <g transform="${draw.group}">
    <path d="${draw.d}" fill="url(#gb)"/>
    <path d="${draw.d}" fill="url(#gh)"/>
    <g transform="${draw.face}">
      <g transform="${draw.eyeL}"><rect x="-9" y="-23" width="18" height="46" rx="9" fill="${pal.eye}"/></g>
      <g transform="${draw.eyeR}"><rect x="-9" y="-23" width="18" height="46" rx="9" fill="${pal.eye}"/></g>
    </g>
  </g>
</svg>`
}

export const SPARK_PATH = SPARK_D
