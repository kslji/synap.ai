/**
 * llama.cpp chat completions for the Code agent loop.
 * Native tool schemas go out first. Grammar fields are added only on the fallback.
 */
import { LlamaClient, type ChatMessage } from '../llama-client.js'
import type { CompletionRequest } from './loop.js'
import type { ModelTurn } from './parse-tool.js'

export function llamaCompleter(client: LlamaClient): (req: CompletionRequest) => Promise<ModelTurn> {
  return async (req) => {
    const res = await client.chat(req.messages, req.tools, req.signal, req.maxTokens, llamaCompletionExtras(req))
    const message = res.choices[0]?.message
    return {
      content: messageText(message?.content),
      toolCalls: message?.tool_calls?.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    }
  }
}

export function llamaCompletionExtras(req: Pick<CompletionRequest, 'responseFormat' | 'grammar' | 'thinking'>): { response_format?: unknown; grammar?: string; enableThinking?: boolean } {
  return {
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
    ...(req.grammar ? { grammar: req.grammar } : {}),
    ...(req.thinking === undefined ? {} : { enableThinking: req.thinking }),
  }
}

function messageText(content: ChatMessage['content'] | undefined): string | null {
  if (typeof content === 'string') return content
  if (content == null) return null
  return content.map((part) => part.type === 'text' ? part.text : '').join('')
}
