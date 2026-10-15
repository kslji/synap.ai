/**
 * Keep a Code agent prompt inside the request budget.
 * The system message and the latest user message stay. Older tool results drop first.
 */
import type { ChatMessage } from '../llama-client.js'
import { PER_MESSAGE_OVERHEAD, truncateToTokens, type TokenCounter } from '../token-budget.js'

export async function fitAgentMessages(counter: TokenCounter, messages: ChatMessage[], budget: number): Promise<ChatMessage[]> {
  if (!messages.length) return []
  const system = messages[0]?.role === 'system' ? clone(messages[0]) : null
  let body = (system ? messages.slice(1) : messages).map(clone)
  const size = (msgs: ChatMessage[]) => measure(counter, msgs)
  while (body.length > 1 && await size(system ? [system, ...body] : body) > budget) body.shift()
  let packed = system ? [system, ...body] : body
  if (await size(packed) > budget && packed.length) {
    const last = packed[packed.length - 1]
    if (last) {
      const head = packed.slice(0, -1)
      const used = head.length ? await size(head) : 0
      const room = Math.max(32, budget - used - PER_MESSAGE_OVERHEAD)
      packed = [...head, { ...last, content: await truncateToTokens(counter, textOf(last), room) }]
    }
  }
  if (system && packed[0] && await size(packed) > budget) {
    const room = Math.max(32, Math.floor(budget * 0.6))
    packed = [{ ...system, content: await truncateToTokens(counter, textOf(system), room) }, ...packed.slice(1)]
  }
  return packed
}

async function measure(counter: TokenCounter, messages: ChatMessage[]): Promise<number> {
  let total = 0
  for (const message of messages) total += await counter.count(textOf(message)) + PER_MESSAGE_OVERHEAD
  return total
}

function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  if (message.content == null) return ''
  return message.content.map((part) => part.type === 'text' ? part.text : '').join('')
}

function clone(message: ChatMessage): ChatMessage {
  return { ...message, content: message.content }
}
