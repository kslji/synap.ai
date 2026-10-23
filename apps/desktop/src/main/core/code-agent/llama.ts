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
import type { ChatMessage, CompletionRequest, GenerateOptions, ModelProvider, ModelTurn } from '@surf/agent-core'
import { providerToComplete } from '@surf/agent-core'

export class LocalLlamaProvider implements ModelProvider {
  constructor(private readonly client: LlamaClient) {}

  async generate(messages: ChatMessage[], options: GenerateOptions): Promise<ModelTurn> {
    const req: CompletionRequest = { messages, ...options }
    const extras = llamaCompletionExtras(req)
    if (req.onDelta) {
      const res = await this.client.chatCollect(req.messages, req.tools, req.signal, req.maxTokens, extras, req.onDelta)
      return turnFrom(res.choices[0], res.usage)
    }
    const res = await this.client.chat(req.messages, req.tools, req.signal, req.maxTokens, extras)
    return turnFrom(res.choices[0], res.usage)
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
