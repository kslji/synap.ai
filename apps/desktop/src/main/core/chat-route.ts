/**
 * Where a chat turn goes, decided before any model call.
 * Arithmetic is computed by the calculator. The model only phrases that result.
 */

export const DEVICE_REPLY =
  "Controlling this computer isn't available yet. I can answer questions, work out maths, and help with code after you open a project folder."

export const FOLDER_PROMPT =
  'To work on files, open a project folder. Questions work without one.'

export const NO_MODEL_MESSAGE =
  'Get your model from synap.surf to start chatting\nhttps://synap.surf/#download'

const LEAD = /^(?:please\s+)?(?:can you\s+)?(?:what(?:'s|s| is)?|calculate|compute|how much is)\s+/i
const EXPR = /^[\d\s.+\-*/%^()]+$/
const DEVICE = /\b(?:take control|control (?:my |this |the )?(?:laptop|computer|mac|pc|machine)|on my (?:laptop|computer)|click (?:the |on )|move the mouse|press (?:the )?(?:key|button)|open (?:finder|terminal|safari|chrome)|open (?:my |the |some )?files|type (?:this|that) for me|do this on my computer|control the (?:mouse|keyboard|screen))\b/i
const FILES = /\b(?:edit|change|refactor|fix|rename|delete|update|modify|rewrite)\b[^.]{0,48}\b(?:file|files|folder|project|repo|codebase)\b|\b(?:in|inside) (?:this|the|my) (?:project|repo|folder|codebase)\b|\bopen (?:a |the )?(?:project )?folder\b|\blook at [^.]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cpp|c|h)\b/i

export interface CalcJob {
  kind: 'calc'
  expression: string
  label: string
}

export interface ConvertJob {
  kind: 'convert'
  value: number
  from: string
  to: string
  label: string
}

export type MathJob = CalcJob | ConvertJob

export type TurnKind = 'device' | 'folder' | 'math' | 'model'

export interface TurnPlan {
  kind: TurnKind
  math?: MathJob
}

const SMALL_WORD: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3,
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

function smallNumber(token: string): number | null {
  const numeric = Number(token)
  if (token.trim() !== '' && Number.isFinite(numeric)) return numeric
  return SMALL_WORD[token.toLowerCase()] ?? null
}

/**
 * A rate-per-day word problem becomes one calculator expression.
 * "Thrice a day for 5 days, and twice that on 2 other days" is
 * ((3*5)+(3*2*2)). Two named people ("Chase and Rider") who are
 * asked about as "they" are counted once each.
 */
export function wordProblem(text: string): { expression: string; label: string } | null {
  const rate = text.match(/\b(once|twice|thrice|one|two|three|\d+)\s+(?:times?\s+)?(?:a|per)\s+day\s+for\s+(once|twice|thrice|one|two|three|four|five|six|seven|\d+)\s+days\b/i)
  const other = text.match(/\bon\s+(one|two|three|four|five|six|seven|\d+)\s+other\s+days\b[\s\S]{0,120}?\b(once|twice|thrice|one|two|three|\d+)\s+the\s+times\b/i)
  if (!rate || !other) return null
  const perDay = smallNumber(rate[1] ?? '')
  const usualDays = smallNumber(rate[2] ?? '')
  const otherDays = smallNumber(other[1] ?? '')
  const multiplier = smallNumber(other[2] ?? '')
  if (perDay == null || usualDays == null || otherDays == null || multiplier == null) return null
  const pair = text.match(/\b([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)\b/)
  const people = pair && /\bthey\b/i.test(text) ? 2 : 1
  const expression = `((${perDay}*${usualDays})+(${perDay}*${multiplier}*${otherDays}))*${people}`
  const label = `((${perDay} * ${usualDays}) + (${perDay} * ${multiplier} * ${otherDays})) * ${people}`
  return { expression, label }
}

export function mathExpression(text: string): string | null {
  const bare = text.trim().replace(/[?.!]+$/g, '').trim()
  const stripped = bare.replace(LEAD, '').trim()
  const candidate = EXPR.test(stripped) ? stripped : EXPR.test(bare) ? bare : ''
  if (!candidate || !/\d/.test(candidate) || !/[+\-*/%^]/.test(candidate)) return null
  return candidate.replace(/\s+/g, ' ').trim()
}

export function mathJob(text: string): MathJob | null {
  const unit = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z°/%]+)\s+(?:to|in|into)\s+([a-zA-Z°/%]+)/i)
  if (unit && !FILES.test(text)) {
    const value = Number(unit[1])
    if (Number.isFinite(value)) {
      return { kind: 'convert', value, from: unit[2], to: unit[3], label: `${unit[1]} ${unit[2]} in ${unit[3]}` }
    }
  }
  const expression = mathExpression(text)
  if (expression) return { kind: 'calc', expression: expression.replace(/\s+/g, ''), label: expression.replace(/\s+/g, ' ') }
  const word = wordProblem(text)
  if (!word) return null
  return { kind: 'calc', expression: word.expression, label: word.label }
}

export function wantsDeviceControl(text: string): boolean {
  return DEVICE.test(text)
}

export function wantsProjectFiles(text: string): boolean {
  return FILES.test(text)
}

export function routeTurn(input: { text: string; hasFolder: boolean }): TurnPlan {
  const text = input.text.trim()
  if (!text) return { kind: 'model' }
  if (wantsDeviceControl(text)) return { kind: 'device' }
  const math = mathJob(text)
  if (math) return { kind: 'math', math }
  if (wantsProjectFiles(text) && !input.hasFolder) return { kind: 'folder' }
  // Web search is deleted: every remaining turn is answered on this computer.
  return { kind: 'model' }
}

/** A number counts only as its own token, so 4 does not match inside 14. */
export function resultShown(text: string, result: string): boolean {
  const token = result.trim()
  if (!token || !text.trim()) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\d.])${escaped}(?:\\.(?!\\d)|[^\\d.]|$)`).test(text)
}

/** Keep the model's sentence only when it repeats the calculator's number. */
export function phraseMath(label: string, result: string, modelText: string): string {
  const clean = modelText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\s+/g, ' ').trim()
  if (clean && resultShown(clean, result)) return clean
  return `${label} = ${result}`
}
