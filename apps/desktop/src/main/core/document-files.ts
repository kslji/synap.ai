/**
 * Read and write document copies. The input buffer is never written back.
 * DOCX edits replace the blank run and keep the surrounding run's font props.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import * as XLSX from 'xlsx'
import type { FillRow } from './document-blanks.js'
import { NOT_FOUND } from './document-blanks.js'

export interface RunProps {
  font: string
  sizeHalfPoints: number
  color: string
  bold: boolean
  italic: boolean
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function siblingCopyPath(sourcePath: string, ext: string): string {
  const dir = dirname(sourcePath)
  const base = basename(sourcePath, extname(sourcePath))
  const clean = ext.replace(/^\./, '')
  let full = join(dir, `${base}.${clean}`)
  if (resolve(full) === resolve(sourcePath)) full = join(dir, `${base}-copy.${clean}`)
  let n = 2
  while (existsSync(full)) {
    full = join(dir, `${base}-${n}.${clean}`)
    n += 1
  }
  return full
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function xmlUnescape(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

export function runPropsXml(props: RunProps): string {
  return `<w:rPr><w:rFonts w:ascii="${xmlEscape(props.font)}" w:hAnsi="${xmlEscape(props.font)}" w:cs="${xmlEscape(props.font)}"/>${props.bold ? '<w:b/>' : ''}${props.italic ? '<w:i/>' : ''}<w:color w:val="${props.color}"/><w:sz w:val="${props.sizeHalfPoints}"/><w:szCs w:val="${props.sizeHalfPoints}"/></w:rPr>`
}

export function readRunProps(xml: string): RunProps | null {
  const block = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
  if (!block) return null
  const font = block[0].match(/w:ascii="([^"]+)"/)?.[1] ?? ''
  const size = Number(block[0].match(/<w:sz w:val="(\d+)"/)?.[1] ?? 0)
  const color = block[0].match(/<w:color w:val="([^"]+)"/)?.[1] ?? ''
  return { font, sizeHalfPoints: size, color, bold: /<w:b\/>/.test(block[0]), italic: /<w:i\/>/.test(block[0]) }
}

export async function buildDocx(paragraphs: { text: string; props: RunProps }[], extra = ''): Promise<Buffer> {
  const body = paragraphs.map((paragraph) => `<w:p><w:r>${runPropsXml(paragraph.props)}<w:t xml:space="preserve">${xmlEscape(paragraph.text)}</w:t></w:r></w:p>`).join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${extra}<w:sectPr/></w:body></w:document>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', document)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

export async function docxXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('This Word file has no document.xml.')
  return file.async('string')
}

export async function fillDocx(bytes: Buffer, rows: FillRow[], highlight: boolean): Promise<Buffer> {
  const original = Buffer.from(bytes)
  const zip = await JSZip.loadAsync(original)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('This Word file has no document.xml.')
  let xml = await file.async('string')
  xml = xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => fillTableRow(row, rows, highlight))
  xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => fillParagraph(paragraph, rows, highlight))
  zip.file('word/document.xml', xml)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

function fillTableRow(row: string, rows: FillRow[], highlight: boolean): string {
  const cells = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((match) => match[0])
  if (cells.length < 2) return row
  const label = textOf(cells[0]).trim()
  const hit = rows.find((item) => item.label.toLowerCase() === label.toLowerCase() && item.found)
  if (!hit || textOf(cells[1]).trim()) return row
  const props = readRunProps(cells[0])
  const rPr = props ? runPropsXml(props) : (cells[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '')
  const valueXml = `<w:r>${highlight ? withHighlight(rPr) : rPr}<w:t xml:space="preserve">${xmlEscape(hit.value)}</w:t></w:r>`
  const nextCell = /<w:r\b/.test(cells[1])
    ? cells[1].replace(/<w:r\b[\s\S]*?<\/w:r>/, valueXml)
    : cells[1].replace(/<\/w:p>/, `${valueXml}</w:p>`)
  return row.replace(cells[1], nextCell)
}

function fillParagraph(paragraph: string, rows: FillRow[], highlight: boolean): string {
  if (paragraph.includes('<w:tc') || paragraph.includes('<w:tr')) return paragraph
  const plain = textOf(paragraph)
  const hit = rows.find((item) => item.found && plain.toLowerCase().includes(item.label.toLowerCase()) && /_{2,}|\[\s*\]|\[blank\]|\(fill\)/i.test(plain))
  if (!hit) return paragraph
  return paragraph.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/, (run) => {
    const text = textOf(run)
    if (!/_{2,}|\[\s*\]|\[blank\]|\(fill\)/i.test(text)) return run
    const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ''
    const token = text.match(/_{2,}|\[\s*\]|\[blank\]|\(fill\)/i)
    if (!token) return run
    const prefix = text.slice(0, token.index ?? 0)
    const suffix = text.slice((token.index ?? 0) + token[0].length)
    const valueProps = highlight ? withHighlight(rPr) : rPr
    const valueRun = `<w:r>${valueProps}<w:t xml:space="preserve">${xmlEscape(hit.value)}</w:t></w:r>`
    const prefixRun = prefix ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(prefix)}</w:t></w:r>` : ''
    const suffixRun = suffix ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(suffix)}</w:t></w:r>` : ''
    return prefixRun + valueRun + suffixRun
  })
}

function withHighlight(rPr: string): string {
  if (!rPr) return '<w:rPr><w:highlight w:val="yellow"/></w:rPr>'
  if (rPr.includes('<w:highlight')) return rPr
  return rPr.replace('</w:rPr>', '<w:highlight w:val="yellow"/></w:rPr>')
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => xmlUnescape(match[1])).join('')
}

export function paragraphXml(xml: string): string[] {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => match[0])
}

export async function buildPlainPdf(lines: { text: string; x: number; y: number; size: number }[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const line of lines) page.drawText(line.text, { x: line.x, y: line.y, size: line.size, font, color: rgb(0.08, 0.08, 0.08) })
  return Buffer.from(await doc.save())
}

export interface PdfItem {
  page: number
  str: string
  x: number
  y: number
  size: number
  fontName: string
  width: number
}

export async function pdfItems(bytes: Buffer): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as {
    getDocument: (src: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<PdfJsPage>; destroy?: () => Promise<void> }> }
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, useSystemFonts: true })
  const doc = await task.promise
  const items: PdfItem[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const transform = item.transform
        const size = Math.abs(transform[3] || transform[0] || 0)
        items.push({ page: pageNo, str: item.str, x: transform[4], y: transform[5], size, fontName: item.fontName, width: item.width })
      }
      page.cleanup?.()
    }
  } finally {
    await doc.destroy?.()
  }
  return items
}

interface PdfJsPage {
  getTextContent: () => Promise<{ items: { str?: string; transform: number[]; width: number; fontName: string }[] }>
  getViewport: (opts: { scale: number }) => { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] }
  render: (opts: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> }
  cleanup?: () => void
}

export async function fillPlainPdf(bytes: Buffer, rows: FillRow[]): Promise<{ bytes: Buffer; shrunk: boolean; warnings: string[]; placements: { label: string; size: number; font: string }[] }> {
  const doc = await PDFDocument.load(bytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const items = await pdfItems(bytes)
  let shrunk = false
  const warnings: string[] = []
  const placements: { label: string; size: number; font: string }[] = []
  for (const item of items) {
    if (!/_{2,}/.test(item.str)) continue
    const previous = items.filter((other) => other.page === item.page && Math.abs(other.y - item.y) < 2 && other.x < item.x && other.str.trim()).sort((a, b) => b.x - a.x)[0]
    const label = (previous?.str ?? item.str).replace(/[:：]?\s*_{2,}.*/, '').replace(/[:：]\s*$/, '').trim()
    const hit = rows.find((row) => row.found && row.label.toLowerCase() === label.toLowerCase())
    if (!hit || hit.value === NOT_FOUND) continue
    const page = doc.getPage(item.page - 1)
    const fontName = item.fontName.toLowerCase()
    if (!/helvetica|arial|times|courier/.test(fontName) && !warnings.some((line) => line.includes('Helvetica'))) {
      warnings.push(`The nearby text uses ${item.fontName}. Helvetica is the closest standard font at the same size.`)
    }
    let size = item.size || 12
    const width = Math.max(item.width, size * 4)
    while (font.widthOfTextAtSize(hit.value, size) > width && size > 6) {
      size -= 0.5
      shrunk = true
    }
    page.drawRectangle({ x: item.x, y: item.y - 1, width: item.width + 2, height: (item.size || 12) + 2, color: rgb(1, 1, 1) })
    const drawn = font.widthOfTextAtSize(hit.value, size) > width ? `${hit.value.slice(0, 12)}…` : hit.value
    placements.push({ label: hit.label, size, font: 'Helvetica' })
    page.drawText(drawn, { x: item.x, y: item.y, size, font, color: rgb(0.08, 0.08, 0.08) })
    if (drawn !== hit.value) {
      appendOverflow(doc, font, hit)
      warnings.push(`"${hit.label}" did not fit on the line. The full answer is in the overflow notes.`)
    }
  }
  return { bytes: Buffer.from(await doc.save()), shrunk, warnings, placements }
}

function appendOverflow(doc: PDFDocument, font: PDFFont, hit: FillRow): void {
  const page = doc.addPage([612, 792])
  page.drawText('Overflow notes', { x: 72, y: 740, size: 16, font })
  page.drawText(`${hit.label}: ${hit.value}`, { x: 72, y: 710, size: 12, font })
}

export async function buildAcroPdf(fieldName: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Berth', { x: 72, y: 700, size: 12, font })
  const form = doc.getForm()
  const field = form.createTextField(fieldName)
  field.addToPage(page, { x: 140, y: 694, width: 160, height: 18 })
  field.setFontSize(12)
  form.updateFieldAppearances(font)
  return Buffer.from(await doc.save())
}

export async function fillAcroPdf(bytes: Buffer, rows: FillRow[], flatten: boolean): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()
  for (const field of form.getFields()) {
    const hit = rows.find((row) => row.label.toLowerCase() === field.getName().toLowerCase())
    if (!hit?.found) continue
    const text = form.getTextField(field.getName())
    text.setText(hit.value)
    text.setFontSize(12)
  }
  form.updateFieldAppearances(font)
  if (flatten) form.flatten()
  return Buffer.from(await doc.save())
}

export async function renderPdfPage(bytes: Buffer, pageNo = 1): Promise<Buffer> {
  const g = globalThis as unknown as Record<string, unknown>
  const canvasMod = await import('@napi-rs/canvas')
  if (!g.DOMMatrix) g.DOMMatrix = canvasMod.DOMMatrix
  if (!g.ImageData) g.ImageData = canvasMod.ImageData
  if (!g.Path2D) g.Path2D = canvasMod.Path2D
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as {
    getDocument: (src: Record<string, unknown>) => { promise: Promise<{ getPage: (n: number) => Promise<PdfJsPage>; destroy?: () => Promise<void> }> }
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: false, isEvalSupported: false, useSystemFonts: true })
  const doc = await task.promise
  try {
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
    return canvas.toBuffer('image/png')
  } finally {
    await doc.destroy?.()
  }
}

export function boxForItem(item: PdfItem, pageHeight = 792): { x: number; y: number; w: number; h: number } {
  return { x: Math.floor(item.x), y: Math.floor(pageHeight - item.y - item.size), w: Math.ceil(item.width), h: Math.ceil(item.size) + 2 }
}

export async function pixelDiffOutside(before: Buffer, after: Buffer, box: { x: number; y: number; w: number; h: number }, pad = 6): Promise<{ outside: number; changed: number }> {
  const a = await loadImage(before)
  const b = await loadImage(after)
  if (a.width !== b.width || a.height !== b.height) return { outside: 1_000_000, changed: 0 }
  const ca = createCanvas(a.width, a.height)
  const cb = createCanvas(b.width, b.height)
  ca.getContext('2d').drawImage(a, 0, 0)
  cb.getContext('2d').drawImage(b, 0, 0)
  const da = ca.getContext('2d').getImageData(0, 0, a.width, a.height).data
  const db = cb.getContext('2d').getImageData(0, 0, b.width, b.height).data
  let outside = 0
  let changed = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      if (da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2]) continue
      changed += 1
      const inside = x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad
      if (!inside) outside += 1
    }
  }
  return { outside, changed }
}

export function sheetBytes(rows: string[][]): Buffer {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}

export function readSheet(bytes: Buffer): string[][] {
  const book = XLSX.read(bytes, { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][]
}

export function fillSheet(bytes: Buffer, rows: FillRow[]): Buffer {
  const grid = readSheet(bytes)
  for (let r = 0; r < grid.length; r++) {
    const label = String(grid[r][0] ?? '').trim()
    const hit = rows.find((item) => item.found && item.label.toLowerCase() === label.toLowerCase())
    if (!hit) continue
    const cell = String(grid[r][1] ?? '')
    if (cell.trim() && !/_{2,}|\[\s*\]|\(fill\)/i.test(cell)) continue
    grid[r][1] = hit.value
  }
  return sheetBytes(grid)
}

export function buildPngForm(): { bytes: Buffer; box: { x: number; y: number; w: number; h: number } } {
  const canvas = createCanvas(420, 140)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 420, 140)
  ctx.fillStyle = '#141414'
  ctx.font = '16px sans-serif'
  ctx.fillText('Berth', 24, 78)
  ctx.strokeStyle = '#d4d4d4'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(100, 82)
  ctx.lineTo(250, 82)
  ctx.stroke()
  return { bytes: canvas.toBuffer('image/png'), box: { x: 100, y: 60, w: 150, h: 28 } }
}

export async function detectBlankBoxes(bytes: Buffer): Promise<{ x: number; y: number; w: number; h: number }[]> {
  const image = await loadImage(bytes)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height).data
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  for (let y = 0; y < image.height; y++) {
    let run = 0
    let start = 0
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const light = data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180 && data[i] < 250
      if (light) {
        if (run === 0) start = x
        run += 1
      } else if (run > 40) {
        boxes.push({ x: start, y: Math.max(0, y - 18), w: run, h: 22 })
        run = 0
      } else run = 0
    }
  }
  return boxes.slice(0, 4)
}

export async function fillPng(bytes: Buffer, value: string, box: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const image = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(box.x, box.y, box.w, box.h)
  const size = Math.max(8, Math.round(box.h * 0.65))
  ctx.fillStyle = '#141414'
  ctx.font = `${size}px sans-serif`
  ctx.fillText(value, box.x + 2, box.y + size)
  return canvas.toBuffer('image/png')
}

export async function pngSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  const image = await loadImage(bytes)
  return { width: image.width, height: image.height }
}
