/**
 * Pixel and text differences between two screenshots.
 * Counts come from this file. A model may only narrate the paragraph describeDiff returns.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'

export interface DiffFacts {
  width: number
  height: number
  changedPercent: number
  cells: string[]
  onlyLeft: string[]
  onlyRight: string[]
}

export async function diffImages(left: Buffer, right: Buffer, leftText = '', rightText = ''): Promise<DiffFacts> {
  const a = await loadImage(left)
  const b = await loadImage(right)
  const width = Math.max(1, a.width, b.width)
  const height = Math.max(1, a.height, b.height)
  const leftPx = pixels(a, width, height)
  const rightPx = pixels(b, width, height)
  const grid = 4
  const cellChanged = Array.from({ length: grid * grid }, () => 0)
  const cellTotal = Array.from({ length: grid * grid }, () => 0)
  let changed = 0
  const total = width * height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const diff = Math.abs((leftPx[i] ?? 0) - (rightPx[i] ?? 0))
        + Math.abs((leftPx[i + 1] ?? 0) - (rightPx[i + 1] ?? 0))
        + Math.abs((leftPx[i + 2] ?? 0) - (rightPx[i + 2] ?? 0))
      const col = Math.min(grid - 1, Math.floor((x * grid) / width))
      const row = Math.min(grid - 1, Math.floor((y * grid) / height))
      const cell = row * grid + col
      cellTotal[cell] = (cellTotal[cell] ?? 0) + 1
      if (diff > 48) {
        changed += 1
        cellChanged[cell] = (cellChanged[cell] ?? 0) + 1
      }
    }
  }
  const cells: string[] = []
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const cell = row * grid + col
      const seen = cellTotal[cell] ?? 0
      const hit = cellChanged[cell] ?? 0
      if (seen > 0 && hit / seen >= 0.15) cells.push(`${row},${col}`)
    }
  }
  const leftLines = uniqueLines(leftText)
  const rightLines = uniqueLines(rightText)
  return {
    width,
    height,
    changedPercent: Math.round((changed / total) * 1000) / 10,
    cells,
    onlyLeft: leftLines.filter((line) => !rightLines.includes(line)).slice(0, 8),
    onlyRight: rightLines.filter((line) => !leftLines.includes(line)).slice(0, 8),
  }
}

export function describeDiff(facts: DiffFacts): string {
  const lines = [
    `Screenshot comparison measured on this computer: ${facts.width}x${facts.height}, ${facts.changedPercent}% of pixels differ.`,
  ]
  if (facts.cells.length) lines.push(`Changed areas (row,column on a 4x4 grid): ${facts.cells.join(' ')}.`)
  if (facts.onlyLeft.length) lines.push(`Text only in the first screenshot: ${facts.onlyLeft.join(' | ')}.`)
  if (facts.onlyRight.length) lines.push(`Text only in the second screenshot: ${facts.onlyRight.join(' | ')}.`)
  return lines.join('\n')
}

function pixels(image: Awaited<ReturnType<typeof loadImage>>, width: number, height: number): Uint8ClampedArray {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, width, height).data
}

function uniqueLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line && !out.includes(line)) out.push(line)
  }
  return out
}
