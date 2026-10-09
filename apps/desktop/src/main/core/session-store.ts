/**
 * Chat history. Prefer SQLCipher (chat.db) so prompts never sit in a plaintext file.
 * TODO(Day 2): fold this into user.db using docs/code-samples/local_user_db.sql.
 * If the OS keychain is unavailable the store stays in memory for this launch only.
 */
import { randomUUID } from 'node:crypto'
import type { DB } from './db.js'
import type { ConversationSummary, GateName, StoredMessage } from './ipc-contract.js'

export const SESSION_MIGRATION = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  gate TEXT,
  created_at INTEGER NOT NULL
);
`

interface MemConv {
  id: string
  title: string
  agentId: string
  updatedAt: number
  messages: StoredMessage[]
}

export class SessionStore {
  private mem = new Map<string, MemConv>()

  constructor(private readonly db: DB | null) {}

  get mode(): 'encrypted' | 'session' {
    return this.db ? 'encrypted' : 'session'
  }

  list(): ConversationSummary[] {
    if (!this.db) {
      return [...this.mem.values()]
        .map((c) => ({ id: c.id, title: c.title, agentId: c.agentId, updatedAt: c.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }
    const rows = this.db.prepare(
      'SELECT id, title, agent_id AS agentId, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC LIMIT 200',
    ).all() as ConversationSummary[]
    return rows
  }

  open(id: string): { id: string; messages: StoredMessage[] } {
    if (!this.db) {
      const c = this.mem.get(id)
      return { id, messages: c ? c.messages.map((m) => ({ ...m, sources: [...m.sources] })) : [] }
    }
    const rows = this.db.prepare(
      'SELECT id, role, content, sources_json AS sourcesJson, gate FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    ).all(id) as { id: string; role: 'user' | 'assistant'; content: string; sourcesJson: string; gate: GateName | null }[]
    return {
      id,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        text: r.content,
        sources: parseSources(r.sourcesJson),
        gate: r.gate ?? undefined,
      })),
    }
  }

  ensure(id: string | null, firstText: string, agentId: string): string {
    if (id && this.has(id)) return id
    const cid = id ?? randomUUID()
    const now = Date.now()
    const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 64) || 'New chat'
    if (!this.db) {
      this.mem.set(cid, { id: cid, title, agentId, updatedAt: now, messages: [] })
      return cid
    }
    this.db.prepare(
      'INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cid, title, agentId, now, now)
    return cid
  }

  append(conversationId: string, message: StoredMessage): void {
    const now = Date.now()
    if (!this.db) {
      const c = this.mem.get(conversationId)
      if (!c) return
      c.messages.push(message)
      c.updatedAt = now
      return
    }
    this.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, sources_json, gate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(message.id, conversationId, message.role, message.text, JSON.stringify(message.sources), message.gate ?? null, now)
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
  }

  private has(id: string): boolean {
    if (!this.db) return this.mem.has(id)
    return Boolean(this.db.prepare('SELECT 1 AS ok FROM conversations WHERE id = ?').get(id))
  }
}

function parseSources(json: string): StoredMessage['sources'] {
  try {
    const v = JSON.parse(json) as StoredMessage['sources']
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
