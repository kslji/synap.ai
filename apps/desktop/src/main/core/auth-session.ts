/**
 * Signed-in session for online features.
 * Access and refresh tokens are encrypted with Electron safeStorage.
 * macOS uses the Keychain and Windows uses DPAPI. Linux uses libsecret when
 * it is installed; otherwise Electron's basic_text fallback. The database key
 * still refuses basic_text. Session tokens may use it so sign-in works on a
 * desktop without a secret service, and a copy stays in memory for this launch.
 */
import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { assertNetworkAllowed } from './offline-guard.js'

export interface AccountSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  userId: string
  deviceId: string
}

export interface DeviceInfo {
  id: string
  name: string
  os: string
  status: string
  current: boolean
}

let memory: AccountSession | null = null

const sessionFile = () => join(app.getPath('userData'), 'session.enc')
const deviceFile = () => join(app.getPath('userData'), 'device-uid.txt')

export function memorySession(): AccountSession | null {
  return memory
}

export function deviceUid(): string {
  const path = deviceFile()
  if (existsSync(path)) {
    const id = readFileSync(path, 'utf8').trim()
    if (id) return id
  }
  const id = randomUUID()
  writeFileSync(path, id, { mode: 0o600 })
  return id
}

export function deviceProfile(): { device_uid: string; name: string; os: 'macos' | 'windows' | 'linux'; arch: string; app_version: string } {
  const osName = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  return {
    device_uid: deviceUid(),
    name: `Surf on ${hostname()}`.slice(0, 80),
    os: osName,
    arch: process.arch,
    app_version: app.getVersion(),
  }
}

export async function persistSession(session: AccountSession): Promise<void> {
  memory = session
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return
  const blob = await safeStorage.encryptStringAsync(JSON.stringify(session))
  const path = sessionFile()
  await writeFile(`${path}.tmp`, blob, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export async function loadSession(): Promise<AccountSession | null> {
  if (memory) return memory
  const path = sessionFile()
  if (!existsSync(path)) return null
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
  try {
    const result = await safeStorage.decryptStringAsync(await readFile(path))
    const parsed = JSON.parse(result.result) as AccountSession
    if (!parsed.accessToken || !parsed.refreshToken) return null
    memory = parsed
    return parsed
  } catch (error) {
    console.warn('[surf] session unreadable:', (error as Error).message)
    return null
  }
}

export async function clearSession(): Promise<void> {
  memory = null
  await rm(sessionFile(), { force: true })
}

export async function freshAccess(opts: { base: string; offlineOnly: boolean; fetchImpl?: typeof fetch }): Promise<string | null> {
  const session = await loadSession()
  if (!session) return null
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken
  assertNetworkAllowed(opts.offlineOnly)
  const res = await (opts.fetchImpl ?? fetch)(`${opts.base.replace(/\/$/, '')}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  })
  if (!res.ok) {
    await clearSession()
    return null
  }
  const body = await res.json() as SessionBody
  const next = sessionFrom(body, session.email)
  await persistSession(next)
  return next.accessToken
}

interface SessionBody {
  access_token: string
  expires_in: number
  refresh_token: string
  user: { id: string; email: string }
  device: { id: string }
}

function sessionFrom(body: SessionBody, email: string): AccountSession {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    email: body.user?.email || email,
    userId: body.user.id,
    deviceId: body.device.id,
  }
}

async function problem(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: { message?: string } }
    return body.error?.message || `request failed (${res.status})`
  } catch {
    return `request failed (${res.status})`
  }
}

export async function startOtp(base: string, email: string, offlineOnly: boolean): Promise<void> {
  assertNetworkAllowed(offlineOnly)
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/auth/otp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(await problem(res))
}

export async function verifyOtp(base: string, email: string, code: string, offlineOnly: boolean): Promise<AccountSession> {
  assertNetworkAllowed(offlineOnly)
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code, device: deviceProfile() }),
  })
  if (!res.ok) throw new Error(await problem(res))
  const body = await res.json() as SessionBody
  const session = sessionFrom(body, email.trim().toLowerCase())
  await persistSession(session)
  return session
}

export async function logoutSession(base: string, offlineOnly: boolean): Promise<void> {
  const session = await loadSession()
  if (session && !offlineOnly) {
    try {
      await fetch(`${base.replace(/\/$/, '')}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      })
    } catch {
      /* local sign-out still clears the keychain copy */
    }
  }
  await clearSession()
}

export async function fetchDevices(base: string, offlineOnly: boolean): Promise<DeviceInfo[]> {
  const token = await freshAccess({ base, offlineOnly })
  if (!token) return []
  const session = await loadSession()
  assertNetworkAllowed(offlineOnly)
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/devices`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await problem(res))
  const body = await res.json() as { devices?: Array<{ id: string; name?: string; os?: string; status?: string }> }
  return (body.devices ?? []).map((row) => ({
    id: row.id,
    name: row.name || 'Surf',
    os: row.os || '',
    status: row.status || 'active',
    current: row.id === session?.deviceId,
  }))
}

export async function revokeDeviceRemote(base: string, deviceId: string, offlineOnly: boolean): Promise<void> {
  const token = await freshAccess({ base, offlineOnly })
  if (!token) throw new Error('Sign in to manage devices.')
  assertNetworkAllowed(offlineOnly)
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/devices/${deviceId}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await problem(res))
  const session = await loadSession()
  if (session?.deviceId === deviceId) await clearSession()
}
