/**
 * Where a chat turn goes, decided before any model call or web request.
 * Arithmetic is computed by the calculator. The model only phrases that result.
 */

export const DEVICE_REPLY =
  "Controlling this computer isn't available yet. I can answer questions, work out maths, and help with code after you open a project folder."

export const FOLDER_PROMPT =
  'To work on files, open a project folder. Questions work without one.'

export const WEB_FAIL_NOTE =
  "I couldn't check the web just now, so this answer is from the model on this computer."

export const OFFLINE_WEB_NOTE =
  'The network is off, so I did not search the web.'

export const NO_MODEL_MESSAGE =
  'Get your model from synap.surf to start chatting\nhttps://synap.surf/#download'

const LEAD = /^(?:please\s+)?(?:can you\s+)?(?:what(?:'s|s| is)?|calculate|compute|how much is)\s+/i
const EXPR = /^[\d\s.+\-*/%^()]+$/
const DEVICE = /\b(take control|control (?:my|this|the) (?:laptop|computer|mac|pc|machine)|on my (?:laptop|computer)|click (?:the |on )|move the mouse|press (?:the )?(?:key|button)|open (?:finder|terminal|safari|chrome)|type (?:this|that) for me|do this on my computer|control the (?:mouse|keyboard|screen))\b/i
const FILES = /\b(?:edit|change|refactor|fix|rename|delete|update|modify|rewrite)\b[^.]{0,48}\b(?:file|files|folder|project|repo|codebase)\b|\b(?:in|inside) (?:this|the|my) (?:project|repo|folder|codebase)\b|\bopen (?:a |the )?(?:project )?folder\b|\blook at [^.]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cpp|c|h)\b/i
const FRESH = /\b(latest|today|tonight|yesterday|this week|right now|current(?:ly)?|breaking|news|headline|weather|price|prices|stock|who won)\b|\b20(?:2[4-9]|[3-9]\d)\b/i

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

export type TurnKind = 'device' | 'folder' | 'math' | 'web' | 'model'

export interface TurnPlan {
  kind: TurnKind
  math?: MathJob
  /** Shown with a model answer when search did not run. */
  note?: string
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
  if (!expression) return null
  return { kind: 'calc', expression: expression.replace(/\s+/g, ''), label: expression.replace(/\s+/g, ' ') }
}

export function wantsDeviceControl(text: string): boolean {
  return DEVICE.test(text)
}

export function wantsProjectFiles(text: string): boolean {
  return FILES.test(text)
}

export function wantsFreshInfo(text: string): boolean {
  return FRESH.test(text)
}

export function routeTurn(input: {
  text: string
  webChip: boolean
  online: boolean
  offlineOnly: boolean
  hasFolder: boolean
}): TurnPlan {
  const text = input.text.trim()
  if (!text) return { kind: 'model' }
  if (wantsDeviceControl(text)) return { kind: 'device' }
  const math = mathJob(text)
  if (math) return { kind: 'math', math }
  if (wantsProjectFiles(text) && !input.hasFolder) return { kind: 'folder' }
  const askWeb = input.webChip || wantsFreshInfo(text)
  if (!askWeb) return { kind: 'model' }
  if (input.offlineOnly || !input.online) return { kind: 'model', note: OFFLINE_WEB_NOTE }
  return { kind: 'web' }
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

/** The worldwide-sources line is only for an answer that used web pages. */
export function withWebBanner(answer: string, label: string, usedWeb: boolean): string {
  const banner = `Showing results for ${label}.`
  if (!usedWeb) return answer.split(banner).join('').replace(/\n{3,}/g, '\n\n').trim()
  if (answer.includes(banner)) return answer
  return `${banner}\n${answer}`
}
