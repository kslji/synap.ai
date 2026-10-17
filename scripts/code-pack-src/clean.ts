/** Turn upstream markup into markdown-ish text for the Code pack chunker. */

export function htmlToMarkdown(html: string): string {
  let text = dropBlock(html, 'script')
  text = dropBlock(text, 'style')
  text = dropBlock(text, 'nav')
  text = dropBlock(text, 'footer')
  text = text.replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, body: string) => {
    const title = stripTags(body).trim()
    return title ? `\n\n${'#'.repeat(Number(level))} ${title}\n\n` : '\n'
  })
  text = text.replace(/<\/(p|div|li|tr|section|article|pre|blockquote)>/gi, '\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '\n- ')
  text = stripTags(text)
  return decode(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function rstToMarkdown(rst: string): string {
  const lines = rst.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const next = lines[i + 1] ?? ''
    if (line.trim() && /^[=\-~^"]{3,}$/.test(next.trim()) && next.trim().length >= Math.min(line.trim().length, 3)) {
      const level = next.trim().startsWith('=') ? '#' : next.trim().startsWith('-') ? '##' : '###'
      out.push(`${level} ${line.trim()}`)
      i++
      continue
    }
    if (/^\.\. /.test(line)) continue
    out.push(line
      .replace(/:mod:`~?([^`]+)`/g, '$1')
      .replace(/:meth:`~?([^`]+)`/g, '$1')
      .replace(/:func:`~?([^`]+)`/g, '$1')
      .replace(/:class:`~?([^`]+)`/g, '$1')
      .replace(/:exc:`~?([^`]+)`/g, '$1')
      .replace(/:ref:`([^<`]*)(?:<[^>]+>)?`/g, '$1')
      .replace(/``([^`]+)``/g, '$1')
      .replace(/`([^`]+)`/g, '$1'))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function javaDocToMarkdown(source: string, heading: string): string {
  const blocks: string[] = [`# ${heading}`]
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*(?:@[^\n]*\n\s*)*(?:(?:public|protected|private)\s+)?([^\n{;]{0,180})/g
  let match: RegExpExecArray | null
  let count = 0
  while ((match = pattern.exec(source)) && count < 40) {
    const comment = match[1].split('\n').map((line) => line.replace(/^\s*\*\s?/, '')).join('\n').trim()
    const sig = match[2].trim()
    if (comment.length < 40) continue
    blocks.push(`## ${sig || heading}\n\n${comment}`)
    count++
  }
  return blocks.join('\n\n')
}

export function goDocToMarkdown(source: string, heading: string): string {
  const lines = source.split('\n')
  const comments: string[] = []
  for (const line of lines) {
    if (line.startsWith('//')) comments.push(line.replace(/^\/\/\s?/, ''))
    else if (comments.length && line.trim() === '') comments.push('')
    else if (comments.length && !line.startsWith('package') && comments.length > 8) break
  }
  return `# ${heading}\n\n${comments.join('\n').trim()}`
}

export function rustDocToMarkdown(source: string, heading: string): string {
  const lines = source.split('\n')
  const comments: string[] = []
  for (const line of lines) {
    if (line.trim().startsWith('//!') || line.trim().startsWith('///')) {
      comments.push(line.replace(/^\s*\/\/\/?!?\s?/, ''))
    } else if (comments.length > 12 && line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('#')) {
      comments.push('')
      comments.push(line.trim())
      if (comments.length > 80) break
    }
  }
  return `# ${heading}\n\n${comments.join('\n').trim()}`
}

export function texiToMarkdown(texi: string): string {
  return texi
    .replace(/@node .*/g, '')
    .replace(/@chapter (.*)/g, '# $1')
    .replace(/@section (.*)/g, '## $1')
    .replace(/@subsection (.*)/g, '### $1')
    .replace(/@subsubsection (.*)/g, '#### $1')
    .replace(/@\w+\{([^}]*)\}/g, '$1')
    .replace(/@\w+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function dropBlock(html: string, tag: string): string {
  let out = html
  const open = `<${tag}`
  const close = `</${tag}`
  for (let n = 0; n < 32; n++) {
    const start = out.toLowerCase().indexOf(open)
    if (start < 0) break
    const from = start + open.length
    const end = out.toLowerCase().indexOf(close, from)
    if (end < 0) {
      out = `${out.slice(0, start)}${out.slice(from)}`
      continue
    }
    const after = out.indexOf('>', end + close.length)
    out = `${out.slice(0, start)}${out.slice(after < 0 ? end + close.length : after + 1)}`
  }
  return out
}

function stripTags(value: string): string {
  let out = value.replace(/<[^>]*>/g, '')
  while (/<script/i.test(out) || /<style/i.test(out)) {
    out = out.replace(/<script/gi, '').replace(/<style/gi, '')
  }
  return out
}

function decode(value: string): string {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
  }
  return value.replace(/&(?:nbsp|amp|lt|gt|quot|#39|#x27);/g, (entity) => named[entity] ?? entity)
}
