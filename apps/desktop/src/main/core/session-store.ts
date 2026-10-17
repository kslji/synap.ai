/**
 * Chat history. Prefer SQLCipher (chat.db) so prompts never sit in a plaintext file.
 * TODO(Day 2): fold this into user.db using docs/code-samples/local_user_db.sql.
 * If the OS keychain is unavailable the store stays in memory for this launch only.
 */
import { randomUUID } from 'node:crypto'
import type { DB } from './db.js'
import type { ConversationSummary, GateName, StoredMessage } from './ipc-contract.js'
import { forgetConversation } from './web-cache.js'

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

  constructor(readonly db: DB | null) {
    if (db) ensureVersionsColumn(db)
  }

  get mode(): 'encrypted' | 'session' {
    return this.db ? 'encrypted' : 'session'
  }

  list(): ConversationSummary[] {
    if (!this.db) {
      return [...this.mem.values()]
        .map((c) => ({
          id: c.id,
          title: c.title,
          agentId: c.agentId,
          updatedAt: c.updatedAt,
          preview: clipPreview(c.messages[c.messages.length - 1]?.text ?? ''),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }
    const rows = this.db.prepare(
      `SELECT c.id, c.title, c.agent_id AS agentId, c.updated_at AS updatedAt,
        (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`,
    ).all() as ConversationSummary[]
    return rows.map((row) => ({ ...row, preview: clipPreview(row.preview ?? '') }))
  }

  open(id: string): { id: string; messages: StoredMessage[] } {
    if (!this.db) {
      const c = this.mem.get(id)
      return { id, messages: c ? c.messages.map((m) => copyMessage(m)) : [] }
    }
    const rows = this.db.prepare(
      'SELECT id, role, content, sources_json AS sourcesJson, gate, versions_json AS versionsJson FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    ).all(id) as { id: string; role: 'user' | 'assistant'; content: string; sourcesJson: string; gate: GateName | null; versionsJson: string | null }[]
    return {
      id,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        text: r.content,
        sources: parseSources(r.sourcesJson),
        gate: r.gate ?? undefined,
        versions: parseVersions(r.versionsJson),
      })),
    }
  }

  readMessage(id: string): (StoredMessage & { conversationId: string }) | null {
    if (!this.db) {
      for (const conv of this.mem.values()) {
        const message = conv.messages.find((item) => item.id === id)
        if (message) return { ...copyMessage(message), conversationId: conv.id }
      }
      return null
    }
    const row = this.db.prepare(
      'SELECT id, conversation_id AS conversationId, role, content, sources_json AS sourcesJson, gate, versions_json AS versionsJson FROM messages WHERE id = ?',
    ).get(id) as { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; sourcesJson: string; gate: GateName | null; versionsJson: string | null } | undefined
    if (!row) return null
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role,
      text: row.content,
      sources: parseSources(row.sourcesJson),
      gate: row.gate ?? undefined,
      versions: parseVersions(row.versionsJson),
    }
  }

  ensure(id: string | null, firstText: string, agentId: string): string {
    if (id && this.has(id)) {
      this.renameIfPlaceholder(id, firstText)
      return id
    }
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
      'INSERT INTO messages (id, conversation_id, role, content, sources_json, gate, created_at, versions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(message.id, conversationId, message.role, message.text, JSON.stringify(message.sources), message.gate ?? null, now, JSON.stringify(message.versions ?? []))
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
  }

  /** Insert the assistant reply, or replace that same row when regenerating. */
  saveReply(conversationId: string, message: StoredMessage): void {
    const versions = message.versions ?? (message.text ? [message.text] : [])
    const stored: StoredMessage = { ...message, versions }
    if (!this.readMessage(message.id)) {
      this.append(conversationId, stored)
      return
    }
    const now = Date.now()
    if (!this.db) {
      const conv = this.mem.get(conversationId)
      const current = conv?.messages.find((item) => item.id === message.id)
      if (!current || !conv) return
      current.text = stored.text
      current.sources = [...stored.sources]
      current.gate = stored.gate
      current.versions = [...versions]
      conv.updatedAt = now
      return
    }
    this.db.prepare(
      'UPDATE messages SET content = ?, sources_json = ?, gate = ?, versions_json = ? WHERE id = ?',
    ).run(stored.text, JSON.stringify(stored.sources), stored.gate ?? null, JSON.stringify(versions), message.id)
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
  }

  /** File drops create a chat titled "New chat" before the first message. */
  renameIfPlaceholder(id: string, firstText: string): void {
    const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 64)
    if (!title) return
    if (!this.db) {
      const conv = this.mem.get(id)
      if (conv?.title === 'New chat') conv.title = title
      return
    }
    this.db.prepare(`UPDATE conversations SET title = ? WHERE id = ? AND title = 'New chat'`).run(title, id)
  }

  remove(id: string): void {
    if (!this.db) {
      this.mem.delete(id)
      return
    }
    forgetConversation(this.db, id)
  }

  /** Stored message text, in bytes. The database file also holds documents and saved web passages. */
  historyBytes(): number {
    if (!this.db) {
      let total = 0
      for (const conv of this.mem.values()) {
        total += Buffer.byteLength(conv.title)
        for (const message of conv.messages) total += Buffer.byteLength(message.text)
      }
      return total
    }
    const row = this.db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) AS bytes FROM messages').get() as { bytes: number }
    return row.bytes
  }

  clearHistory(): void {
    if (!this.db) {
      this.mem.clear()
      return
    }
    this.db.exec('DELETE FROM web_passage_links')
    this.db.exec('DELETE FROM messages')
    this.db.exec('DELETE FROM conversations')
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

function clipPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= 80) return flat
  return `${flat.slice(0, 79)}…`
}

function parseVersions(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function copyMessage(message: StoredMessage): StoredMessage {
  return { ...message, sources: [...message.sources], versions: [...(message.versions ?? [])] }
}

function ensureVersionsColumn(db: DB): void {
  const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!cols.some((col) => col.name === 'versions_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN versions_json TEXT NOT NULL DEFAULT '[]'`)
  }
}
