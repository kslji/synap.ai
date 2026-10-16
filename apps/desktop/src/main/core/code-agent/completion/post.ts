/**
 * Deterministic cleanup after the model. No disk writes.
 * Trim text the suffix already has, close brackets the completion opened,
 * and drop a suggestion that only repeats the surrounding code.
 */
import type { CompletionSpan } from './windows.js'

const BLOCK_LINE_CAP = 12

export function stopAtBoundary(text: string, span: CompletionSpan): string {
  const normalized = text.replace(/\r\n/g, '\n')
  if (span === 'line') {
    const nl = normalized.indexOf('\n')
    return stripEnd(nl === -1 ? normalized : normalized.slice(0, nl))
  }
  const body = normalized.replace(/^\n/, '')
  const lines = body.split('\n')
  const base = indentWidth(lines[0] ?? '')
  const kept: string[] = []
  for (let i = 0; i < lines.length && kept.length < BLOCK_LINE_CAP; i++) {
    const line = lines[i] ?? ''
    if (i > 0 && line.trim() === '') break
    if (i > 0 && line.trim() !== '' && indentWidth(line) < base) break
    kept.push(line)
  }
  return stripEnd(kept.join('\n'))
}

export function trimSuffixOverlap(completion: string, suffix: string): string {
  if (!completion || !suffix) return completion
  const max = Math.min(completion.length, suffix.length)
  for (let size = max; size > 0; size--) {
    if (completion.endsWith(suffix.slice(0, size))) return completion.slice(0, completion.length - size)
  }
  return completion
}

export function balanceBrackets(input: string): string {
  const stack: string[] = []
  let index = 0
  let cut = input.length
  while (index < input.length) {
    const ch = input[index]!
    if (ch === '/' && input[index + 1] === '/') {
      const nl = input.indexOf('\n', index)
      index = nl === -1 ? input.length : nl
      continue
    }
    if (ch === '#' && (index === 0 || input[index - 1] === '\n')) {
      const nl = input.indexOf('\n', index)
      index = nl === -1 ? input.length : nl
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      index = skipString(input, index)
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch === '(' ? ')' : ch === '[' ? ']' : '}')
      index++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0 || stack[stack.length - 1] !== ch) {
        cut = index
        break
      }
      stack.pop()
    }
    index++
  }
  const head = input.slice(0, cut)
  if (cut < input.length || stack.length === 0) return head
  return head + [...stack].reverse().join('')
}

export function isOnlyRepeat(completion: string, prefix: string, suffix: string): boolean {
  if (!completion.trim()) return true
  const forms = [completion, completion.trim()]
  for (const form of forms) {
    if (!form) continue
    if (prefix.endsWith(form)) return true
    if (suffix.startsWith(form)) return true
  }
  return false
}

export function finishCompletion(raw: string, prefix: string, suffix: string, span: CompletionSpan): string {
  const bounded = stopAtBoundary(raw, span)
  const trimmed = trimSuffixOverlap(bounded, suffix)
  const balanced = balanceBrackets(trimmed)
  const again = trimSuffixOverlap(balanced, suffix)
  if (isOnlyRepeat(again, prefix, suffix)) return ''
  return again
}

function indentWidth(line: string): number {
  const match = /^[ \t]*/.exec(line)
  return match ? match[0].length : 0
}

function stripEnd(text: string): string {
  return text.replace(/[ \t]+$/g, '')
}

function skipString(input: string, start: number): number {
  const quote = input[start]!
  let index = start + 1
  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2
      continue
    }
    if (input[index] === quote) return index + 1
    if (quote !== '`' && input[index] === '\n') return index
    index++
  }
  return index
}
