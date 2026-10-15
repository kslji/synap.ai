export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
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
