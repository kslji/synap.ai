/**
 * Convert a document to another format inside the app. The original bytes stay as they were.
 * Layout that these libraries cannot keep is reported as a warning, not a silent success.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { basename, extname } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { sha256, buildDocx, docxXml, pdfItems, renderPdfPage, sheetBytes, type RunProps } from './document-files.js'

export type ExportFormat = 'txt' | 'md' | 'html' | 'docx' | 'png' | 'jpeg' | 'csv' | 'xlsx' | 'pdf'

export interface ConvertedFile {
  bytes: Buffer
  name: string
  warnings: string[]
}

const BODY: RunProps = { font: 'Calibri', sizeHalfPoints: 22, color: '141414', bold: false, italic: false }

export function detectConvertIntent(text: string): ExportFormat | null {
  if (/\d/.test(text) && /\b(knot|knots|km|mile|kg|lb|feet|celsius|fahrenheit)\b/i.test(text)) return null
  if (!/\b(convert|turn|export|make)\b/i.test(text)) return null
  const target = text.match(/\b(?:into|to|as)\s+(?:a\s+|an\s+)?(word|docx|pdf|markdown|md|html|csv|excel|xlsx|spreadsheet|png|jpeg|jpg|text|txt|plain text)\b/i)
  if (!target) return null
  return formatName(target[1])
}

function formatName(word: string): ExportFormat | null {
  const value = word.toLowerCase()
  if (value === 'word' || value === 'docx') return 'docx'
  if (value === 'markdown' || value === 'md') return 'md'
  if (value === 'html') return 'html'
  if (value === 'csv') return 'csv'
  if (value === 'excel' || value === 'xlsx' || value === 'spreadsheet') return 'xlsx'
  if (value === 'png') return 'png'
  if (value === 'jpeg' || value === 'jpg') return 'jpeg'
  if (value === 'pdf') return 'pdf'
  if (value === 'text' || value === 'txt' || value === 'plain text') return 'txt'
  return null
}

export async function convertDocument(name: string, bytes: Buffer, format: ExportFormat, opts?: { cancelled?: () => boolean; onProgress?: (ratio: number, stage: string) => void }): Promise<ConvertedFile> {
  const input = Buffer.from(bytes)
  const before = sha256(input)
  opts?.onProgress?.(0.1, 'Reading')
  if (opts?.cancelled?.()) throw new Error('cancelled')
  const ext = extname(name).slice(1).toLowerCase()
  const warnings: string[] = []
  let out: Buffer
  if (format === 'png' || format === 'jpeg') {
    if (ext !== 'pdf') throw new Error('Page images are available from a PDF.')
    const png = await renderPdfPage(input)
    out = format === 'jpeg' ? await pngToJpeg(png) : png
    warnings.push('Each page is a picture. The text is not a new document layout.')
  } else if (format === 'pdf' && (ext === 'png' || ext === 'jpg' || ext === 'jpeg')) {
    out = await imageToPdf(input, ext === 'png' ? 'png' : 'jpg')
    warnings.push('The image is placed on the page. Text was not retyped.')
  } else if (format === 'csv' || format === 'xlsx') {
    const grid = await tableGrid(input, ext)
    if (!grid.length) throw new Error('No table was found. A simple table needs text lined up in columns.')
    warnings.push('Only simple tables are exported. Merged cells and nested tables are not kept.')
    out = format === 'csv' ? Buffer.from(grid.map((row) => row.map(csvCell).join(',')).join('\n'), 'utf8') : sheetBytes(grid)
  } else if (format === 'pdf') {
    const text = await plainText(name, input)
    warnings.push('The PDF is the text, reflowed. The original layout, headers, and images are not preserved.')
    out = await textToPdf(text)
  } else {
    const text = await plainText(name, input)
    if (ext === 'pdf') warnings.push('Headings and simple lines are kept. Columns, images, and the original page layout are not.')
    if (format === 'txt') out = Buffer.from(text, 'utf8')
    else if (format === 'md') out = Buffer.from(text, 'utf8')
    else if (format === 'html') out = Buffer.from(`<article>${text.split(/\n\n+/).map((part) => `<p>${escapeHtml(part)}</p>`).join('')}</article>`, 'utf8')
    else out = await buildDocx(text.split(/\n/).filter(Boolean).map((line) => ({ text: line, props: headingProps(line) })))
  }
  if (sha256(input) !== before) throw new Error('The original file was modified.')
  opts?.onProgress?.(1, 'Saved')
  const base = basename(name, extname(name))
  return { bytes: out, name: `${base}.${format === 'jpeg' ? 'jpg' : format}`, warnings }
}

function headingProps(line: string): RunProps {
  if (/^#{1,3}\s/.test(line)) return { ...BODY, bold: true, sizeHalfPoints: 28 }
  return BODY
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function pngToJpeg(png: Buffer): Promise<Buffer> {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, image.width, image.height)
  ctx.drawImage(image, 0, 0)
  return canvas.toBuffer('image/jpeg')
}

async function imageToPdf(bytes: Buffer, kind: 'png' | 'jpg'): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const embedded = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  const page = doc.addPage([embedded.width, embedded.height])
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
  return Buffer.from(await doc.save())
}

async function plainText(name: string, bytes: Buffer): Promise<string> {
  const ext = extname(name).slice(1).toLowerCase()
  if (ext === 'pdf') {
    const items = await pdfItems(bytes)
    return items.map((item) => item.str).join('\n')
  }
  if (ext === 'docx') {
    const xml = await docxXml(bytes)
    return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('\n')
  }
  if (ext === 'html' || ext === 'htm') return bytes.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return bytes.toString('utf8')
}

async function tableGrid(bytes: Buffer, ext: string): Promise<string[][]> {
  if (ext !== 'pdf') return []
  const items = await pdfItems(bytes)
  const rows = new Map<number, { x: number; str: string }[]>()
  for (const item of items) {
    const y = Math.round(item.y)
    const row = rows.get(y) ?? []
    row.push({ x: item.x, str: item.str })
    rows.set(y, row)
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((cell) => cell.str))
}

async function textToPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  const lines = text.split(/\n/).flatMap((line) => wrap(line, 80)).slice(0, 40)
  lines.forEach((line, index) => page.drawText(line, { x: 72, y: 740 - index * 16, size: 12, font, color: rgb(0.08, 0.08, 0.08) }))
  return Buffer.from(await doc.save())
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line]
  const parts: string[] = []
  for (let i = 0; i < line.length; i += width) parts.push(line.slice(i, i + width))
  return parts
}
