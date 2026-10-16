/**
 * Inline completion. Debounce, cancel, cache, FIM or prefix prompt, then post-process.
 * This module never writes a file. Acceptance is an editor edit.
 */
import { CompletionCache, type CacheKey } from './cache.js'
import { COMPLETION_DEBOUNCE_MS, LatestCall } from './debounce.js'
import { buildCompletionPrompt, fimFromProbe, type PromptSnippet } from './fim.js'
import { finishCompletion } from './post.js'
import { SNIPPET_TOKEN_BUDGET, selectSnippets, type IndexedSnippet } from './snippets.js'
import { completionSpan, fileWindows, predictBudget, type CompletionSpan } from './windows.js'

export interface CompletionInput {
  sessionId: string
  path: string
  language: string
  text: string
  cursor: number
}

export interface CompletionResult {
  text: string
  mode: 'fim' | 'prefix' | 'none'
  cached: boolean
  latencyMs: number
  span: CompletionSpan | 'none'
}

export interface ModelCompletion {
  prompt: string
  maxTokens: number
  stop: string[]
  /** llama.cpp reuses the prompt prefix when the server has a prompt cache. */
  cachePrompt: boolean
  signal: AbortSignal
}

export interface CompletionHost {
  enabled(): boolean
  languageOn(language: string): boolean
  modelId(): string
  /** Token count of <|fim_prefix|>, or null when the tokenizer cannot be asked. */
  probeFim(signal: AbortSignal): Promise<number | null>
  complete(req: ModelCompletion): Promise<string>
  snippets(path: string, line: number, budget: number): Promise<{ imported: IndexedSnippet[]; nearby: IndexedSnippet[] }>
  /** Counts and timings only. Never the prompt or the completion text. */
  log(line: string): void
}

export class CompletionService {
  private readonly sessions = new Map<string, LatestCall>()
  private readonly cache = new CompletionCache()

  constructor(private readonly host: CompletionHost, private readonly waitMs = COMPLETION_DEBOUNCE_MS) {}

  suggest(input: CompletionInput): Promise<CompletionResult> {
    const session = input.sessionId || 'default'
    let gate = this.sessions.get(session)
    if (!gate) {
      gate = new LatestCall(this.waitMs)
      this.sessions.set(session, gate)
    }
    return gate.run((signal) => this.run(input, signal)).then((result) => result ?? emptyResult(0))
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.cancel()
  }

  private async run(input: CompletionInput, signal: AbortSignal): Promise<CompletionResult> {
    const started = Date.now()
    if (!this.host.enabled() || !this.host.languageOn(input.language)) return emptyResult(0)
    const windows = fileWindows(input.text, input.cursor)
    if (!windows.prefix.trim() && !windows.suffix.trim()) return emptyResult(0)
    const span = completionSpan(windows.prefix, windows.suffix)
    const key: CacheKey = { prefix: windows.prefix, suffix: windows.suffix, language: input.language }
    const cached = this.cache.get(key)
    if (cached != null) {
      const text = finishCompletion(cached, windows.prefix, windows.suffix, span)
      const latencyMs = Date.now() - started
      this.host.log(`[surf] completion ms=${latencyMs} cached=1 mode=prefix span=${span} debounce=${this.waitMs}`)
      return { text, mode: text ? 'prefix' : 'none', cached: true, latencyMs, span }
    }
    if (signal.aborted) return emptyResult(Date.now() - started)
    const hints = await this.host.snippets(input.path, windows.line, SNIPPET_TOKEN_BUDGET)
    if (signal.aborted) return emptyResult(Date.now() - started)
    const snippets: PromptSnippet[] = await selectSnippets(hints.imported, hints.nearby, SNIPPET_TOKEN_BUDGET, async (text) => Math.ceil(text.length / 3.2))
    const marker = await this.host.probeFim(signal)
    if (signal.aborted) return emptyResult(Date.now() - started)
    const fim = fimFromProbe(marker, this.host.modelId())
    const built = buildCompletionPrompt({
      prefix: windows.prefix,
      suffix: windows.suffix,
      path: input.path,
      snippets,
      fim,
    })
    const budget = predictBudget(span)
    const raw = await this.host.complete({
      prompt: built.prompt,
      maxTokens: budget.maxTokens,
      stop: budget.stop,
      cachePrompt: true,
      signal,
    })
    if (signal.aborted) return emptyResult(Date.now() - started)
    const text = finishCompletion(raw, windows.prefix, windows.suffix, span)
    if (text) this.cache.put(key, text)
    const latencyMs = Date.now() - started
    this.host.log(`[surf] completion ms=${latencyMs} cached=0 mode=${built.mode} span=${span} snippets=${snippets.length} debounce=${this.waitMs}`)
    return { text, mode: text ? built.mode : 'none', cached: false, latencyMs, span }
  }
}

function emptyResult(latencyMs: number): CompletionResult {
  return { text: '', mode: 'none', cached: false, latencyMs, span: 'none' }
}
