/**
 * Deterministic number tasks. Comparison, ordering, counting, and arithmetic
 * are computed here and the chat answer is that result, not a model paraphrase.
 * The calculator worker still evaluates arithmetic. This module only decides
 * which tool to call and how to phrase the result.
 */
import type { Calculator } from './calculator.js'

export interface ToolHit {
  name: 'calculator' | 'unit_convert' | 'compare_numbers' | 'text_count'
  input: string
  output: string
  answer: string
}

const NUMBER = /(?<![\w.])\d+(?:\.\d+)?/g

export function numbersIn(text: string): { raw: string; value: number }[] {
  const found: { raw: string; value: number }[] = []
  for (const match of text.matchAll(NUMBER)) {
    const value = Number(match[0])
    if (Number.isFinite(value)) found.push({ raw: match[0], value })
  }
  return found
}

export function pureExpression(text: string): string | null {
  const trimmed = text.trim().replace(/^(what is|calculate|compute)\s+/i, '').replace(/\?$/, '').trim()
  if (!trimmed || trimmed.length > 180) return null
  if (!/^[\d\s.+\-*/%^()]+$/.test(trimmed)) return null
  if (!/\d/.test(trimmed) || !/[+\-*/%^]/.test(trimmed)) return null
  return trimmed
}

function corpusOf(text: string): string | null {
  const inside = text.match(/\b(?:in|inside)\s+"([^"]+)"/i) ?? text.match(/\b(?:in|inside)\s+'([^']+)'/i)
  if (inside) return inside[1].trim()
  const quoted = text.match(/"([^"]+)"|'([^']+)'/)
  if (quoted) return (quoted[1] ?? quoted[2] ?? '').trim()
  const colon = text.match(/:\s*([\s\S]+)$/)
  if (!colon) return null
  return colon[1].replace(/\s*reply with[\s\S]*$/i, '').replace(/\?\s*$/, '').trim()
}

export function compareFromText(text: string): ToolHit | null {
  const order = /\b(order|sort|rank)\b/i.test(text)
  const larger = /\b(larger|bigger|greater|highest|maximum|max)\b/i.test(text)
  const smaller = /\b(smaller|lesser|lowest|minimum|min)\b/i.test(text) && !/\bminutes?\b/i.test(text)
  if (!order && !larger && !smaller) return null
  const nums = numbersIn(text)
  if (nums.length < 2) return null
  const input = nums.map((item) => item.raw).join(', ')
  if (order && !/\b(which|what)\s+is\b/i.test(text)) {
    const desc = /\b(descending|largest to smallest|high to low|decreasing)\b/i.test(text)
    const sorted = [...nums].sort((a, b) => desc ? b.value - a.value : a.value - b.value)
    const list = sorted.map((item) => item.raw).join(', ')
    const answer = desc ? `Descending: ${list}.` : `Ascending: ${list}.`
    return { name: 'compare_numbers', input, output: answer, answer }
  }
  if (smaller && !larger) {
    const winner = pick(nums, (item, best) => item < best)
    const answer = `${winner.raw} is smaller.`
    return { name: 'compare_numbers', input, output: answer, answer }
  }
  const winner = pick(nums, (item, best) => item > best)
  const answer = `${winner.raw} is larger.`
  return { name: 'compare_numbers', input, output: answer, answer }
}

function pick(nums: { raw: string; value: number }[], better: (item: number, best: number) => boolean): { raw: string; value: number } {
  let winner = nums[0]
  for (const item of nums.slice(1)) {
    if (better(Number(item.value), Number(winner.value))) winner = item
  }
  return winner
}

export function countFromText(text: string): ToolHit | null {
  const corpus = corpusOf(text)
  if (!corpus) return null
  if (/\bhow many\s+hyphens?\b|\bhyphen characters\b/i.test(text)) {
    const count = corpus.match(/-/g)?.length ?? 0
    return countHit(corpus, count)
  }
  if (/\bhow many\s+dashes\b|\bdash characters\b/i.test(text)) {
    const count = corpus.match(/[-–—]/g)?.length ?? 0
    return countHit(corpus, count)
  }
  if (/\bhow many\s+words\b/i.test(text)) {
    const count = corpus.split(/\s+/).filter(Boolean).length
    return countHit(corpus, count)
  }
  if (/\b(how many\s+(characters|letters|chars)|string length|character length|length of|how long is)\b/i.test(text)) {
    return countHit(corpus, Array.from(corpus).length)
  }
  const times = text.match(/\bhow many times\s+(?:does\s+|do\s+|is\s+)?["']?(.+?)["']?\s+(?:appear|occur|show)/i)
  if (times) {
    const needle = times[1].trim().replace(/^["']|["']$/g, '')
    if (!needle) return null
    let count = 0
    let from = 0
    while (from <= corpus.length - needle.length) {
      const at = corpus.indexOf(needle, from)
      if (at < 0) break
      count += 1
      from = at + needle.length
    }
    return countHit(corpus, count)
  }
  return null
}

function countHit(corpus: string, count: number): ToolHit {
  const output = String(count)
  return { name: 'text_count', input: corpus, output, answer: output }
}

export function unitFromText(text: string): { value: number; from: string; to: string } | null {
  const unit = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z°/%]+)\s+(?:to|in|into)\s+([a-zA-Z°/%]+)/i)
  if (!unit) return null
  return { value: Number(unit[1]), from: unit[2], to: unit[3] }
}

export async function resolveDirectTool(calc: Calculator, text: string): Promise<ToolHit | null> {
  const compared = compareFromText(text)
  if (compared) return compared
  const counted = countFromText(text)
  if (counted) return counted
  const expr = pureExpression(text)
  if (expr) {
    const ran = await calc.calc(expr)
    if (!ran.ok) return null
    return { name: 'calculator', input: expr, output: ran.result, answer: ran.result }
  }
  const unit = unitFromText(text)
  if (!unit) return null
  const ran = await calc.convert(unit.value, unit.from, unit.to)
  if (!ran.ok) return null
  const answer = `${unit.value} ${unit.from} = ${ran.result}`
  return { name: 'unit_convert', input: `${unit.value} ${unit.from} -> ${unit.to}`, output: ran.result, answer }
}

/** The chat answer is the tool sentence. A model paraphrase is not kept. */
export function verbatimAnswer(answer: string, outputs: { name: string; output: string }[]): string {
  const hit = [...outputs].reverse().find((item) => {
    if (!['compare_numbers', 'text_count', 'calculator', 'unit_convert'].includes(item.name)) return false
    if (!item.output || item.output.startsWith('error') || item.output.startsWith('ignored')) return false
    return true
  })
  if (!hit) return answer
  if (hit.name === 'text_count' || hit.name === 'calculator') return hit.output
  if (hit.name === 'compare_numbers') return hit.output
  if (answer.includes(hit.output)) return answer
  return hit.output
}

export function asksForNumberTool(text: string): boolean {
  return compareFromText(text) !== null || countFromText(text) !== null || pureExpression(text) !== null || unitFromText(text) !== null
}

export const numberTools = [
  {
    type: 'function',
    function: {
      name: 'compare_numbers',
      description: 'Compare, order, or pick the min or max of the numbers in the user message. The result is exact. Repeat it verbatim.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'text_count',
      description: 'Count hyphens, dashes, words, characters, or occurrences in the text the user supplied. Repeat the number verbatim.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
] as const
