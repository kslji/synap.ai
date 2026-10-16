/**
 * llama.cpp chat completions for the Code agent loop.
 * Native tool schemas go out first. Grammar fields are added only on the fallback.
 */
import { LlamaClient, type ChatMessage } from '../llama-client.js'
import type { CompletionRequest } from './loop.js'
import type { ModelTurn } from './parse-tool.js'

export function llamaCompleter(client: LlamaClient): (req: CompletionRequest) => Promise<ModelTurn> {
  return async (req) => {
    const extras = llamaCompletionExtras(req)
    if (req.onDelta) {
      const res = await client.chatCollect(req.messages, req.tools, req.signal, req.maxTokens, extras, req.onDelta)
      return turnFrom(res.choices[0]?.message, res.usage)
    }
    const res = await client.chat(req.messages, req.tools, req.signal, req.maxTokens, extras)
    return turnFrom(res.choices[0]?.message, res.usage)
  }
}

export function llamaCompletionExtras(req: Pick<CompletionRequest, 'responseFormat' | 'grammar' | 'thinking' | 'cachePrompt'>): { response_format?: unknown; grammar?: string; enableThinking?: boolean; cachePrompt?: boolean } {
  return {
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
    ...(req.grammar ? { grammar: req.grammar } : {}),
    ...(req.thinking === undefined ? {} : { enableThinking: req.thinking }),
    ...(req.cachePrompt ? { cachePrompt: true } : {}),
  }
}

function turnFrom(message: ChatMessage | undefined, usage?: { prompt_tokens?: number; completion_tokens?: number }): ModelTurn {
  return {
    content: messageText(message?.content),
    toolCalls: message?.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    ...(usage ? { usage: { promptTokens: usage.prompt_tokens ?? 0, completionTokens: usage.completion_tokens ?? 0 } } : {}),
  }
}

function messageText(content: ChatMessage['content'] | undefined): string | null {
  if (typeof content === 'string') return content
  if (content == null) return null
  return content.map((part) => part.type === 'text' ? part.text : '').join('')
}
