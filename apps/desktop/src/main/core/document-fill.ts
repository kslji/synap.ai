/**
 * Plan a fill from two files and write a new copy. Both texts go through the injection filter.
 */
import { extname } from 'node:path'
import { blanksFromText, classifyPair, proposeFills, type Blank, type FillRow } from './document-blanks.js'
import { convertDocument, type ExportFormat } from './document-export.js'
import {
  detectBlankBoxes, docxXml, fillAcroPdf, fillDocx, fillPlainPdf, fillPng, fillSheet,
  pdfItems, readSheet, sha256,
} from './document-files.js'
import { PDFDocument, PDFTextField } from 'pdf-lib'
import { pureExpression } from './number-tools.js'

export interface FillPlan {
  rows: FillRow[]
  role: 'template-first' | 'source-first' | 'ask'
  warnings: string[]
  templateHash: string
}

export async function planDocument(templateName: string, template: Buffer, sourceName: string, source: Buffer, calc?: (expression: string) => string | null): Promise<FillPlan> {
  const templateText = await textOf(templateName, template)
  const sourceText = await textOf(sourceName, source)
  const templateBlanks = await blanksOf(templateName, template, templateText)
  const sourceBlanks = blanksFromText(sourceText)
  const warnings: string[] = []
  if (extname(templateName).toLowerCase() === '.png' || extname(templateName).toLowerCase() === '.jpg') {
    warnings.push('Blank boxes on a scan are estimated from the line. The label is whatever text sits on that line in a text copy of the form.')
  }
  const role = classifyPair(templateBlanks.length, sourceBlanks.length)
  if (role === 'ask') warnings.push('Both files look like templates, or neither has a blank. Choose which file is the form.')
  return { rows: proposeFills(templateBlanks, sourceText, calc), role, warnings, templateHash: sha256(template) }
}

async function blanksOf(name: string, bytes: Buffer, text: string): Promise<Blank[]> {
  const blanks = blanksFromText(text)
  const ext = extname(name).slice(1).toLowerCase()
  if (ext === 'docx') {
    const xml = await docxXml(bytes)
    for (const match of xml.matchAll(/<w:sdt\b[\s\S]*?<\/w:sdt>/g)) {
      const alias = match[0].match(/<w:alias[^>]*w:val="([^"]+)"/)
      const label = unescapeXml(alias?.[1] ?? '').trim()
      if (!label || blanks.some((blank) => blank.label.toLowerCase() === label.toLowerCase())) continue
      const inner = textsIn(match[0]).join('').trim()
      if (inner && !hasBlank(inner) && inner.toLowerCase() !== label.toLowerCase()) continue
      blanks.push({ id: `control-${label}`, label, placeholder: '(fill)', locator: 'control', kind: 'control' })
    }
    for (const row of xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) => cell[0])
      if (cells.length < 2) continue
      const label = textsIn(cells[0]).join('').trim()
      const value = textsIn(cells[1]).join('').trim()
      if (!label || value || blanks.some((blank) => blank.label.toLowerCase() === label.toLowerCase())) continue
      blanks.push({ id: `cell-${label}`, label, placeholder: '', locator: 'table', kind: 'cell' })
    }
  }
  if (ext === 'pdf') {
    const doc = await PDFDocument.load(bytes)
    const form = doc.getForm()
    for (const field of form.getFields()) {
      if (!(field instanceof PDFTextField)) continue
      if ((field.getText() ?? '').trim()) continue
      if (blanks.some((blank) => blank.label.toLowerCase() === field.getName().toLowerCase())) continue
      blanks.push({ id: `field-${field.getName()}`, label: field.getName(), placeholder: '', locator: 'field', kind: 'acroform' })
    }
  }
  if (ext === 'xlsx' || ext === 'csv') {
    const grid = ext === 'csv' ? bytes.toString('utf8').split(/\n/).map((line) => line.split(',')) : readSheet(bytes)
    grid.forEach((row, index) => {
      const label = String(row[0] ?? '').trim()
      const cell = String(row[1] ?? '')
      if (!label || !/_{2,}|\[\s*\]|\(fill\)|^$/.test(cell)) return
      if (blanks.some((blank) => blank.label.toLowerCase() === label.toLowerCase())) return
      blanks.push({ id: `cell-${index + 1}`, label, placeholder: cell, locator: `row ${index + 1}`, kind: 'cell' })
    })
  }
  return blanks
}

async function textOf(name: string, bytes: Buffer): Promise<string> {
  const ext = extname(name).slice(1).toLowerCase()
  if (ext === 'docx') {
    const xml = await docxXml(bytes)
    return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => unescapeXml(textsIn(match[0]).join(''))).join('\n')
  }
  if (ext === 'pdf') {
    const items = await pdfItems(bytes)
    const lines = new Map<string, { x: number; str: string }[]>()
    for (const item of items) {
      const key = `${item.page}:${Math.round(item.y)}`
      const line = lines.get(key) ?? []
      line.push({ x: item.x, str: item.str })
      lines.set(key, line)
    }
    return [...lines.values()].map((line) => line.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ')).join('\n')
  }
  if (ext === 'xlsx') {
    return readSheet(bytes).map((row) => `${row[0] ?? ''}: ${row[1] ?? ''}`.trim()).join('\n')
  }
  if (ext === 'html' || ext === 'htm') return bytes.toString('utf8').replace(/<[^>]+>/g, ' ')
  return bytes.toString('utf8')
}

export async function exportFilled(templateName: string, template: Buffer, rows: FillRow[], format: ExportFormat | 'same', highlight: boolean): Promise<{ bytes: Buffer; warnings: string[] }> {
  const input = Buffer.from(template)
  const before = sha256(input)
  const ext = extname(templateName).slice(1).toLowerCase()
  const warnings: string[] = []
  let bytes: Buffer
  if (ext === 'docx') bytes = await fillDocx(input, rows, highlight)
  else if (ext === 'pdf') {
    const doc = await PDFDocument.load(input)
    if (doc.getForm().getFields().length) bytes = await fillAcroPdf(input, rows, false)
    else {
      const plain = await fillPlainPdf(input, rows)
      bytes = plain.bytes
      warnings.push(...plain.warnings)
    }
  } else if (ext === 'xlsx') bytes = fillSheet(input, rows)
  else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    const boxes = await detectBlankBoxes(input)
    const box = boxes[0]
    const value = rows.find((row) => row.found)?.value
    if (!box || !value) throw new Error('No blank line was found on this image.')
    bytes = await fillPng(input, value, box)
    warnings.push('The scan keeps its picture. The answer is drawn on the blank line at the line height.')
  } else {
    let text = input.toString('utf8')
    for (const row of rows) {
      if (!row.found) continue
      text = text.replace(new RegExp(`(${escapeReg(row.label)}\\s*[:：]?\\s*)(_{2,}|\\[\\s*\\]|\\(fill\\))`, 'i'), `$1${row.value}`)
    }
    bytes = Buffer.from(text, 'utf8')
  }
  if (sha256(input) !== before) throw new Error('The original file was modified.')
  const wanted = format === 'same' ? null : format
  if (wanted && wanted !== ext) {
    const converted = await convertDocument(`filled.${ext || 'txt'}`, bytes, wanted)
    warnings.push(...converted.warnings)
    return { bytes: converted.bytes, warnings }
  }
  return { bytes, warnings }
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textsIn(xml: string): string[] {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1])
}

function unescapeXml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

function hasBlank(text: string): boolean {
  return /_{2,}|\[\s*\]|\[blank\]|\(fill\)/i.test(text)
}

/** Arithmetic blanks use the calculator. The expression is only the source value, never the surrounding prose. */
export async function applyCalculator(rows: FillRow[], calc: (expression: string) => Promise<string | null>): Promise<FillRow[]> {
  const next: FillRow[] = []
  for (const row of rows) {
    if (!row.found) {
      next.push(row)
      continue
    }
    const expression = pureExpression(row.value)
    if (!expression) {
      next.push(row)
      continue
    }
    const value = await calc(expression)
    next.push(value && value.trim() ? { ...row, value: value.trim() } : row)
  }
  return next
}
