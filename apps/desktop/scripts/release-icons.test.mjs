// Release assets: the installer icons must be real, correctly-sized, and wired
// into electron-builder. This guard needs no PIL and no electron-builder run — it
// parses the ICO/ICNS/PNG binaries directly and reads the config as text, so it
// runs anywhere `test:unit` runs (Node 20/22). It exists because win.icon had been
// pointed at the generic PNG with a comment claiming the checked-in ICO was only
// 32px, when the ICO is in fact a full 7-frame set including the 256px frame that
// electron-builder requires. The guard fails if an icon regresses to a too-small
// asset or the config stops referencing the per-OS files.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

// ---- pure binary parsers -------------------------------------------------

export function pngDims(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < sig.length; i++) assert.equal(buf[i], sig[i], 'not a PNG')
  // IHDR is the first chunk: 4 len, 'IHDR', then width(4) height(4).
  assert.equal(buf.slice(12, 16).toString('latin1'), 'IHDR')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export function icoFrames(buf) {
  assert.equal(buf.readUInt16LE(0), 0, 'ICO reserved')
  assert.equal(buf.readUInt16LE(2), 1, 'ICO type')
  const count = buf.readUInt16LE(4)
  const frames = []
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    const w = buf.readUInt8(off) || 256
    const h = buf.readUInt8(off + 1) || 256
    frames.push({ w, h })
  }
  return frames
}

export function icnsTypes(buf) {
  assert.equal(buf.slice(0, 4).toString('latin1'), 'icns')
  const out = []
  let off = 8
  while (off + 8 <= buf.length) {
    const type = buf.slice(off, off + 4).toString('latin1')
    const size = buf.readUInt32BE(off + 4)
    if (size < 8 || off + size > buf.length) break
    out.push(type)
    off += size
  }
  return out
}

// electron-builder accepts an ICO only if it carries a 256px frame.
export function icoAcceptable(buf) {
  return icoFrames(buf).some((f) => f.w >= 256 && f.h >= 256)
}

// The macOS .icns must carry the 512px variants for a retina installer.
export function icnsAcceptable(buf) {
  const types = icnsTypes(buf)
  return types.includes('ic10') && types.includes('ic14')
}

// ---- config wiring (read as text; importing the .cjs would need electron) --

// Extract the top-level object for a block (`win: { ... }`) by brace matching, so
// an icon in a sibling block is never mistaken for this block's icon.
function blockBody(src, block) {
  const head = src.match(new RegExp(`${block}:\\s*\\{`))
  if (!head || head.index === undefined) return null
  let depth = 0
  const start = head.index + head[0].length - 1 // index of the opening '{'
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start + 1, i)
    }
  }
  return null
}

export function iconPathsFromConfig(src) {
  const grab = (block) => {
    const body = blockBody(src, block)
    if (!body) return null
    const m = body.match(/icon:\s*'([^']+)'/)
    return m ? m[1] : null
  }
  return { win: grab('win'), mac: grab('mac'), linux: grab('linux') }
}

// ---- checks over the real, checked-in assets -----------------------------

function assertRealAssets() {
  const cfg = iconPathsFromConfig(readFileSync(join(ROOT, 'electron-builder.cjs'), 'utf8'))
  // Wiring: each OS points at its purpose-built file, not the generic PNG.
  assert.equal(cfg.win, 'build/icon.ico', 'win.icon should use the multi-size ICO')
  assert.equal(cfg.mac, 'build/icon.icns', 'mac.icon should use the ICNS')

  const png = pngDims(readFileSync(join(ROOT, 'build/icon.png')))
  assert.ok(png.width >= 512 && png.height >= 512, `icon.png too small: ${png.width}x${png.height}`)

  const icoBuf = readFileSync(join(ROOT, 'build/icon.ico'))
  assert.ok(icoAcceptable(icoBuf), `icon.ico has no 256px frame: ${JSON.stringify(icoFrames(icoBuf))}`)

  const icnsBuf = readFileSync(join(ROOT, 'build/icon.icns'))
  assert.ok(icnsAcceptable(icnsBuf), `icon.icns missing 512 variants: ${icnsTypes(icnsBuf).join(',')}`)

  // resources/icon.png (bundled at runtime) must match the build source.
  const res = pngDims(readFileSync(join(ROOT, 'resources/icon.png')))
  assert.deepEqual(res, png, 'resources/icon.png differs from build/icon.png')
}

test('release icon assets are valid and wired per-OS in electron-builder', () => {
  assertRealAssets()
})

test('icon parsers reject undersized or malformed assets', () => {
  // A 32px-only ICO (the shape the stale comment feared) must be rejected.
  const smallIco = Buffer.alloc(6 + 16)
  smallIco.writeUInt16LE(0, 0)
  smallIco.writeUInt16LE(1, 2)
  smallIco.writeUInt16LE(1, 4) // one entry
  smallIco.writeUInt8(32, 6)
  smallIco.writeUInt8(32, 7)
  assert.equal(icoAcceptable(smallIco), false)
  assert.deepEqual(icoFrames(smallIco), [{ w: 32, h: 32 }])

  // A 256px frame is accepted; the byte 0 encodes 256.
  const bigIco = Buffer.alloc(6 + 16)
  bigIco.writeUInt16LE(1, 2) // type = icon
  bigIco.writeUInt16LE(1, 4)
  bigIco.writeUInt8(0, 6) // 0 => 256
  bigIco.writeUInt8(0, 7)
  assert.equal(icoAcceptable(bigIco), true)

  // ICNS without the 512 variants is rejected.
  const icns = Buffer.concat([
    Buffer.from('icns', 'latin1'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(8 + 12, 0); return b })(),
    Buffer.from('ic07', 'latin1'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(12, 0); return b })(),
    Buffer.alloc(4),
  ])
  assert.deepEqual(icnsTypes(icns), ['ic07'])
  assert.equal(icnsAcceptable(icns), false)
})

test('config parser reads win/mac/linux icon paths from source text', () => {
  const parsed = iconPathsFromConfig(
    "const config = { win: { icon: 'build/a.ico' }, mac: { icon: 'build/b.icns' }, linux: { icon: 'build/c.png' } }",
  )
  assert.deepEqual(parsed, { win: 'build/a.ico', mac: 'build/b.icns', linux: 'build/c.png' })
  assert.deepEqual(iconPathsFromConfig('const config = { win: { target: [] } }'), {
    win: null,
    mac: null,
    linux: null,
  })
})
