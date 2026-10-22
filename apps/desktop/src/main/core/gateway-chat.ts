/**
 * Gateway chat client for the desktop main process (online mode).
 *
 * Mirrors the IDE extension's gateway-client.ts and talks to the SAME existing
 * Surf gateway the fork uses: services/api/app/gateway -> POST /api/v1/chat.
 * The gateway owns provider routing, token counting, and per-user billing; this
 * module only forwards a prompt and streams the assistant text back, emitting the
 * same delta shape the local sidecar path uses so reply() can treat both alike.
 */

export interface GatewayModel {
  id: string
  label: string
  provider: string
}

export interface GatewayChatOpts {
  baseUrl: string
  token: string
  model: string
  prompt: string
  signal?: AbortSignal
  /** Called with each streamed text piece, in order. */
  onDelta?: (piece: string) => void
}

/** The curated online models, for picking a default and (later) a picker UI. */
export async function gatewayListModels(baseUrl: string, token: string, signal?: AbortSignal): Promise<GatewayModel[]> {
  const res = await fetch(`${trim(baseUrl)}/api/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Could not load online models (${res.status}).`)
  const data = (await res.json()) as { models?: GatewayModel[] }
  return data.models ?? []
}

/**
 * Stream one online completion. Resolves with the full assistant text.
 * Throws a user-facing Error for the gateway's 402 (balance) and 400 (bad model)
 * so reply() can surface the same copy the extension does.
 */
export async function gatewayChat(opts: GatewayChatOpts): Promise<string> {
  const res = await fetch(`${trim(opts.baseUrl)}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({ model: opts.model, prompt: opts.prompt, stream: true }),
    signal: opts.signal,
  })

  if (res.status === 402) throw new Error((await detailOf(res)) || 'Insufficient Surf balance. Top up to keep using cloud models.')
  if (res.status === 401) throw new Error('Please sign in again to use cloud models.')
  if (res.status === 429) throw new Error('The cloud model is busy. Please try again in a moment.')
  if (!res.ok || !res.body) throw new Error((await detailOf(res)) || `Could not reach the cloud model (${res.status}).`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line; each carries one or more data: lines.
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return full
      let chunk: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } | string }
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue // keepalive or a partial frame; skip
      }
      // A mid-stream error event (e.g. the provider key failed) carries no content.
      if (chunk.error) {
        const message = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
        throw new Error(message || 'The cloud model is unavailable right now. Please try again.')
      }
      // A trailing {"billing": ...} chunk carries no content; choices is absent.
      const piece = chunk.choices?.[0]?.delta?.content
      if (piece) {
        full += piece
        opts.onDelta?.(piece)
      }
    }
  }
  return full
}

function trim(url: string): string {
  return url.replace(/\/+$/, '')
}

/** The gateway's clean user-facing message (FastAPI puts it in `detail`). */
async function detailOf(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: { message?: string } }
  return body.detail || body.error?.message || null
}
