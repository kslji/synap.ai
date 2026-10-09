/**
 * Visible text from HTML, DOCX HTML, and similar markup.
 * Hidden nodes are dropped before the words are kept. Counts only; removed strings are not returned.
 */
import { filterParagraphs, normalizePassage } from './injection.js'

export interface SanitizerReport {
  hidden_css: number
  hidden_attr: number
  color_match: number
  comments: number
  noscript: number
  template: number
  nonvisible_text: number
  unicode_controls: number
  script_style: number
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'article', 'section', 'br', 'tr', 'blockquote', 'pre'])
const INHERIT = ['color', 'visibility', 'font-size']
const NAMED: Record<string, [number, number, number] | null> = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], transparent: null,
}

interface El {
  tag: string
  attrs: Record<string, string>
  children: Array<El | string>
}

function emptyReport(): SanitizerReport {
  return { hidden_css: 0, hidden_attr: 0, color_match: 0, comments: 0, noscript: 0, template: 0, nonvisible_text: 0, unicode_controls: 0, script_style: 0 }
}

function parseHtml(raw: string): { root: El; report: SanitizerReport } {
  const report = emptyReport()
  const root: El = { tag: 'document', attrs: {}, children: [] }
  const stack = [root]
  const token = /<!--([\s\S]*?)-->|<\/([A-Za-z0-9]+)\s*>|<([A-Za-z0-9]+)([^<>]*?)(\/?)>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = token.exec(raw))) {
    if (match[1] != null) {
      report.comments += 1
      continue
    }
    if (match[2]) {
      const tag = match[2].toLowerCase()
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (match[3]) {
      const tag = match[3].toLowerCase()
      const node: El = { tag, attrs: attrsOf(match[4] || ''), children: [] }
      stack[stack.length - 1].children.push(node)
      if (!VOID.has(tag) && match[5] !== '/') stack.push(node)
      continue
    }
    if (match[6]) stack[stack.length - 1].children.push(decode(match[6]))
  }
  return { root, report }
}

function attrsOf(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '')
  return attrs
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => safeChar(parseInt(num, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try { return String.fromCodePoint(code) } catch { return '' }
}

function parseInline(style: string | undefined): Record<string, string> {
  const props: Record<string, string> = {}
  if (!style) return props
  for (const part of style.split(';')) {
    const split = part.indexOf(':')
    if (split < 0) continue
    props[part.slice(0, split).trim().toLowerCase()] = part.slice(split + 1).trim().toLowerCase()
  }
  return props
}

function cssRules(css: string): Array<[string, Record<string, string>]> {
  const rules: Array<[string, Record<string, string>]> = []
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of body.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const props: Record<string, string> = {}
    for (const part of block[2].split(/[;\n]+/)) {
      const split = part.indexOf(':')
      if (split < 0) continue
      props[part.slice(0, split).trim().toLowerCase()] = part.slice(split + 1).trim().toLowerCase()
    }
    for (const selector of block[1].split(',')) {
      const clean = selector.replace(/\s+/g, ' ').trim()
      if (clean) rules.push([clean, props])
    }
  }
  return rules
}

function specificity(selector: string, tag: string, classes: Set<string>, ident: string): number | null {
  let raw = selector.trim().toLowerCase()
  if (!raw || /[ >+~\[]|:/.test(raw)) return null
  let spec = 0
  let wantedId = ''
  let classNames: string[] = []
  if (raw.includes('#')) {
    const [before, after] = raw.split('#')
    wantedId = after.split('.')[0]
    classNames.push(...after.split('.').slice(1).filter(Boolean))
    raw = before
  }
  if (wantedId && wantedId !== ident) return null
  if (wantedId) spec += 100
  let element = ''
  if (raw.startsWith('.')) classNames = raw.split('.').filter(Boolean).concat(classNames)
  else if (raw) {
    const bits = raw.split('.').filter(Boolean)
    element = bits[0]
    classNames = bits.slice(1).concat(classNames)
  }
  if (element && element !== tag) return null
  if (element) spec += 1
  for (const name of classNames) {
    if (!classes.has(name)) return null
    spec += 10
  }
  return spec === 0 ? null : spec
}

function applyRules(tag: string, attrs: Record<string, string>, rules: Array<[string, Record<string, string>]>): Record<string, string> {
  const classes = new Set((attrs.class || '').toLowerCase().split(/\s+/).filter(Boolean))
  const ident = (attrs.id || '').toLowerCase()
  const props: Record<string, string> = {}
  const rank: Record<string, number> = {}
  for (const [selector, decl] of rules) {
    const spec = specificity(selector, tag, classes, ident)
    if (spec == null) continue
    for (const [key, value] of Object.entries(decl)) {
      if (spec >= (rank[key] ?? -1)) {
        props[key] = value
        rank[key] = spec
      }
    }
  }
  Object.assign(props, parseInline(attrs.style))
  return props
}

function inherit(parent: Record<string, string>, own: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {}
  for (const key of INHERIT) if (parent[key]) style[key] = parent[key]
  Object.assign(style, own)
  const parentOpacity = Number(parent.opacity ?? 1)
  const ownOpacity = Number(own.opacity ?? 1)
  if (parent.opacity != null || own.opacity != null) {
    style.opacity = String((Number.isFinite(parentOpacity) ? parentOpacity : 1) * (Number.isFinite(ownOpacity) ? ownOpacity : 1))
  }
  return style
}

function parseColor(value: string | undefined): [number, number, number] | null {
  if (!value) return null
  const color = value.split('!')[0].trim().toLowerCase()
  if (color in NAMED) return NAMED[color]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(color)
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split('').map((ch) => ch + ch).join('') : hex[1]
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(color)
  if (!rgb) return null
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(Number(rgb[i + 1]))))) as [number, number, number]
}

function nearly(left: [number, number, number] | null, right: [number, number, number] | null): boolean {
  if (!left || !right) return false
  const distance = Math.sqrt(left.reduce((sum, channel, i) => sum + (channel - right[i]) ** 2, 0))
  return distance <= 40
}

function lengthZero(value: string | undefined): boolean {
  return Boolean(value && /^0(?:\.0+)?(?:px|pt|em|rem|%)?$/.test(value.trim().toLowerCase()))
}

function tinyFont(value: string | undefined): boolean {
  if (!value) return false
  const match = /^([0-9.]+)(px|pt|em|rem|%)?$/.exec(value.trim().toLowerCase())
  if (!match) return false
  const number = Number(match[1])
  const unit = match[2] || 'px'
  if ((unit === 'px' || unit === 'pt') && number <= 1) return true
  return (unit === 'em' || unit === 'rem') && number <= 0.05
}

function far(value: string | undefined): boolean {
  if (!value) return false
  const match = /^(-?[0-9.]+)(px|pt)?$/.exec(value.trim().toLowerCase())
  if (!match) return false
  const number = Number(match[1])
  return number <= -50 || Math.abs(number) >= 1000
}

function hiddenCss(style: Record<string, string>): boolean {
  if (style.display === 'none') return true
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return true
  if (Number(style.opacity ?? 1) <= 0.01) return true
  if (tinyFont(style['font-size'])) return true
  if (lengthZero(style.width) && lengthZero(style.height)) return true
  if (lengthZero(style.height || style['max-height']) && style.overflow === 'hidden') return true
  const position = style.position || ''
  if ((position === 'absolute' || position === 'fixed') && ['left', 'top', 'right', 'bottom', 'text-indent'].some((key) => far(style[key]))) return true
  if (far(style['text-indent'])) return true
  if (style.clip?.includes('rect') && /rect\(\s*0/.test(style.clip)) return true
  const clipPath = style['clip-path'] || ''
  return clipPath.includes('inset(100%') || clipPath.includes('inset(50%')
}

function cssText(node: El): string {
  if (node.tag === 'style') return node.children.filter((child): child is string => typeof child === 'string').join('')
  return node.children.filter((child): child is El => typeof child !== 'string').map(cssText).join('')
}

function findTitle(node: El): string | null {
  if (node.tag === 'title') {
    const text = node.children.filter((child): child is string => typeof child === 'string').join('').trim()
    return text || null
  }
  for (const child of node.children) {
    if (typeof child !== 'string') {
      const found = findTitle(child)
      if (found) return found
    }
  }
  return null
}

function walk(node: El, style: Record<string, string>, background: [number, number, number] | null, rules: Array<[string, Record<string, string>]>, report: SanitizerReport, out: string[]): void {
  for (const child of node.children) {
    if (typeof child === 'string') {
      if (child.trim()) out.push(child)
      continue
    }
    const tag = child.tag
    if (tag === 'script' || tag === 'style') {
      if (child.children.some((item) => typeof item === 'string' && item.trim())) report.script_style += 1
      continue
    }
    if (tag === 'noscript') { report.noscript += 1; continue }
    if (tag === 'template') { report.template += 1; continue }
    if (tag === 'meta' || tag === 'title' || tag === 'link' || tag === 'head') {
      if (tag === 'meta' && child.attrs.content) report.nonvisible_text += 1
      if (tag === 'title') report.nonvisible_text += 1
      if (tag === 'head') walk(child, style, background, rules, report, [])
      continue
    }
    for (const key of ['alt', 'aria-label', 'title']) if (child.attrs[key]) report.nonvisible_text += 1
    if ('hidden' in child.attrs || (child.attrs['aria-hidden'] || '').toLowerCase() === 'true') {
      report.hidden_attr += 1
      continue
    }
    const own = applyRules(tag, child.attrs, rules)
    const merged = inherit(style, own)
    if (hiddenCss(merged)) { report.hidden_css += 1; continue }
    let nextBg = background
    const painted = parseColor(own['background-color'] || own.background)
    if (painted) nextBg = painted
    const color = parseColor(merged.color)
    if (color && nextBg && nearly(color, nextBg)) { report.color_match += 1; continue }
    if (BLOCK.has(tag)) out.push('\n')
    walk(child, merged, nextBg, rules, report, out)
    if (BLOCK.has(tag)) out.push('\n')
  }
}

export function visibleHtml(raw: string): { text: string; title: string | null; report: SanitizerReport } {
  const { root, report } = parseHtml(raw)
  const rules = cssRules(cssText(root))
  const pieces: string[] = []
  walk(root, {}, [255, 255, 255], rules, report, pieces)
  let text = pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
  const normalized = normalizePassage(text)
  text = normalized.text
  report.unicode_controls += normalized.removed
  let title = findTitle(root)
  if (title) {
    const folded = normalizePassage(title)
    report.unicode_controls += folded.removed
    title = folded.text.trim() || null
  }
  return { text, title, report }
}

export function prepareHtml(raw: string): { text: string; title: string | null; report: SanitizerReport; ignored: { score: number; flags: string[] }[] } {
  const visible = visibleHtml(raw)
  const filtered = filterParagraphs(visible.text)
  let title = visible.title
  if (title && filterParagraphs(title).injection.action === 'drop') title = null
  return { text: filtered.text, title, report: visible.report, ignored: filtered.ignored }
}
