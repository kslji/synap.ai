/**
 * Tool-call parsing for small models. Native tool_calls win.
 * Otherwise the reply is repaired into one JSON object.
 */
import { stripMarkdownFences } from '../../../shared/model-output.js'
import { devWebEnabled, type EnvLike } from '../dev-web-tools.js'
import { isCodeTool, type CodeToolName } from './tools.js'

const DEV_WEB_TOOLS = ['web_search', 'fetch_page'] as const
type DevWebToolName = typeof DEV_WEB_TOOLS[number]
export type LoopToolName = CodeToolName | DevWebToolName

export interface ModelTurn {
  content: string | null
  toolCalls?: { id?: string; name: string; arguments: string }[]
}

export interface ParsedCall {
  name: LoopToolName
  arguments: Record<string, unknown>
}

export function parseModelTurn(turn: ModelTurn, env?: EnvLike): ParsedCall | null {
  const native = turn.toolCalls?.[0]
  if (native?.name) {
    const args = parseArgs(native.arguments || '{}')
    const name = asTool(native.name, env)
    if (args && name) return { name, arguments: args }
  }
  if (!turn.content) return null
  try {
    return asCall(repairJson(turn.content), env)
  } catch {
    return null
  }
}

export function repairJson(raw: string): unknown {
  const candidate = extractJsonCandidate(raw)
  const variants = unique([
    candidate,
    removeTrailingCommas(candidate),
    balance(removeTrailingCommas(candidate)),
    balance(removeTrailingCommas(quoteKeys(candidate))),
    balance(removeTrailingCommas(quoteKeys(singleToDouble(candidate)))),
    balance(removeTrailingCommas(singleToDouble(candidate))),
  ])
  let last: unknown
  for (const text of variants) {
    try { return JSON.parse(text) } catch (error) { last = error }
  }
  throw last instanceof Error ? last : new Error('model output was not JSON')
}

export function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim()
  const tagged = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/i)
  const body = stripMarkdownFences(tagged?.[1] ?? trimmed)
  const start = body.indexOf('{')
  if (start < 0) return body
  const end = body.lastIndexOf('}')
  if (end > start) return body.slice(start, end + 1)
  return body.slice(start)
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value = repairJson(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* not JSON */ }
  return null
}

function asCall(value: unknown, env?: EnvLike): ParsedCall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Array.isArray(record.tool_calls) && record.tool_calls[0]) return asCall(record.tool_calls[0], env)
  const fn = record.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
    const nested = fn as Record<string, unknown>
    return build(nested.name, nested.arguments ?? record.arguments, env)
  }
  const name = record.tool ?? record.name
  if (typeof name !== 'string') return null
  if (record.arguments !== undefined || record.args !== undefined) {
    return build(name, record.arguments ?? record.args, env)
  }
  const rest: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'tool' || key === 'name') continue
    rest[key] = item
  }
  return build(name, rest, env)
}

function build(name: unknown, args: unknown, env?: EnvLike): ParsedCall | null {
  const tool = asTool(typeof name === 'string' ? name : '', env)
  if (!tool) return null
  if (typeof args === 'string') {
    const parsed = parseArgs(args)
    if (!parsed) return null
    return { name: tool, arguments: parsed }
  }
  if (args && typeof args === 'object' && !Array.isArray(args)) return { name: tool, arguments: args as Record<string, unknown> }
  if (args == null) return { name: tool, arguments: {} }
  return null
}

function asTool(name: string, env?: EnvLike): LoopToolName | null {
  const cleaned = name.trim().replace(/^functions\./, '')
  if (isCodeTool(cleaned)) return cleaned
  if (devWebEnabled(env) && (DEV_WEB_TOOLS as readonly string[]).includes(cleaned)) return cleaned as DevWebToolName
  return null
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

function quoteKeys(text: string): string {
  return text.replace(/([{\[,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
}

function singleToDouble(text: string): string {
  if (text.includes('"')) return text
  return text.replace(/'/g, '"')
}

function balance(text: string): string {
  let curly = 0
  let square = 0
  let quote = false
  let escape = false
  for (const ch of text) {
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') quote = false
      continue
    }
    if (ch === '"') { quote = true; continue }
    if (ch === '{') curly++
    else if (ch === '}') curly = Math.max(0, curly - 1)
    else if (ch === '[') square++
    else if (ch === ']') square = Math.max(0, square - 1)
  }
  return text + ']'.repeat(square) + '}'.repeat(curly)
}
