import React, { createElement, useState, type ReactNode } from 'react'

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'math'; text: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'math'; text: string }
  | { type: 'rule' }

export interface ArticleFrontmatter {
  title: string
  description: string
  date: string
  body: string
}

export function splitFrontmatter(source: string): ArticleFrontmatter {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  let body = text
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4)
    if (end !== -1) {
      for (const line of text.slice(4, end).split('\n')) {
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
        if (!match) continue
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        meta[match[1]] = value
      }
      body = text.slice(end + 5)
    }
  }
  return {
    title: meta.title ?? '',
    description: meta.description ?? '',
    date: meta.date ?? '',
    body,
  }
}

function findCloser(input: string, from: number, marker: string): number {
  const at = input.indexOf(marker, from)
  return at
}

function parseInline(input: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < input.length) {
    if (input.startsWith('$$', i)) {
      const end = input.indexOf('$$', i + 2)
      if (end !== -1) {
        out.push({ type: 'math', text: input.slice(i + 2, end).trim() })
        i = end + 2
        continue
      }
    }
    if (input[i] === '$' && input[i + 1] !== '$') {
      const end = input.indexOf('$', i + 1)
      if (end !== -1) {
        const body = input.slice(i + 1, end)
        if (body && /[\\^_]/.test(body) && !body.includes('\n')) {
          out.push({ type: 'math', text: body.trim() })
          i = end + 1
          continue
        }
      }
    }
    if (input.startsWith('**', i)) {
      const end = findCloser(input, i + 2, '**')
      if (end !== -1) {
        out.push({ type: 'strong', children: parseInline(input.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (input[i] === '`') {
      const end = findCloser(input, i + 1, '`')
      if (end !== -1) {
        out.push({ type: 'code', text: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (input[i] === '[') {
      const labelEnd = input.indexOf(']', i + 1)
      if (labelEnd !== -1 && input[labelEnd + 1] === '(') {
        const hrefEnd = input.indexOf(')', labelEnd + 2)
        if (hrefEnd !== -1) {
          out.push({
            type: 'link',
            href: input.slice(labelEnd + 2, hrefEnd),
            children: parseInline(input.slice(i + 1, labelEnd)),
          })
          i = hrefEnd + 1
          continue
        }
      }
    }
    if (input.startsWith('https://', i) || input.startsWith('http://', i)) {
      const match = /^https?:\/\/[^\s)]+/.exec(input.slice(i))
      if (match) {
        const href = match[0].replace(/[.,;:]+$/, '')
        out.push({ type: 'link', href, children: [{ type: 'text', text: href }] })
        i += href.length
        continue
      }
    }
    if (input[i] === '*' && input[i + 1] !== '*') {
      let end = -1
      for (let k = i + 1; k < input.length; k++) {
        if (input[k] === '*' && input[k + 1] !== '*') {
          end = k
          break
        }
      }
      if (end !== -1) {
        out.push({ type: 'em', children: parseInline(input.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    let j = i + 1
    while (j < input.length) {
      const ch = input[j]
      if (ch === '*' || ch === '`' || ch === '[') break
      if (input.startsWith('https://', j) || input.startsWith('http://', j)) break
      j++
    }
    out.push({ type: 'text', text: input.slice(i, j) })
    i = j
  }
  return out
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function parseTable(lines: string[]): Block | null {
  const rows = lines.filter((line) => !isSeparator(line)).map(splitRow)
  if (rows.length === 0) return null
  const [header, ...body] = rows
  return { type: 'table', header: header.map(parseInline), rows: body.map((row) => row.map(parseInline)) }
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line)
}

function isRule(line: string): boolean {
  return /^---+$/.test(line.trim())
}

function isList(line: string, ordered: boolean): boolean {
  return ordered ? /^\d+\.\s+/.test(line) : /^[-*]\s+/.test(line)
}

export function parseMarkdown(source: string): Block[] {
  const { body } = splitFrontmatter(source)
  const lines = body.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i += 1
      continue
    }
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }
    if (line.trim().startsWith('$$')) {
      const single = /^\$\$(.*)\$\$$/.exec(line.trim())
      if (single && single[1]) {
        blocks.push({ type: 'math', text: single[1].trim() })
        i += 1
        continue
      }
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('$$')) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'math', text: body.join('\n').trim() })
      continue
    }
    if (isRule(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ type: 'heading', level, children: parseInline(heading[2].trim()) })
      i += 1
      continue
    }
    if (line.trim().startsWith('|')) {
      const table: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        table.push(lines[i])
        i += 1
      }
      const parsed = parseTable(table)
      if (parsed) blocks.push(parsed)
      continue
    }
    if (isList(line, true) || isList(line, false)) {
      const ordered = isList(line, true)
      const items: Inline[][] = []
      while (i < lines.length && isList(lines[i], ordered)) {
        items.push(parseInline(lines[i].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, '')))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    const parts: string[] = []
    while (
      i < lines.length
      && !isBlank(lines[i])
      && !isHeading(lines[i])
      && !isRule(lines[i])
      && !lines[i].trim().startsWith('|')
      && !lines[i].trim().startsWith('```')
      && !lines[i].trim().startsWith('$$')
      && !isList(lines[i], true)
      && !isList(lines[i], false)
    ) {
      parts.push(lines[i].trim())
      i += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(parts.join(' ')) })
  }
  return blocks
}

export function markdownHrefs(source: string): string[] {
  const found: string[] = []
  function walk(nodes: Inline[]) {
    for (const node of nodes) {
      if (node.type === 'link') found.push(node.href)
      if (node.type === 'strong' || node.type === 'em' || node.type === 'link') walk(node.children)
    }
  }
  for (const block of parseMarkdown(source)) {
    if (block.type === 'heading' || block.type === 'paragraph') walk(block.children)
    if (block.type === 'list') for (const item of block.items) walk(item)
    if (block.type === 'table') {
      for (const cell of block.header) walk(cell)
      for (const row of block.rows) for (const cell of row) walk(cell)
    }
  }
  return found
}

/** URLs written in the Markdown, including bare links in the sources list. */
export function sourceUrls(source: string): string[] {
  return [...source.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0].replace(/[.,;:]+$/, ''))
}

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '+': '⁺', '-': '⁻' }

function prettyMath(text: string): string {
  return text
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\^\{([^{}]+)\}/g, (_, exp: string) => [...exp].map((ch) => SUPER[ch] ?? ch).join(''))
    .replace(/\^([0-9n+-])/g, (_, exp: string) => SUPER[exp] ?? exp)
}

function Highlighted({ text, lang }: { text: string; lang: string }) {
  if (!/js|ts|py|python|sh|json|bash/i.test(lang)) return <>{text}</>
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/.*$|#.*$)|(\b(?:const|let|var|function|return|if|else|for|while|import|from|export|class|new|true|false|null|undefined|def)\b)/gm
  const parts: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const kind = match[1] ? 'string' : match[2] ? 'comment' : 'keyword'
    parts.push(<span key={index} data-token={kind}>{match[0]}</span>)
    index += 1
    last = at + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block" data-code-block="yes" data-lang={lang || 'text'}>
      <div className="code-block-bar">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          data-copy-code="yes"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            }).catch(() => undefined)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code><Highlighted text={text} lang={lang} /></code></pre>
    </div>
  )
}

function InlineView({ nodes, renderText }: { nodes: Inline[]; renderText?: (text: string) => ReactNode }): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{renderText ? renderText(node.text) : node.text}</span>
    if (node.type === 'strong') return <strong key={index}><InlineView nodes={node.children} renderText={renderText} /></strong>
    if (node.type === 'em') return <em key={index}><InlineView nodes={node.children} renderText={renderText} /></em>
    if (node.type === 'code') return <code key={index}>{node.text}</code>
    if (node.type === 'math') return <span key={index} className="math-inline" data-latex="yes">{prettyMath(node.text)}</span>
    return (
      <a key={index} href={node.href} target="_blank" rel="noreferrer">
        <InlineView nodes={node.children} renderText={renderText} />
      </a>
    )
  })
}

const headingClass: Record<number, string> = {
  1: 'mt-2 text-3xl font-semibold tracking-tight',
  2: 'mt-8 text-2xl font-semibold tracking-tight',
  3: 'mt-6 text-xl font-semibold',
  4: 'mt-4 text-lg font-semibold',
  5: 'mt-4 text-base font-semibold',
  6: 'mt-4 text-sm font-semibold',
}

const compactHeading: Record<number, string> = {
  1: 'text-lg font-semibold leading-snug',
  2: 'text-base font-semibold leading-snug',
  3: 'text-base font-semibold leading-snug',
  4: 'text-sm font-semibold leading-snug',
  5: 'text-sm font-semibold leading-snug',
  6: 'text-sm font-semibold leading-snug',
}

export function Markdown({ source, compact = false, renderText }: { source: string; compact?: boolean; renderText?: (text: string) => ReactNode }) {
  const blocks = parseMarkdown(source)
  const headings = compact ? compactHeading : headingClass
  return (
    <div data-markdown="yes" className={compact ? 'reply-markdown' : 'flex flex-col gap-3'}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
          return createElement(tag, { key: index, className: headings[block.level] }, <InlineView nodes={block.children} renderText={renderText} />)
        }
        if (block.type === 'paragraph') {
          return <p key={index}><InlineView nodes={block.children} renderText={renderText} /></p>
        }
        if (block.type === 'code') return <CodeBlock key={index} lang={block.lang} text={block.text} />
        if (block.type === 'math') return <div key={index} className="math-block" data-latex="yes" data-latex-display="yes">{prettyMath(block.text)}</div>
        if (block.type === 'rule') return <hr key={index} className="border-[var(--line)]" />
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={index} className={block.ordered ? 'list-decimal space-y-2 pl-5' : 'list-disc space-y-2 pl-5'}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineView nodes={item} renderText={renderText} /></li>)}
            </Tag>
          )
        }
        return (
          <div key={index} className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} className="border-b border-[var(--line)] px-2 py-2 align-top font-semibold">{<InlineView nodes={cell} renderText={renderText} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-b border-[var(--line)] px-2 py-2 align-top">{<InlineView nodes={cell} renderText={renderText} />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
