/**
 * llama.cpp chat completions for the Code agent loop - the offline ModelProvider.
 * Native tool schemas go out first. Grammar fields are added only on the fallback.
 *
 * LocalLlamaProvider wraps a LlamaClient WITHOUT changing it, so the offline path
 * produces the identical ModelTurn the loop expects. `llamaCompleter` stays as the
 * one-line adapter so existing call-sites (and the routing/telemetry around them in
 * app-services) are unchanged.
 */
import { LlamaClient } from '../llama-client.js'
import { answerMessages, reasoningRequest } from '../thinking.js'
import type { ChatMessage, CompletionRequest, GenerateOptions, ModelProvider, ModelTurn } from '@surf/agent-core'
import { providerToComplete } from '@surf/agent-core'

export class LocalLlamaProvider implements ModelProvider {
  constructor(private readonly client: LlamaClient) {}

  /**
   * Planning and hard fixes think; everything else answers straight away. A thinking step is two
   * requests because the template ignores `reasoning_budget`: think up to the cap, then answer with
   * thinking off and that reasoning handed back. Only the answer streams to the caller.
   */
  async generate(messages: ChatMessage[], options: GenerateOptions): Promise<ModelTurn> {
    const req: CompletionRequest = { messages, ...options }
    if (req.thinking !== true) return this.answer(req)
    const thought = await this.think(req)
    const answered = await this.answer({ ...req, thinking: false, messages: answerMessages(req.messages, thought.reasoning) })
    const usage = mergeUsage(thought.usage, answered.usage)
    return usage ? { ...answered, usage } : answered
  }

  private async think(req: CompletionRequest): Promise<{ reasoning: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const cap = reasoningRequest()
    const extras = { enableThinking: cap.enableThinking, ...(req.cachePrompt ? { cachePrompt: true } : {}) }
    if (req.onReasoning) {
      const res = await this.client.chatCollect(req.messages, undefined, req.signal, cap.maxTokens, extras, () => undefined, req.onReasoning)
      return { reasoning: res.reasoning ?? '', ...(res.usage ? { usage: usageOf(res.usage) } : {}) }
    }
    const res = await this.client.chat(req.messages, undefined, req.signal, cap.maxTokens, extras)
    const message = res.choices[0]?.message as { reasoning_content?: string } | undefined
    return { reasoning: message?.reasoning_content ?? '', ...(res.usage ? { usage: usageOf(res.usage) } : {}) }
  }

  /** One request. Thinking is always explicit here, so no path can inherit it by accident. */
  private async answer(req: CompletionRequest): Promise<ModelTurn> {
    const extras = { ...llamaCompletionExtras(req), enableThinking: false }
    if (req.onDelta) {
      const res = await this.client.chatCollect(req.messages, req.tools, req.signal, req.maxTokens, extras, req.onDelta, req.onReasoning)
      return turnFrom(res.choices[0], res.usage)
    }
    const res = await this.client.chat(req.messages, req.tools, req.signal, req.maxTokens, extras)
    return turnFrom(res.choices[0], res.usage)
  }
}

function usageOf(usage: { prompt_tokens?: number; completion_tokens?: number }): { promptTokens: number; completionTokens: number } {
  return { promptTokens: usage.prompt_tokens ?? 0, completionTokens: usage.completion_tokens ?? 0 }
}

function mergeUsage(
  first?: { promptTokens: number; completionTokens: number },
  second?: { promptTokens: number; completionTokens: number },
): { promptTokens: number; completionTokens: number } | undefined {
  if (!first && !second) return undefined
  return {
    promptTokens: (first?.promptTokens ?? 0) + (second?.promptTokens ?? 0),
    completionTokens: (first?.completionTokens ?? 0) + (second?.completionTokens ?? 0),
  }
}

export function llamaCompleter(client: LlamaClient): (req: CompletionRequest) => Promise<ModelTurn> {
  return providerToComplete(new LocalLlamaProvider(client))
}

export function llamaCompletionExtras(req: Pick<CompletionRequest, 'responseFormat' | 'grammar' | 'thinking' | 'cachePrompt'>): { response_format?: unknown; grammar?: string; enableThinking?: boolean; cachePrompt?: boolean } {
  return {
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
    ...(req.grammar ? { grammar: req.grammar } : {}),
    ...(req.thinking === undefined ? {} : { enableThinking: req.thinking }),
    ...(req.cachePrompt ? { cachePrompt: true } : {}),
  }
}

function turnFrom(
  choice: { message?: ChatMessage; finish_reason?: string } | undefined,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
): ModelTurn {
  const message = choice?.message
  return {
    content: messageText(message?.content),
    toolCalls: message?.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    ...(usage ? { usage: { promptTokens: usage.prompt_tokens ?? 0, completionTokens: usage.completion_tokens ?? 0 } } : {}),
    // The loop ignores this; the general chat uses it for the same Continue affordance
    // the online turn gets, so neither path has to guess whether a reply was cut off.
    ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
  }
}

function messageText(content: ChatMessage['content'] | undefined): string | null {
  if (typeof content === 'string') return content
  if (content == null) return null
  return content.map((part) => part.type === 'text' ? part.text : '').join('')
}
