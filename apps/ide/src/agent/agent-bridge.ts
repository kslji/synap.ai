/**
 * Agent bridge — connects the web IDE to the local Synap sidecar via WebSocket.
 *
 * Protocol (JSON messages):
 *   client → server: { type: 'prompt', id, prompt, context: { files, activeFile } }
 *   server → client: { type: 'token', id, token }            — streaming token
 *                    { type: 'edit', id, path, content }      — file edit instruction
 *                    { type: 'done', id }                     — turn complete
 *                    { type: 'error', id, message }
 */

export interface AgentEdit {
  path: string
  content: string
}

export interface AgentStreamCallbacks {
  onToken: (token: string) => void
  onEdit: (edit: AgentEdit) => void
  onDone: () => void
  onError: (err: string) => void
}

const SIDECAR_URL = 'ws://127.0.0.1:36274/ide'

export class AgentBridge {
  private ws: WebSocket | null = null
  private pendingCbs = new Map<string, AgentStreamCallbacks>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  public connected = false
  public onConnectionChange?: (connected: boolean) => void

  connect(): void {
    if (this.ws) return
    try {
      this.ws = new WebSocket(SIDECAR_URL)
      this.ws.onopen = () => {
        this.connected = true
        this.onConnectionChange?.(true)
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      }
      this.ws.onclose = () => {
        this.connected = false
        this.ws = null
        this.onConnectionChange?.(false)
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
      this.ws.onerror = () => {
        this.ws?.close()
      }
      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            type: string; id: string; token?: string; path?: string;
            content?: string; message?: string;
          }
          const cbs = this.pendingCbs.get(msg.id)
          if (!cbs) return
          if (msg.type === 'token' && msg.token) cbs.onToken(msg.token)
          else if (msg.type === 'edit' && msg.path && msg.content != null) cbs.onEdit({ path: msg.path, content: msg.content })
          else if (msg.type === 'done') { cbs.onDone(); this.pendingCbs.delete(msg.id) }
          else if (msg.type === 'error') { cbs.onError(msg.message ?? 'Unknown error'); this.pendingCbs.delete(msg.id) }
        } catch { /* ignore malformed */ }
      }
    } catch { /* WebSocket not available */ }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  /** Send a prompt and receive streaming response */
  send(
    prompt: string,
    context: { files: Record<string, string>; activeFile?: string },
    callbacks: AgentStreamCallbacks,
  ): string {
    const id = crypto.randomUUID()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Simulate a helpful offline reply
      setTimeout(() => {
        callbacks.onToken('⚡ The local Synap sidecar is not running. Start the desktop app to enable AI assistance.')
        callbacks.onDone()
      }, 200)
      return id
    }
    this.pendingCbs.set(id, callbacks)
    this.ws.send(JSON.stringify({ type: 'prompt', id, prompt, context }))
    return id
  }
}

export const agentBridge = new AgentBridge()
