/** Triage uses the 2B chat model with thinking off and this JSON schema. Extra keys are rejected. */

export const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['priority', 'summary'],
  properties: {
    priority: { type: 'string', enum: ['now', 'soon', 'later'] },
    summary: { type: 'string' },
  },
} as const

export function triageBody(messages: { role: string; content: string }[]): Record<string, unknown> {
  return {
    model: 'chat',
    messages,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
    response_format: { type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } },
  }
}

export function parseTriage(raw: string): { priority: 'now' | 'soon' | 'later'; summary: string } | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const keys = Object.keys(value)
    if (keys.some((key) => key !== 'priority' && key !== 'summary')) return null
    if (value.priority !== 'now' && value.priority !== 'soon' && value.priority !== 'later') return null
    if (typeof value.summary !== 'string' || !value.summary.trim()) return null
    return { priority: value.priority, summary: value.summary }
  } catch {
    return null
  }
}

export function fimPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
}
