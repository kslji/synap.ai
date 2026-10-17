import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  advance,
  bodyPath,
  bodySpread,
  createSim,
  DEFAULT_BLOB_COLOR,
  FILE_POSES,
  gazeTarget,
  markSvg,
  paletteFor,
  parseHex,
  poseFor,
  resolveBlobState,
} from './blob.ts'
import { MASCOT_MANIFEST, PIP_STATE_IDS, motionScale, pickClick, shouldAnimate } from './mascot.ts'

test('mascot stays silent and does not ship reference clips', () => {
  assert.equal(MASCOT_MANIFEST.audio, false)
  assert.equal(MASCOT_MANIFEST.shipReferenceClips, false)
  assert.equal(MASCOT_MANIFEST.engine, 'svg')
  assert.deepEqual(Object.keys(MASCOT_MANIFEST.states), [...PIP_STATE_IDS])
})

test('a tap picks one of the three reactions from the seed', () => {
  assert.equal(pickClick(0).id, 'poke-squash')
  assert.equal(pickClick(0.5).id, 'poke-dizzy')
  assert.equal(pickClick(0.99).id, 'wink')
  assert.equal(MASCOT_MANIFEST.clicks.length, 3)
})

test('the animate setting pauses the loop and reduced motion only shrinks it', () => {
  assert.equal(shouldAnimate(true, false), true)
  assert.equal(shouldAnimate(true, true), true)
  assert.equal(shouldAnimate(false, false), false)
  assert.equal(motionScale(false), 1)
  assert.equal(motionScale(true), 0.3)
  const full = bodySpread('idle', 0.8, false)
  const quiet = bodySpread('idle', 0.8, true)
  assert.ok(quiet < full)
})

test('the five reference poses keep their eye numbers', () => {
  assert.equal(FILE_POSES.thinking.erl, 78)
  assert.equal(FILE_POSES.thinking.tilt, -5)
  assert.equal(FILE_POSES.working.spd, 4)
  assert.equal(FILE_POSES.happy.ehl, 1.2)
  assert.equal(FILE_POSES.oops.sy0, 0.94)
  assert.equal(poseFor('error').erl, FILE_POSES.oops.erl)
  assert.equal(poseFor('success').ehl, FILE_POSES.happy.ehl)
})

test('eyes follow the task: up, across, down the page, and drooping', () => {
  assert.ok(gazeTarget('thinking', 0, null).y < -0.7)
  assert.ok(gazeTarget('thinking', 0, null).x < -0.5)
  const left = gazeTarget('searching', 0.209, null).x
  const right = gazeTarget('searching', 0.209 + Math.PI / 7.5, null).x
  assert.ok(left > 0.9)
  assert.ok(right < -0.9)
  const top = gazeTarget('reading', 0, null)
  const lower = gazeTarget('reading', 2.1, null)
  assert.ok(top.y < lower.y)
  assert.ok(top.x < 0)
  assert.equal(gazeTarget('oops', 1, null).y, 0.85)
  assert.ok(gazeTarget('typing', 0, null).y > 0.8)
  assert.ok(gazeTarget('permission', 3, { x: 1, y: 1 }).x < 0.5)
})

test('writing follows a caret and a hop only happens when motion is allowed', () => {
  const sim = createSim()
  const draw = advance(sim, 0.4, 0, { state: 'writing', reduced: false, variant: 'avatar', caret: 1, snap: true, random: () => 0.2 })
  assert.match(draw.eyeL, /translate\(/)
  assert.ok(gazeTarget('writing', 0.99, null).x > 0.5)
  const happy = createSim()
  advance(happy, 1, 0.016, { state: 'happy', reduced: false, variant: 'full', random: () => 0.3 })
  assert.ok(happy.hv > 0 || happy.sparks.length > 0)
  const still = createSim()
  advance(still, 1, 0.016, { state: 'happy', reduced: true, variant: 'full', random: () => 0.3 })
  assert.equal(still.sparks.length, 0)
  assert.equal(still.hv, 0)
})

test('three fast pokes spin the eyes and one poke squashes', () => {
  const sim = createSim()
  advance(sim, 1, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  assert.ok(sim.sq < 0)
  advance(sim, 1.2, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  advance(sim, 1.4, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  assert.ok(sim.dizzyUntil > 1.4)
  const spun = advance(sim, 1.5, 0.016, { state: 'idle', reduced: false, variant: 'full', random: () => 0.2 })
  assert.match(spun.eyeL, /rotate\([^)]*[1-9]/)
})

test('colour keeps the orange stops and lightens the eyes on a dark body', () => {
  const orange = paletteFor(DEFAULT_BLOB_COLOR)
  assert.equal(orange.top, '#ffc27a')
  assert.equal(orange.bottom, '#f2740f')
  assert.equal(orange.eye, '#2b1204')
  const dark = paletteFor('#111111')
  assert.equal(dark.eye, '#fff4e8')
  assert.notEqual(dark.bottom, orange.bottom)
  const blue = paletteFor('#3b82f6')
  const top = parseHex(blue.top)!
  const bottom = parseHex(blue.bottom)!
  assert.ok((top.r + top.g + top.b) > (bottom.r + bottom.g + bottom.b))
  assert.equal(paletteFor('nope').bottom, DEFAULT_BLOB_COLOR)
})

test('the body path closes and the static mark is the orange blob', () => {
  const path = bodyPath([[0, 0], [10, 0], [10, 10], [0, 10], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]])
  assert.ok(path.startsWith('M'))
  assert.ok(path.endsWith('Z'))
  assert.ok(path.includes('C'))
  const svg = markSvg()
  assert.match(svg, /#ffc27a/)
  assert.match(svg, /#f2740f/)
  assert.doesNotMatch(svg, /<video|star-surf|webm/i)
})

const repoRoot = join(new URL('.', import.meta.url).pathname, '../../..')

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function decodePng(buf: Buffer): Uint8Array {
  let off = 8
  let width = 0
  let height = 0
  let bit = 0
  let color = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bit = data[8] ?? 0
      color = data[9] ?? 0
      interlace = data[12] ?? 0
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bit !== 8 || interlace !== 0) throw new Error(`unsupported png bit ${bit} interlace ${interlace}`)
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : color === 4 ? 2 : 0
  if (!channels) throw new Error(`unsupported png color ${color}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let src = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src++] ?? 0
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src++] ?? 0
      const a = i >= channels ? row[i - channels]! : 0
      const b = prev[i] ?? 0
      const c = i >= channels ? prev[i - channels]! : 0
      let v = x
      if (filter === 1) v = (x + a) & 255
      else if (filter === 2) v = (x + b) & 255
      else if (filter === 3) v = (x + Math.floor((a + b) / 2)) & 255
      else if (filter === 4) v = (x + paeth(a, b, c)) & 255
      else if (filter !== 0) throw new Error(`png filter ${filter}`)
      row[i] = v
    }
    prev = row
    for (let x = 0; x < width; x += 1) {
      const i = x * channels
      const o = (y * width + x) * 4
      if (channels >= 3) {
        rgba[o] = row[i]!
        rgba[o + 1] = row[i + 1]!
        rgba[o + 2] = row[i + 2]!
        rgba[o + 3] = channels === 4 ? row[i + 3]! : 255
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i]!
        rgba[o + 3] = channels === 2 ? row[i + 1]! : 255
      }
    }
  }
  return rgba
}

function pngChunks(buf: Buffer): Buffer[] {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const out: Buffer[] = []
  let start = 0
  while (start < buf.length) {
    const at = buf.indexOf(sig, start)
    if (at < 0) break
    let off = at + 8
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off)
      const type = buf.toString('ascii', off + 4, off + 8)
      off += 12 + len
      if (type === 'IEND') break
    }
    out.push(buf.subarray(at, off))
    start = off
  }
  return out
}

function blobPixels(rgba: Uint8Array): { orange: number; eyes: number } {
  let orange = 0
  let eyes = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const a = rgba[i + 3] ?? 0
    if (a < 20) continue
    if (r > 200 && g > 60 && g < 190 && b < 90) orange += 1
    if (Math.abs(r - 43) < 25 && Math.abs(g - 18) < 20 && b < 30 && r > g && g >= b) eyes += 1
  }
  return { orange, eyes }
}

function textFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) textFiles(path, out)
    else if (/\.(tsx?|css|md|json|html)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

test('star mascot wording and star image files stay gone', () => {
  const banned = [/draws the star/i, /\bstar mascot\b/i, /star-surf/i, /StarSurf/, /click-spin/, /click-hop/, /click-spark/, /animation\/mp4/]
  const hits: string[] = []
  for (const path of [...textFiles(join(repoRoot, 'animation')), ...textFiles(join(repoRoot, 'packages/ui/src'))]) {
    const text = readFileSync(path, 'utf8')
    for (const pattern of banned) {
      if (pattern.test(text)) hits.push(`${path}: ${pattern}`)
    }
  }
  assert.deepEqual(hits, [])
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'animation/manifest.json'), 'utf8')) as { name?: string; referenceDir?: string }
  assert.equal(manifest.name, 'Pip')
  assert.equal(manifest.referenceDir, undefined)
  const iconDirs = ['apps/desktop/build', 'apps/desktop/resources', 'apps/web/public']
  const images: string[] = []
  for (const dir of iconDirs) {
    for (const name of readdirSync(join(repoRoot, dir))) {
      if (/star/i.test(name)) hits.push(name)
      if (/\.(png|ico|icns)$/i.test(name)) images.push(join(repoRoot, dir, name))
    }
  }
  assert.deepEqual(hits, [])
  assert.ok(images.length >= 7)
  for (const path of images) {
    const chunks = pngChunks(readFileSync(path))
    assert.ok(chunks.length > 0, path)
    for (const chunk of chunks) {
      const count = blobPixels(decodePng(chunk))
      assert.ok(count.orange >= 20 && count.eyes >= 2, `${path} orange ${count.orange} eyes ${count.eyes}`)
    }
  }
})

test('real cues outrank idle, and offline stays calm rather than an error', () => {
  assert.equal(resolveBlobState({ task: 'oops', permission: true, benchmark: true }), 'oops')
  assert.equal(resolveBlobState({ task: 'idle', permission: true, benchmark: true }), 'permission')
  assert.equal(resolveBlobState({ task: 'searching', benchmark: true }), 'benchmark')
  assert.equal(resolveBlobState({ task: 'searching' }), 'searching')
  assert.equal(resolveBlobState({ task: 'answering' }), 'writing')
  assert.equal(resolveBlobState({ task: 'idle', typing: true, offline: true, sleepy: true }), 'typing')
  assert.equal(resolveBlobState({ task: 'idle', offline: true, sleepy: true }), 'offline')
  assert.equal(resolveBlobState({ task: 'idle', sleepy: true }), 'sleepy')
  assert.equal(resolveBlobState({ task: 'error' }), 'oops')
  assert.notEqual(resolveBlobState({ task: 'idle', offline: true }), 'oops')
})
