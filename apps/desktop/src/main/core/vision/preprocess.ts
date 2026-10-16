/**
 * Screenshot bytes in, a smaller PNG or JPEG out.
 * Format sniff, aspect-preserving resize, EXIF removal, and a byte cap live here
 * so a later Gemma path can reuse them without the Code agent.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { limitsForFamily, type VisionLimits } from './limits.js'

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'
export type EncodedMime = 'image/png' | 'image/jpeg'

export interface PreparedImage {
  bytes: Buffer
  mime: EncodedMime
  width: number
  height: number
  sourceMime: ImageMime
  strippedExif: boolean
}

export function sniffImage(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function exifPresent(bytes: Buffer): boolean {
  const latin = bytes.toString('latin1')
  return latin.includes('Exif\u0000\u0000') || latin.includes('eXIf')
}

/** Drop JPEG APP1 Exif segments. The image scan that follows is left as-is. */
export function jpegWithoutExif(bytes: Buffer): { bytes: Buffer; stripped: boolean } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { bytes, stripped: false }
  const parts: Buffer[] = [bytes.subarray(0, 2)]
  let i = 2
  let stripped = false
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      parts.push(bytes.subarray(i))
      break
    }
    const marker = bytes[i + 1] ?? 0
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(bytes.subarray(i))
      break
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (i + 4 > bytes.length) {
      parts.push(bytes.subarray(i))
      break
    }
    const len = bytes.readUInt16BE(i + 2)
    const end = i + 2 + len
    if (len < 2 || end > bytes.length) {
      parts.push(bytes.subarray(i))
      break
    }
    const header = bytes.subarray(i + 4, Math.min(end, i + 10)).toString('latin1')
    const isExif = marker === 0xe1 && header.startsWith('Exif\u0000\u0000')
    if (isExif) stripped = true
    else parts.push(bytes.subarray(i, end))
    i = end
  }
  return { bytes: stripped ? Buffer.concat(parts) : bytes, stripped }
}

/** Longest edge at or under maxEdge. Both sides stay at least 1. Aspect is unchanged aside from rounding. */
export function targetSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width))
  const safeH = Math.max(1, Math.round(height))
  const edge = Math.max(safeW, safeH)
  const cap = Math.max(1, Math.round(maxEdge))
  if (edge <= cap) return { width: safeW, height: safeH }
  const scale = cap / edge
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  }
}

export async function preprocessImage(input: Buffer, limits: VisionLimits = limitsForFamily('qwen3.5')): Promise<PreparedImage> {
  const sourceMime = sniffImage(input)
  if (!sourceMime) throw new Error('Unsupported screenshot. Use PNG, JPEG, or WebP.')
  const stripped = sourceMime === 'image/jpeg' ? jpegWithoutExif(input) : { bytes: input, stripped: false }
  const image = await loadImage(stripped.bytes)
  let edge = limits.maxEdge
  let size = targetSize(image.width, image.height, edge)
  let encoded = encode(image, size, 'image/png')
  let mime: EncodedMime = 'image/png'
  if (encoded.length > limits.maxBytes) {
    for (const quality of [80, 60, 40]) {
      const jpeg = encode(image, size, 'image/jpeg', quality)
      if (jpeg.length < encoded.length) {
        encoded = jpeg
        mime = 'image/jpeg'
      }
      if (encoded.length <= limits.maxBytes) break
    }
  }
  while (encoded.length > limits.maxBytes && Math.max(size.width, size.height) > 64) {
    edge = Math.max(64, Math.floor(edge * 0.8))
    size = targetSize(image.width, image.height, edge)
    encoded = encode(image, size, 'image/jpeg', 50)
    mime = 'image/jpeg'
  }
  return {
    bytes: encoded,
    mime,
    width: size.width,
    height: size.height,
    sourceMime,
    strippedExif: stripped.stripped || exifPresent(input),
  }
}

function encode(
  image: Awaited<ReturnType<typeof loadImage>>,
  size: { width: number; height: number },
  mime: EncodedMime,
  quality = 80,
): Buffer {
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(image, 0, 0, size.width, size.height)
  if (mime === 'image/jpeg') return canvas.toBuffer('image/jpeg', quality)
  return canvas.toBuffer('image/png')
}
