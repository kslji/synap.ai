/**
 * Connector vault: tokens, encrypted mail/event cache, durable outbox, local schedule.
 * Writes and deletes go through ApprovalGate. The model cannot pass a bypass flag.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ApprovalGate, type ProposedAction } from './approval-policy.js'
import { cleanUntrusted } from './code-tools.js'
import type { Cipher } from './connector-crypto.js'
import {
  apiUrl,
  authorizeUrl,
  beginPkce,
  exchangeCode,
  listenForCode,
  refreshAccess,
  revokeAccess,
  scopesFor,
  type OAuthEndpoints,
  type ProviderId,
  type TokenSet,
} from './connector-oauth.js'

export interface CachedMail {
  provider: ProviderId
  id: string
  from: string
  subject: string
  body: string
}

export interface CachedEvent {
  provider: ProviderId
  id: string
  title: string
  start: string
}

export interface OutboxItem {
  id: string
  provider: ProviderId
  to: string
  subject: string
  body: string
  attachment?: { filename: string; mime: string; base64: string }
  status: 'pending' | 'approved' | 'sent' | 'error'
  runAt: number | null
  attempts: number
  lastError?: string
}

export interface AlarmJob {
  id: string
  title: string
  body: string
  runAt: number
  fired: boolean
}

interface Vault {
  tokens: Partial<Record<ProviderId, TokenSet>>
  mail: CachedMail[]
  events: CachedEvent[]
  outbox: OutboxItem[]
  alarms: AlarmJob[]
  invoiceLast: number
}

function emptyVault(): Vault {
  return { tokens: {}, mail: [], events: [], outbox: [], alarms: [], invoiceLast: 0 }
}

export interface HubOptions {
  dir: string
  cipher: Cipher
  gate?: ApprovalGate
  fetchImpl?: typeof fetch
  open?: (url: string) => Promise<void> | void
  notify?: (title: string, body: string) => void
  login?: (openAtLogin: boolean) => void
  apiBase?: string
}

export function loginItem(openAtLogin: boolean): { openAtLogin: boolean; args: string[] } {
  return { openAtLogin, args: openAtLogin ? ['--surf-flush'] : [] }
}

export class ConnectorHub {
  readonly gate: ApprovalGate
  private vault: Vault = emptyVault()
  private loaded = false
  private readonly fetchImpl: typeof fetch
  private readonly file: string

  setApiBase(base: string): void {
    this.opts.apiBase = base
  }

  constructor(private readonly opts: HubOptions) {
    this.gate = opts.gate ?? new ApprovalGate()
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.file = join(opts.dir, 'connectors.enc')
  }

  async reread(): Promise<void> {
    this.loaded = false
    await this.load()
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.file)) return
    const plain = await this.opts.cipher.decrypt(readFileSync(this.file))
    this.vault = { ...emptyVault(), ...JSON.parse(plain) as Vault }
  }

  private async save(): Promise<void> {
    mkdirSync(this.opts.dir, { recursive: true })
    const blob = await this.opts.cipher.encrypt(JSON.stringify(this.vault))
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, blob, { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  fileBytes(): Buffer {
    return existsSync(this.file) ? readFileSync(this.file) : Buffer.alloc(0)
  }

  async connect(endpoints: OAuthEndpoints, features: string[], open = this.opts.open): Promise<TokenSet> {
    await this.load()
    const prior = this.vault.tokens[endpoints.id]?.scopes ?? []
    const asked = scopesFor(endpoints.id, features)
    const scopes = [...new Set([...prior, ...asked])]
    const { verifier, challenge, state } = beginPkce()
    const loop = await listenForCode(state, 20_000)
    try {
      const url = authorizeUrl(endpoints, { redirectUri: loop.redirectUri, state, challenge, scopes })
      if (!open) throw new Error('No browser is available for sign-in.')
      await open(url)
      const code = await loop.code
      const token = await exchangeCode(endpoints, { code, redirectUri: loop.redirectUri, verifier, fetchImpl: this.fetchImpl })
      token.scopes = scopes.length ? token.scopes : scopes
      this.vault.tokens[endpoints.id] = token
      await this.save()
      await this.sync(endpoints.id, true)
      return this.vault.tokens[endpoints.id] as TokenSet
    } finally {
      await loop.close()
    }
  }

  token(id: ProviderId): TokenSet | undefined {
    return this.vault.tokens[id]
  }

  async fresh(endpoints: OAuthEndpoints, now: number): Promise<string> {
    await this.load()
    const current = this.vault.tokens[endpoints.id]
    if (!current) throw new Error('Not connected.')
    if (current.expiresAt - now > 60_000) return current.accessToken
    const next = await refreshAccess(endpoints, current.refreshToken, this.fetchImpl)
    next.account = next.account || current.account
    next.scopes = next.scopes.length ? next.scopes : current.scopes
    this.vault.tokens[endpoints.id] = next
    await this.save()
    return next.accessToken
  }

  async disconnect(endpoints: OAuthEndpoints, online: boolean): Promise<void> {
    await this.load()
    const current = this.vault.tokens[endpoints.id]
    if (current && online) {
      try { await revokeAccess(endpoints, current.accessToken, this.fetchImpl) } catch { /* local delete still proceeds */ }
    }
    delete this.vault.tokens[endpoints.id]
    this.vault.mail = this.vault.mail.filter((row) => row.provider !== endpoints.id)
    this.vault.events = this.vault.events.filter((row) => row.provider !== endpoints.id)
    await this.save()
  }

  async sync(provider: ProviderId, online: boolean): Promise<void> {
    await this.load()
    const token = this.vault.tokens[provider]
    if (!token) return
    if (!online) return
    const base = this.opts.apiBase ?? ''
    const headers = { authorization: `Bearer ${token.accessToken}` }
    if (provider === 'google' || provider === 'microsoft' || provider === 'slack') {
      if (token.scopes.some((scope) => /gmail|Mail\.Read|channels:history|channels:read/i.test(scope)) || provider === 'slack') {
        const list = await this.fetchImpl(apiUrl(provider, base, 'mail'), { headers })
        const mail = await readMailResponse(provider, list, (id) => this.fetchImpl(apiUrl(provider, base, 'mailOne').replace('/m1', `/${id}`), { headers }))
        this.vault.mail = [...this.vault.mail.filter((row) => row.provider !== provider), ...mail.map((row) => ({ ...row, body: cleanUntrusted(row.body) }))]
      }
      if (token.scopes.some((scope) => /calendar|Calendars/i.test(scope))) {
        const events = await this.fetchImpl(apiUrl(provider, base, 'events'), { headers })
        const rows = await readEvents(provider, events)
        this.vault.events = [...this.vault.events.filter((row) => row.provider !== provider), ...rows]
      }
    }
    await this.save()
  }

  cachedMail(): CachedMail[] {
    return this.vault.mail.map((row) => ({ ...row, body: cleanUntrusted(row.body) }))
  }

  cachedEvents(): CachedEvent[] {
    return this.vault.events
  }

  async queueSend(item: Omit<OutboxItem, 'status' | 'attempts'>, now: number): Promise<{ state: string; applied: boolean }> {
    await this.load()
    const action: ProposedAction = {
      id: item.id,
      connector: item.provider,
      class: 'write',
      verb: item.runAt ? 'schedule' : 'send',
      summary: item.subject,
    }
    const decision = this.gate.submit(action, now)
    this.vault.outbox.push({ ...item, status: 'pending', attempts: 0 })
    await this.save()
    this.touchLogin()
    return { state: decision.state, applied: decision.state === 'done' }
  }

  async approve(id: string, now: number): Promise<{ state: string; applied: boolean }> {
    await this.load()
    const decision = this.gate.approve(id, now)
    if (decision.state !== 'done') return { state: decision.state, applied: false }
    const item = this.vault.outbox.find((row) => row.id === id)
    if (item && item.status === 'pending') item.status = 'approved'
    await this.save()
    this.touchLogin()
    return { state: 'done', applied: true }
  }

  async flush(now: number, online: boolean): Promise<{ sent: number; waiting: number }> {
    await this.load()
    let sent = 0
    for (const item of this.vault.outbox) {
      if (item.status !== 'approved') continue
      if (item.runAt != null && item.runAt > now) continue
      if (!online) continue
      const token = this.vault.tokens[item.provider]
      if (!token) {
        item.lastError = 'Not connected.'
        continue
      }
      try {
        const res = await this.fetchImpl(apiUrl(item.provider, this.opts.apiBase ?? '', 'send'), {
          method: 'POST',
          headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ to: item.to, subject: item.subject, body: item.body, attachment: item.attachment ?? null }),
        })
        if (!res.ok && res.status !== 202) throw new Error(`send failed (${res.status})`)
        item.status = 'sent'
        item.attempts += 1
        sent += 1
      } catch (error) {
        item.status = 'approved'
        item.attempts += 1
        item.lastError = (error as Error).message
      }
    }
    await this.save()
    const waiting = this.vault.outbox.filter((item) => item.status === 'approved').length
    return { sent, waiting }
  }

  requestTrash(provider: ProviderId, messageId: string, now: number): { state: string } {
    const action: ProposedAction = { id: `trash-${messageId}`, connector: provider, class: 'delete', verb: 'delete', summary: `Trash ${messageId}` }
    return this.gate.submit(action, now)
  }

  async confirmTrash(provider: ProviderId, messageId: string, now: number): Promise<{ state: string; trashed: boolean }> {
    const decision = this.gate.approve(`trash-${messageId}`, now)
    if (decision.state !== 'done') return { state: decision.state, trashed: false }
    const token = this.vault.tokens[provider]
    if (!token) return { state: 'done', trashed: false }
    const res = await this.fetchImpl(apiUrl(provider, this.opts.apiBase ?? '', 'trash'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token.accessToken}` },
    })
    if (!res.ok) return { state: 'done', trashed: false }
    this.vault.mail = this.vault.mail.filter((row) => row.id !== messageId)
    await this.save()
    return { state: 'trashed', trashed: true }
  }

  async scheduleAlarm(id: string, title: string, body: string, runAt: number): Promise<void> {
    await this.load()
    this.vault.alarms = this.vault.alarms.filter((row) => row.id !== id)
    this.vault.alarms.push({ id, title, body, runAt, fired: false })
    await this.save()
    this.touchLogin()
  }

  async tick(now: number): Promise<AlarmJob[]> {
    await this.load()
    const due = this.vault.alarms.filter((row) => !row.fired && row.runAt <= now)
    for (const row of due) {
      row.fired = true
      this.opts.notify?.(row.title, row.body)
    }
    if (due.length) await this.save()
    this.touchLogin()
    return due
  }

  outbox(): OutboxItem[] {
    return this.vault.outbox
  }

  wantsLogin(): boolean {
    const futureSend = this.vault.outbox.some((item) => item.status === 'approved' && item.runAt != null)
    const futureAlarm = this.vault.alarms.some((row) => !row.fired)
    return futureSend || futureAlarm
  }

  rememberInvoice(last: number): void {
    this.vault.invoiceLast = last
  }

  invoiceLast(): number {
    return this.vault.invoiceLast
  }

  wipeFile(): void {
    if (existsSync(this.file)) rmSync(this.file)
  }

  private touchLogin(): void {
    this.opts.login?.(loginItem(this.wantsLogin()).openAtLogin)
  }
}

async function readMailResponse(provider: ProviderId, res: Response, one: (id: string) => Promise<Response>): Promise<CachedMail[]> {
  if (!res.ok) return []
  const body = await res.json() as {
    messages?: { id: string }[]
    value?: { id: string; subject?: string; bodyPreview?: string; from?: { emailAddress?: { address?: string } } }[]
    messagesSlack?: unknown
  }
  if (provider === 'google') {
    const rows: CachedMail[] = []
    for (const item of body.messages ?? []) {
      const detail = await (await one(item.id)).json() as { id: string; payload?: { headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: { body?: { data?: string } }[] } }
      const headers = detail.payload?.headers ?? []
      const from = headers.find((header) => header.name.toLowerCase() === 'from')?.value ?? ''
      const subject = headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? ''
      const data = detail.payload?.body?.data || detail.payload?.parts?.find((part) => part.body?.data)?.body?.data || ''
      const text = data ? Buffer.from(data, 'base64url').toString('utf8') : ''
      rows.push({ provider, id: detail.id, from, subject, body: text })
    }
    return rows
  }
  if (provider === 'microsoft') {
    return (body.value ?? []).map((item) => ({
      provider,
      id: item.id,
      from: item.from?.emailAddress?.address ?? '',
      subject: item.subject ?? '',
      body: item.bodyPreview ?? '',
    }))
  }
  const slack = body as { messages?: { ts?: string; text?: string; user?: string }[] }
  return (slack.messages ?? []).map((item) => ({
    provider,
    id: item.ts ?? 'slack',
    from: item.user ?? '',
    subject: 'Slack',
    body: item.text ?? '',
  }))
}

async function readEvents(provider: ProviderId, res: Response): Promise<CachedEvent[]> {
  if (!res.ok) return []
  const body = await res.json() as {
    items?: { id: string; summary?: string; start?: { dateTime?: string } }[]
    value?: { id: string; subject?: string; start?: { dateTime?: string } }[]
  }
  if (provider === 'google') {
    return (body.items ?? []).map((item) => ({ provider, id: item.id, title: item.summary ?? '', start: item.start?.dateTime ?? '' }))
  }
  return (body.value ?? []).map((item) => ({ provider, id: item.id, title: item.subject ?? '', start: item.start?.dateTime ?? '' }))
}
