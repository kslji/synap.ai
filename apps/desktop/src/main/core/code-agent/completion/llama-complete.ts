/**
 * llama.cpp /completion. cache_prompt asks the server to reuse the KV cache for a shared prompt prefix.
 * The chat sidecar starts with -cram 0, which leaves that cache off to save RAM. The flag is still sent
 * so a build that has a prompt cache can reuse it. Completions do not use the chat sampling preset.
 */

export interface LlamaCompletionRequest {
  prompt: string
  maxTokens: number
  stop: string[]
  cachePrompt: boolean
  signal?: AbortSignal
}

export async function llamaComplete(baseUrl: string, apiKey: string, req: LlamaCompletionRequest): Promise<string> {
  const response = await fetch(`${baseUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      prompt: req.prompt,
      n_predict: req.maxTokens,
      temperature: 0,
      top_k: 1,
      stop: req.stop,
      cache_prompt: req.cachePrompt,
      stream: false,
    }),
    signal: req.signal,
  })
  if (!response.ok) throw new Error(`llama-server /completion: HTTP ${response.status}`)
  const json = await response.json() as { content?: string }
  return typeof json.content === 'string' ? json.content : ''
}

/** How many pieces <|fim_prefix|> becomes. One piece means the model has the FIM marker. */
export async function fimMarkerTokens(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<number> {
  const response = await fetch(`${baseUrl}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ content: '<|fim_prefix|>', add_special: false }),
    signal,
  })
  if (!response.ok) throw new Error(`llama-server /tokenize: HTTP ${response.status}`)
  const json = await response.json() as { tokens?: unknown[] }
  return Array.isArray(json.tokens) ? json.tokens.length : 0
}
