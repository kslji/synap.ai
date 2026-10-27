/**
 * Gateway ModelProvider for the online code agent.
 *
 * It calls the stateless messages+tools endpoint (POST /api/v1/agent/completions),
 * streams the result, and normalizes it into the SAME ModelTurn the offline path
 * produces - assembling tool-call deltas exactly like LlamaClient.chatCollect does,
 * so online tool JSON is byte-comparable to offline. The loop and UI never branch on
 * provider; this file is the only place that knows about the gateway.
 *
 * The 401 / 402 / 429 user-facing copies from gatewayChat are preserved.
 */
import type { ChatMessage, GenerateOptions, ModelProvider, ModelTurn } from '@surf/agent-core'
import { ModelLockedError } from './gateway-chat.js'

export interface GatewayProviderOpts {
  baseUrl: string
  token: string
  /** One cloud model id for every step; the loop's stepKind routing is a local concern. */
  model: string
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

type ToolCallDelta = { index?: number; id?: string; function?: { name?: string; arguments?: string } }

export class GatewayProvider implements ModelProvider {
  constructor(private readonly opts: GatewayProviderOpts) {}

  async generate(messages: ChatMessage[], options: GenerateOptions): Promise<ModelTurn> {
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      stream: true,
      max_tokens: options.maxTokens,
    }
    if (options.tools?.length) body.tools = options.tools
    if (options.responseFormat) body.response_format = options.responseFormat
    if (options.grammar) body.grammar = options.grammar
    if (options.thinking !== undefined) body.thinking = options.thinking

    const res = await fetchImpl(`${trim(this.opts.baseUrl)}/api/v1/agent/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (res.status === 403) {
      // The agent endpoint shares the tier gate; a locked model is an unlock, not a dead end.
      const body = (await res.json().catch(() => ({}))) as { error?: string; model_id?: string; required_credits?: number; unlock_usd?: number }
      if (body.error === 'model_locked') {
        throw new ModelLockedError(body.model_id || this.opts.model, Number(body.required_credits) || 0, Number(body.unlock_usd) || 0)
      }
      throw new Error((await detailOf(res)) || 'That model is not available to this account.')
    }
    if (res.status === 402) throw new Error((await detailOf(res)) || 'Insufficient Surf balance. Top up to keep using cloud models.')
    if (res.status === 401) throw new Error('Please sign in again to use cloud models.')
    if (res.status === 429) throw new Error('The cloud model is busy. Please try again in a moment.')
    if (!res.ok || !res.body) throw new Error((await detailOf(res)) || `Could not reach the cloud model (${res.status}).`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let finishReason: string | undefined
    let usage: ModelTurn['usage']
    const calls = new Map<number, { id: string; name: string; arguments: string }>()

    const take = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') return
      let chunk: {
        choices?: Array<{ delta?: { content?: string; tool_calls?: ToolCallDelta[] }; finish_reason?: string | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        error?: { message?: string } | string
      }
      try {
        chunk = JSON.parse(payload)
      } catch {
        return // keepalive or a partial frame
      }
      if (chunk.error) {
        const message = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
        throw new Error(message || 'The cloud model is unavailable right now. Please try again.')
      }
      if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 }
      const choice = chunk.choices?.[0]
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta
      if (delta?.content) {
        content += delta.content
        options.onDelta?.(delta.content)
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        const row = calls.get(index) ?? { id: '', name: '', arguments: '' }
        if (call.id) row.id = call.id
        if (call.function?.name) row.name += call.function.name
        if (call.function?.arguments) row.arguments += call.function.arguments
        calls.set(index, row)
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        take(line)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) take(buffer)

    const toolCalls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => ({ id: call.id || `call-${calls.size}`, name: call.name, arguments: call.arguments }))
      .filter((call) => call.name)

    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    }
  }
}

function trim(url: string): string {
  return url.replace(/\/+$/, '')
}

async function detailOf(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: { message?: string } }
  return body.detail || body.error?.message || null
}
