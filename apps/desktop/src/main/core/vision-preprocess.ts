/**
 * Image prep before OCR or the vision projector.
 * Long edge is capped, aspect is kept, EXIF is removed, and the bytes are capped.
 * png, jpeg, and webp are accepted. The result is png, or jpeg when that is smaller.
 */
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'

/** Qwen3.5 mmproj is sent one image. The long side stays at this edge. */
export const QWEN_VISION_MAX_EDGE = 1024
export const QWEN_VISION_MAX_BYTES = 1_200_000

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

export interface PreparedImage {
  mime: 'image/png' | 'image/jpeg'
  bytes: Buffer
  width: number
  height: number
}

export function fitBox(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const edge = Math.max(1, Math.round(maxEdge))
  const long = Math.max(w, h)
  if (long <= edge) return { width: w, height: h }
  const scale = edge / long
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

export function normalizeImageMime(mime: string): ImageMime | null {
  const value = mime.toLowerCase().split(';')[0].trim()
  if (value === 'image/png') return 'image/png'
  if (value === 'image/jpg' || value === 'image/jpeg') return 'image/jpeg'
  if (value === 'image/webp') return 'image/webp'
  return null
}

/** Drop the JPEG APP1 Exif segment. Other markers stay. */
export function stripJpegExif(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input
  const parts: Buffer[] = [input.subarray(0, 2)]
  let i = 2
  while (i + 2 <= input.length) {
    if (input[i] !== 0xff) {
      parts.push(input.subarray(i))
      break
    }
    const marker = input[i + 1]
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(input.subarray(i))
      break
    }
    if (i + 4 > input.length) {
      parts.push(input.subarray(i))
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(input.subarray(i, i + 2))
      i += 2
      continue
    }
    const size = input.readUInt16BE(i + 2)
    if (size < 2 || i + 2 + size > input.length) {
      parts.push(input.subarray(i))
      break
    }
    const payload = input.subarray(i + 4, i + 2 + size)
    const exif = marker === 0xe1 && payload.subarray(0, 6).toString('latin1') === 'Exif\0\0'
    if (!exif) parts.push(input.subarray(i, i + 2 + size))
    i += 2 + size
  }
  return Buffer.concat(parts)
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Drop a PNG eXIf chunk. Other chunks stay, including their checksums. */
export function stripPngExif(input: Buffer): Buffer {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIG)) return input
  const parts: Buffer[] = [input.subarray(0, 8)]
  let i = 8
  while (i + 8 <= input.length) {
    const len = input.readUInt32BE(i)
    const type = input.subarray(i + 4, i + 8).toString('latin1')
    const end = i + 12 + len
    if (end > input.length) {
      parts.push(input.subarray(i))
      break
    }
    if (type !== 'eXIf') parts.push(input.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  return Buffer.concat(parts)
}

export function stripImageExif(input: Buffer, mime: ImageMime): Buffer {
  if (mime === 'image/jpeg') return stripJpegExif(input)
  if (mime === 'image/png') return stripPngExif(input)
  return input
}

function drawFitted(image: Awaited<ReturnType<typeof loadImage>>, edge: number): { canvas: Canvas; width: number; height: number } {
  const box = fitBox(image.width, image.height, edge)
  const canvas = createCanvas(box.width, box.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, box.width, box.height)
  ctx.drawImage(image, 0, 0, box.width, box.height)
  return { canvas, width: box.width, height: box.height }
}

export async function preprocessImage(
  input: Buffer,
  mime: string,
  opts?: { maxEdge?: number; maxBytes?: number },
): Promise<PreparedImage> {
  const kind = normalizeImageMime(mime)
  if (!kind) throw new Error('Use a PNG, JPEG, or WebP image.')
  const maxEdge = opts?.maxEdge ?? QWEN_VISION_MAX_EDGE
  const maxBytes = opts?.maxBytes ?? QWEN_VISION_MAX_BYTES
  const stripped = stripImageExif(input, kind)
  const image = await loadImage(stripped)
  let edge = maxEdge
  let drawn = drawFitted(image, edge)
  let bytes = drawn.canvas.toBuffer('image/png')
  let outMime: PreparedImage['mime'] = 'image/png'
  let quality = 80
  while (bytes.length > maxBytes && edge > 64) {
    if (outMime === 'image/png') {
      bytes = drawn.canvas.toBuffer('image/jpeg', quality)
      outMime = 'image/jpeg'
      continue
    }
    if (quality > 45) {
      quality -= 15
      bytes = drawn.canvas.toBuffer('image/jpeg', quality)
      continue
    }
    edge = Math.max(64, Math.round(edge * 0.75))
    drawn = drawFitted(image, edge)
    quality = 70
    bytes = drawn.canvas.toBuffer('image/jpeg', quality)
  }
  const clean = outMime === 'image/jpeg' ? stripJpegExif(bytes) : stripPngExif(bytes)
  return { mime: outMime, bytes: clean, width: drawn.width, height: drawn.height }
}
