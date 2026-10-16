/**
 * Licence file, device id, and refresh. Checks run here in the main process.
 * The renderer only sees the verdict.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LicenceDevice, LicenceStatus } from './ipc-contract.js'
import { freshAccess, loadSession } from './auth-session.js'
import { deviceIdHash } from './device-id.js'
import { clearLicenceDir, loadLicenceDir, writeClock, writeLicenceDir } from './licence-file.js'
import { trustedLicenceKeys } from './licence-keys.js'
import {
  BUY_URL,
  derivePackKey,
  devBypassEnabled,
  inspectLicence,
  licenceAllowsUse,
  subscriptionWarns,
  type LicenceState,
  type LicenceVerdict,
  type StoredLicence,
} from './licence.js'
import { assertNetworkAllowed } from './offline-guard.js'

export { BUY_URL }

const BLOCK = 'licence-block.json'

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout ?? ''))
    })
  })
}

async function readMachine(): Promise<string | null> {
  if (process.platform === 'linux') {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const text = (await readFile(path, 'utf8')).trim()
        if (/^[a-f0-9-]{8,64}$/i.test(text)) return text.toLowerCase()
      } catch { /* the next path, or the install id */ }
    }
    return null
  }
  if (process.platform === 'darwin') {
    const text = await execText('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    const match = text.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
    return match?.[1]?.trim() || null
  }
  if (process.platform === 'win32') {
    const text = await execText('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
    const match = text.match(/MachineGuid\s+REG_SZ\s+(\S+)/)
    return match?.[1]?.trim() || null
  }
  return null
}

async function installId(userData: string): Promise<string> {
  const path = join(userData, 'device-install-id.txt')
  if (existsSync(path)) {
    const id = readFileSync(path, 'utf8').trim()
    if (id) return id
  }
  const id = randomUUID()
  writeFileSync(path, id, { mode: 0o600 })
  return id
}

/** SHA-256 of platform, arch, and a machine id or install id. No names or email. */
export async function collectDeviceId(userData: string): Promise<string> {
  const parts = [`platform:${process.platform}`, `arch:${process.arch}`]
  const machine = await readMachine()
  parts.push(machine ? `machine:${machine}` : `install:${await installId(userData)}`)
  return deviceIdHash(parts)
}

async function problem(res: Response): Promise<{ message: string; code: string }> {
  try {
    const body = await res.json() as { error?: { message?: string; code?: string } }
    return { message: body.error?.message || `request failed (${res.status})`, code: body.error?.code || '' }
  } catch {
    return { message: `request failed (${res.status})`, code: '' }
  }
}

function toStatus(verdict: LicenceVerdict, deviceIdHashValue: string, email: string | null): LicenceStatus {
  return {
    state: verdict.state,
    message: verdict.message,
    plan: verdict.payload?.plan ?? null,
    email,
    refreshBy: verdict.payload?.refresh_by ?? null,
    expiresAt: verdict.payload?.expires_at ?? null,
    subscriptionEndsAt: verdict.payload?.subscription_ends_at ?? null,
    termMonths: verdict.payload?.term_months ?? null,
    subscriptionWarning: verdict.payload
      ? subscriptionWarns(Date.now(), Date.parse(verdict.payload.subscription_ends_at), verdict.state)
      : false,
    deviceIdHash: deviceIdHashValue,
    buyUrl: BUY_URL,
    licenceId: verdict.payload?.licence_id ?? null,
  }
}

export function createLicenceApi(opts: {
  userData: string
  packaged: boolean
  devFlag: string | undefined
  apiBase: () => string
  offlineOnly: () => boolean
  online: () => boolean
}) {
  const keys = () => trustedLicenceKeys()
  const bypass = () => devBypassEnabled(opts.devFlag, opts.packaged)
  let deviceHash = ''

  async function hash(): Promise<string> {
    if (!deviceHash) deviceHash = await collectDeviceId(opts.userData)
    return deviceHash
  }

  function blockPath(): string {
    return join(opts.userData, BLOCK)
  }

  function readBlock(): string | null {
    if (!existsSync(blockPath())) return null
    try {
      const parsed = JSON.parse(readFileSync(blockPath(), 'utf8')) as { message?: string }
      return parsed.message || null
    } catch {
      return null
    }
  }

  async function verdict(): Promise<{ verdict: LicenceVerdict; device: string }> {
    const device = await hash()
    const loaded = await loadLicenceDir(opts.userData)
    const result = inspectLicence({
      stored: loaded.stored,
      broken: loaded.broken,
      nowMs: Date.now(),
      deviceIdHash: device,
      publicKeys: keys(),
      maxSeenMs: loaded.maxSeenMs,
      clockOk: loaded.clockOk,
      devBypass: bypass(),
    })
    if (result.nextMaxSeenMs != null && loaded.stored && result.nextMaxSeenMs !== loaded.maxSeenMs) {
      await writeClock(opts.userData, result.nextMaxSeenMs, loaded.stored.integrity)
    }
    const blocked = readBlock()
    if (blocked && result.state === 'missing') {
      return {
        device,
        verdict: { state: 'invalid', message: blocked, payload: null, nextMaxSeenMs: null },
      }
    }
    return { verdict: result, device }
  }

  async function status(): Promise<LicenceStatus> {
    const session = await loadSession()
    const { verdict: result, device } = await verdict()
    return toStatus(result, device, session?.email ?? null)
  }

  async function post(path: string, body: unknown, token: string | null): Promise<Response> {
    assertNetworkAllowed(opts.offlineOnly())
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    return fetch(`${opts.apiBase().replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  async function accept(stored: StoredLicence, device: string): Promise<LicenceStatus> {
    const checked = inspectLicence({
      stored,
      broken: false,
      nowMs: Date.now(),
      deviceIdHash: device,
      publicKeys: keys(),
      maxSeenMs: Date.now(),
      clockOk: true,
      devBypass: false,
    })
    if (!licenceAllowsUse(checked.state)) {
      throw new Error(checked.message || 'The licence from the server was not accepted.')
    }
    await writeLicenceDir(opts.userData, stored, Date.now())
    await rm(blockPath(), { force: true })
    return status()
  }

  return {
    status,
    async activate(key?: string): Promise<LicenceStatus> {
      const device = await hash()
      const settingsOffline = opts.offlineOnly()
      const token = await freshAccess({ base: opts.apiBase(), offlineOnly: settingsOffline })
      const res = await post('/v1/licences/activate', {
        device_id_hash: device,
        key: key || undefined,
        name: 'Synap.surf',
        os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      }, token)
      if (!res.ok) throw new Error((await problem(res)).message)
      const body = await res.json() as { licence?: StoredLicence }
      if (!body.licence?.payload || !body.licence.signature) throw new Error('The server did not return a licence.')
      return accept(body.licence, device)
    },
    async deactivate(activationId?: string): Promise<LicenceStatus> {
      const device = await hash()
      const loaded = await loadLicenceDir(opts.userData)
      const token = await freshAccess({ base: opts.apiBase(), offlineOnly: opts.offlineOnly() })
      const body = activationId
        ? { activation_id: activationId }
        : { licence_id: loaded.stored?.payload.licence_id, device_id_hash: device }
      const res = await post('/v1/licences/deactivate', body, token)
      if (!res.ok) throw new Error((await problem(res)).message)
      const removed = await res.json() as { device_id_hash?: string }
      if (!activationId || removed.device_id_hash === device) await clearLicenceDir(opts.userData)
      return status()
    },
    async devices(): Promise<LicenceDevice[]> {
      const device = await hash()
      const token = await freshAccess({ base: opts.apiBase(), offlineOnly: opts.offlineOnly() }).catch(() => null)
      if (!token) {
        const current = await status()
        if (!licenceAllowsUse(current.state) || current.state === 'dev') return []
        return [{ id: current.licenceId || device, name: 'This computer', os: process.platform, current: true }]
      }
      assertNetworkAllowed(opts.offlineOnly())
      const res = await fetch(`${opts.apiBase().replace(/\/$/, '')}/v1/licences/devices`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error((await problem(res)).message)
      const body = await res.json() as { devices?: Array<{ id: string; name?: string; os?: string; device_id_hash?: string }> }
      return (body.devices ?? []).map((row) => ({
        id: row.id,
        name: row.name || 'Synap.surf',
        os: row.os || '',
        current: row.device_id_hash === device,
      }))
    },
    async allowsUse(): Promise<boolean> {
      const { verdict: result } = await verdict()
      return licenceAllowsUse(result.state)
    },
    async contentKey(): Promise<Buffer | null> {
      const { verdict: result } = await verdict()
      if (!result.payload || !licenceAllowsUse(result.state)) return null
      return derivePackKey(result.payload)
    },
    async refreshSilent(): Promise<void> {
      if (bypass() || opts.offlineOnly() || !opts.online()) return
      const loaded = await loadLicenceDir(opts.userData)
      const device = await hash()
      const current = inspectLicence({
        stored: loaded.stored,
        broken: loaded.broken,
        nowMs: Date.now(),
        deviceIdHash: device,
        publicKeys: keys(),
        maxSeenMs: loaded.maxSeenMs,
        clockOk: loaded.clockOk,
        devBypass: false,
      })
      if ((current.state !== 'valid' && current.state !== 'grace' && current.state !== 'subscription_ended') || !current.payload) return
      try {
        const res = await post('/v1/licences/refresh', {
          licence_id: current.payload.licence_id,
          device_id_hash: device,
        }, null)
        if (!res.ok) {
          const reason = await problem(res)
          if (reason.code === 'licence_revoked' || reason.code === 'licence_refunded') {
            await clearLicenceDir(opts.userData)
            writeFileSync(blockPath(), JSON.stringify({ message: reason.message }), { mode: 0o600 })
          }
          return
        }
        const body = await res.json() as { licence?: StoredLicence }
        if (!body.licence) return
        await accept(body.licence, device)
      } catch {
        /* keep the current file; grace covers a missed refresh */
      }
    },
  }
}

export type LicenceApi = ReturnType<typeof createLicenceApi>

export function emptyLicenceStatus(state: LicenceState = 'missing'): LicenceStatus {
  return {
    state,
    message: '',
    plan: null,
    email: null,
    refreshBy: null,
    expiresAt: null,
    subscriptionEndsAt: null,
    termMonths: null,
    subscriptionWarning: false,
    deviceIdHash: null,
    buyUrl: BUY_URL,
    licenceId: null,
  }
}
