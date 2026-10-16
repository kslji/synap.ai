/**
 * Fill-in-the-middle prompts for Qwen2.5-Coder and Qwen3.5-compatible models.
 * A tokenizer probe wins: one token for <|fim_prefix|> means the model has the marker.
 * Without a probe, known Qwen coder ids use FIM and everything else is prefix-only.
 */
export const FIM_PREFIX = '<|fim_prefix|>'
export const FIM_SUFFIX = '<|fim_suffix|>'
export const FIM_MIDDLE = '<|fim_middle|>'

export interface PromptSnippet {
  path: string
  symbol: string
  text: string
}

export interface CompletionPrompt {
  prompt: string
  mode: 'fim' | 'prefix'
}

const FIM_MODEL = /qwen2\.5-coder|qwen3-coder|qwen3\.5/i

export function fimFromProbe(markerTokens: number | null, modelId: string): boolean {
  if (markerTokens != null) return markerTokens === 1
  return FIM_MODEL.test(modelId)
}

export function buildCompletionPrompt(input: {
  prefix: string
  suffix: string
  path: string
  snippets: readonly PromptSnippet[]
  fim: boolean
}): CompletionPrompt {
  const notes = input.snippets
    .map((snippet) => `# ${snippet.path} ${snippet.symbol}\n${snippet.text.trim()}`)
    .filter((block) => block.trim().length > 0)
    .join('\n\n')
  const file = notes ? `${notes}\n\n# ${input.path}\n${input.prefix}` : input.prefix
  if (!input.fim) return { prompt: file, mode: 'prefix' }
  return {
    prompt: `${FIM_PREFIX}${file}${FIM_SUFFIX}${input.suffix}${FIM_MIDDLE}`,
    mode: 'fim',
  }
}
