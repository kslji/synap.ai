/** Cursor windows and how many lines a completion may add. */

export const PREFIX_WINDOW_CHARS = 6_000
export const SUFFIX_WINDOW_CHARS = 1_500

export type CompletionSpan = 'line' | 'block'

export interface FileWindows {
  prefix: string
  suffix: string
  /** 1-based line of the cursor. */
  line: number
}

export function fileWindows(text: string, cursor: number): FileWindows {
  const pos = Math.max(0, Math.min(Math.floor(cursor), text.length))
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  return {
    prefix: before.slice(-PREFIX_WINDOW_CHARS),
    suffix: after.slice(0, SUFFIX_WINDOW_CHARS),
    line: before.split('\n').length,
  }
}

/** An empty cursor line, or a line that just opened a block, may complete more than one line. */
export function completionSpan(prefix: string, suffix: string): CompletionSpan {
  const lineStart = prefix.lastIndexOf('\n') + 1
  const before = prefix.slice(lineStart)
  const breakAt = suffix.indexOf('\n')
  const after = breakAt === -1 ? suffix : suffix.slice(0, breakAt)
  const emptyLine = before.trim() === '' && after.trim() === ''
  const blockStart = /[{:]\s*$/.test(prefix) || /=>\s*$/.test(prefix)
  return emptyLine || blockStart ? 'block' : 'line'
}

export function predictBudget(span: CompletionSpan): { maxTokens: number; stop: string[] } {
  const markers = ['<|fim_pad|>', '<|fim_middle|>', '<|endoftext|>', '<|im_end|>', '<|file_sep|>', '<|repo_name|>']
  if (span === 'line') return { maxTokens: 48, stop: ['\n', ...markers] }
  return { maxTokens: 128, stop: ['\n\n', ...markers] }
}
