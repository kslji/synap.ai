/**
 * Find blanks in a template and fill them only from a source document.
 * A blank with no matching label becomes "not found in source". Nothing is guessed.
 */
import { filterParagraphs } from './injection.js'
import { pureExpression } from './number-tools.js'

export const NOT_FOUND = 'not found in source'

export type BlankKind = 'underscore' | 'brackets' | 'fill' | 'cell' | 'control' | 'acroform'

export interface Blank {
  id: string
  label: string
  placeholder: string
  locator: string
  kind: BlankKind
}

export interface FillRow {
  id: string
  label: string
  value: string
  citation: string | null
  confidence: 'high' | 'none'
  found: boolean
  locator: string
}

const BLANK_RE = /_{2,}|\[\s*\]|\[blank\]|\(fill\)/i

export function classifyPair(templateBlanks: number, sourceBlanks: number): 'template-first' | 'source-first' | 'ask' {
  if (templateBlanks > 0 && sourceBlanks === 0) return 'template-first'
  if (sourceBlanks > 0 && templateBlanks === 0) return 'source-first'
  return 'ask'
}

export function blanksFromText(text: string): Blank[] {
  const clean = filterParagraphs(text).text
  const blanks: Blank[] = []
  const lines = clean.split(/\n/)
  lines.forEach((line, index) => {
    const match = line.match(/^(.*?)(?:[:：]\s*)?(\_{2,}|\[\s*\]|\[blank\]|\(fill\))\s*$/i)
    if (!match) return
    const label = match[1].replace(/[:：]\s*$/, '').trim()
    if (!label) return
    blanks.push({
      id: `line-${index + 1}`,
      label,
      placeholder: match[2],
      locator: `line ${index + 1}`,
      kind: kindOf(match[2]),
    })
  })
  return blanks
}

function kindOf(placeholder: string): BlankKind {
  if (placeholder.includes('[')) return 'brackets'
  if (placeholder.toLowerCase().includes('fill')) return 'fill'
  return 'underscore'
}

export function proposeFills(blanks: Blank[], source: string, calc?: (expression: string) => string | null): FillRow[] {
  const clean = filterParagraphs(source).text
  const lines = clean.split(/\n/)
  return blanks.map((blank) => {
    const found = lookup(blank.label, lines)
    if (!found) {
      return { id: blank.id, label: blank.label, value: NOT_FOUND, citation: null, confidence: 'none', found: false, locator: blank.locator }
    }
    const expression = pureExpression(found.value)
    const computed = expression && calc ? calc(expression) : null
    const value = computed && computed.trim() ? computed.trim() : found.value
    return {
      id: blank.id,
      label: blank.label,
      value,
      citation: `line ${found.line}`,
      confidence: 'high',
      found: true,
      locator: blank.locator,
    }
  })
}

function lookup(label: string, lines: string[]): { value: string; line: number } | null {
  const want = normalizeLabel(label)
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(.{1,80}?)[:：]\s*(.+)$/)
    if (!match) continue
    if (normalizeLabel(match[1]) !== want) continue
    const value = match[2].trim()
    if (!value || BLANK_RE.test(value)) continue
    return { value, line: i + 1 }
  }
  return null
}

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function hasBlank(text: string): boolean {
  return BLANK_RE.test(text)
}
