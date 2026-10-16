/**
 * What a Code-agent screenshot is for. The route is fixed before any model call.
 * Ask and Auto gates still apply when the task goes on to the plan and patch flow.
 */
export type ShotUse = 'error' | 'mockup' | 'compare' | 'describe'

const COMPARE = /\b(compar(?:e|ing|ison)|differ(?:s|ence|ences)?|versus|expected|side by side)\b/i
const MOCKUP = /\b(mock-?up|wireframe|layout|component|design)\b/i
const CHANGE = /\b(fix|implement|build|generate|adjust|change|update|add|make|create|match)\b/i
const ERROR = /\b(error|exception|traceback|stack|crash|fail(?:ed|ure)?|bug|TypeError|ReferenceError|broken)\b/i

export const VISION_PROMPTS = {
  error: 'Quote only the error text visible in the screenshot. Do not propose a fix.',
  mockup: 'Describe the layout: regions, labels, and controls. Do not write code.',
  compare: 'Describe the visible differences. Use only the measurements in the message. Do not invent numbers.',
} as const

export function classifyShotUse(text: string, imageCount: number): ShotUse {
  const compare = imageCount >= 2 && COMPARE.test(text)
  if (compare && CHANGE.test(text)) return 'mockup'
  if (compare) return 'compare'
  if (MOCKUP.test(text) && CHANGE.test(text)) return 'mockup'
  if (ERROR.test(text)) return 'error'
  return 'describe'
}

export function refineShotUse(use: ShotUse, userText: string, errorLines: readonly string[]): ShotUse {
  if (use === 'compare' || use === 'mockup') return use
  if (errorLines.length > 0 && (use === 'error' || /\b(fix|error|fail|bug|broken|why)\b/i.test(userText))) return 'error'
  return use
}

export function errorBlock(lines: readonly string[]): string {
  const body = lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- No error text could be read from the screenshot.'
  return [
    'Error text read from the screenshot on this computer:',
    body,
    'Fix this error in the project. Use the run and check loop. Do not claim it is fixed until the check passes.',
  ].join('\n')
}

export function mockupBlock(description: string): string {
  const notes = description.trim() || 'No layout text could be read from the screenshot.'
  return [
    'UI mockup notes. The patch still goes through Ask or Auto:',
    notes,
    'Generate or adjust the component so the code matches this layout. Do not skip approval.',
  ].join('\n')
}

export function imagesForAgent(agentId: string): boolean {
  return agentId === 'code'
}
