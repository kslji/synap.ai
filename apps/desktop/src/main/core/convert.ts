/**
 * Attachment to text, inside the app. No Python runtime.
 * pdfjs-dist (text PDFs), mammoth (DOCX), SheetJS (XLSX/CSV), a small PPTX unzip,
 * html-to-text, and tesseract.js for images and scanned pages.
 * A PyInstaller doc-worker would add a second toolchain and a few hundred MB; these
 * libraries cover the formats for a one-click install.
 */
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { convert as htmlToText } from 'html-to-text'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import * as XLSX from 'xlsx'
import type { Block } from './chunker.js'
import { recognizeImage } from './ocr.js'

export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

export function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase()
}

export function mimeForName(name: string): string | null {
  return MIME[extensionOf(name)] ?? null
}

export class ConvertCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'ConvertCancelled'
  }
}

export interface ConvertOptions {
  tessdataDir: string
  tessCacheDir: string
  onProgress?: (ratio: number, stage: string) => void
  cancelled?: () => boolean
  /** Stretch path: Qwen3.5 mmproj caption. Omit when the projector file is not installed. */
  caption?: (png: Buffer) => Promise<string | null>
}

let canvasReady = false
function ensureCanvas(): void {
  if (canvasReady) return
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix
  if (!g.ImageData) g.ImageData = ImageData
  if (!g.Path2D) g.Path2D = Path2D
  canvasReady = true
}

export async function readAttachment(filePath: string): Promise<{ bytes: Buffer; name: string }> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('That path is not a file.')
  if (info.size <= 0) throw new Error('The file is empty.')
  if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('Files over 40 MB are not indexed.')
  const name = filePath.split(/[/\\]/).pop() || 'file'
  if (!mimeForName(name)) throw new Error('Use a PDF, Word, PowerPoint, Excel, CSV, text, HTML, PNG, or JPEG file.')
  return { bytes: await readFile(filePath), name }
}

export async function convertBytes(name: string, bytes: Buffer, opts: ConvertOptions): Promise<Block[]> {
  const ext = extensionOf(name)
  opts.onProgress?.(0.05, 'Reading')
  switch (ext) {
    case 'pdf': return convertPdf(bytes, opts)
    case 'docx': return convertDocx(bytes)
    case 'pptx': return convertPptx(bytes)
    case 'xlsx':
    case 'csv': return convertSheet(bytes)
    case 'html':
    case 'htm': return htmlBlocks(bytes.toString('utf8'))
    case 'md':
    case 'txt': return markdownBlocks(bytes.toString('utf8'))
    case 'png':
    case 'jpg':
    case 'jpeg': return convertImage(bytes, opts)
    default: throw new Error('Use a PDF, Word, PowerPoint, Excel, CSV, text, HTML, PNG, or JPEG file.')
  }
}

async function convertPdf(bytes: Buffer, opts: ConvertOptions): Promise<Block[]> {
  ensureCanvas()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as {
    getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc>; destroy?: () => void }
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  })
  const doc = await task.promise
  const blocks: Block[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      if (opts.cancelled?.()) throw new ConvertCancelled()
      opts.onProgress?.(0.08 + (0.6 * pageNo) / doc.numPages, `Page ${pageNo} of ${doc.numPages}`)
      const page = await doc.getPage(pageNo)
      const text = pageText(await page.getTextContent())
      if (text.replace(/\s+/g, ' ').trim().length >= 20) {
        blocks.push(...linesToBlocks(text, pageNo))
      } else {
        const png = await renderPage(page)
        const ocr = await recognizeImage(png, opts.tessdataDir, opts.tessCacheDir)
        if (ocr.text) blocks.push({ text: ocr.text, page: pageNo, heading: null })
        const caption = opts.caption ? await opts.caption(png) : null
        if (caption) blocks.push({ text: caption, page: pageNo, heading: 'Image description' })
      }
      page.cleanup?.()
    }
  } finally {
    await doc.destroy?.()
  }
  if (!blocks.length) throw new Error('No text found in this PDF.')
  return blocks
}

function pageText(content: { items: unknown[] }): string {
  const lines: string[] = []
  let line = ''
  for (const item of content.items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue
    const piece = item as { str: string; hasEOL?: boolean }
    line += piece.str
    if (piece.hasEOL) {
      lines.push(line)
      line = ''
    } else line += ' '
  }
  if (line.trim()) lines.push(line)
  return lines.join('\n')
}

function linesToBlocks(text: string, page: number): Block[] {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean)
  const blocks: Block[] = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    const body = buf.join(' ').trim()
    if (body) blocks.push({ text: body, heading, page })
    buf = []
  }
  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flush()
      heading = line
      continue
    }
    buf.push(line)
  }
  flush()
  if (!blocks.length) blocks.push({ text, page, heading: null })
  return blocks
}

function looksLikeHeading(line: string): boolean {
  if (line.length < 4 || line.length > 80) return false
  if (/[.:;]$/.test(line)) return false
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true
  return line.split(/\s+/).length <= 8 && /^[A-Z0-9]/.test(line) && !line.includes(',')
}

async function renderPage(page: PdfPage): Promise<Buffer> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 1400 / Math.max(base.width, 1))
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
  return canvas.toBuffer('image/png')
}

async function convertDocx(bytes: Buffer): Promise<Block[]> {
  const html = await mammoth.convertToHtml({ buffer: bytes })
  const blocks = htmlBlocks(html.value)
  if (!blocks.length) throw new Error('No text found in this Word file.')
  return blocks
}

async function convertPptx(bytes: Buffer): Promise<Block[]> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
  if (!names.length) throw new Error('No slides found in this PowerPoint file.')
  const blocks: Block[] = []
  for (const name of names) {
    const xml = await zip.files[name].async('string')
    const bits = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).filter(Boolean)
    if (!bits.length) continue
    const [title, ...rest] = bits
    blocks.push({
      text: rest.length ? rest.join(' ') : title,
      heading: title,
      slide: slideNumber(name),
    })
  }
  if (!blocks.length) throw new Error('No text found in this PowerPoint file.')
  return blocks
}

function slideNumber(name: string): number {
  const n = /slide(\d+)\.xml$/.exec(name)
  return n ? Number(n[1]) : 0
}

function convertSheet(bytes: Buffer): Block[] {
  const book = XLSX.read(bytes, { type: 'buffer', raw: false })
  const blocks: Block[] = []
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(book.Sheets[name], {
      header: 1,
      raw: false,
      blankrows: false,
    }).slice(0, 2000)
    const text = rows
      .map((row) => (Array.isArray(row) ? row : []).slice(0, 40).map((cell) => String(cell ?? '').trim()).filter(Boolean).join('\t'))
      .filter(Boolean)
      .join('\n')
    if (text) blocks.push({ text, heading: name, sheet: name })
  }
  if (!blocks.length) throw new Error('No cells found in this spreadsheet.')
  return blocks
}

function htmlBlocks(html: string): Block[] {
  const blocks: Block[] = []
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>|<li[^>]*>([\s\S]*?)<\/li>/gi
  let heading: string | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const inner = stripTags(match[2] || match[3] || match[4] || '')
    if (!inner) continue
    if (match[2] && match[1]) {
      heading = inner
      continue
    }
    blocks.push({ text: inner, heading })
  }
  if (blocks.length) return blocks
  const plain = htmlToText(html, { wordwrap: false }).trim()
  return plain ? [{ text: plain, heading: null }] : []
}

function markdownBlocks(raw: string): Block[] {
  const blocks: Block[] = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) blocks.push({ text, heading })
    buf = []
  }
  for (const line of raw.split(/\r?\n/)) {
    const headingLine = /^(#{1,3})\s+(.*)$/.exec(line)
    if (headingLine) {
      flush()
      heading = headingLine[2].trim()
      continue
    }
    buf.push(line)
  }
  flush()
  if (!blocks.length && raw.trim()) blocks.push({ text: raw.trim(), heading: null })
  return blocks
}

async function convertImage(bytes: Buffer, opts: ConvertOptions): Promise<Block[]> {
  if (opts.cancelled?.()) throw new ConvertCancelled()
  opts.onProgress?.(0.3, 'Reading the image')
  const ocr = await recognizeImage(bytes, opts.tessdataDir, opts.tessCacheDir)
  const blocks: Block[] = []
  if (ocr.text) blocks.push({ text: ocr.text, heading: null })
  const caption = opts.caption ? await opts.caption(bytes) : null
  if (caption) blocks.push({ text: caption, heading: 'Image description' })
  if (!blocks.length) throw new Error('No text found in this image.')
  return blocks
}

function stripTags(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

interface PdfDoc {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  destroy?: () => Promise<void>
}
interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> }
  cleanup?: () => void
}
