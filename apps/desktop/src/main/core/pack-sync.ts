/** When a signed-in desktop may check for pack updates. Downloads are separate. */

export const DEFAULT_SYNC_MS = 6 * 60 * 60 * 1000

export interface SyncInput {
  now: number
  lastSyncAt: number | null
  intervalMs: number
  online: boolean
  signedIn: boolean
  chatBusy: boolean
  offlineOnly: boolean
  metered: boolean
}

export function shouldSync(input: SyncInput & { force?: boolean }): boolean {
  if (!input.signedIn || !input.online || input.offlineOnly || input.metered || input.chatBusy) return false
  if (input.force) return true
  if (input.lastSyncAt == null) return true
  return input.now - input.lastSyncAt >= input.intervalMs
}

export interface RemoteFile {
  name: string
  sha256: string
  size: number
  url: string
}

export interface RemotePack {
  id: string
  title: string
  niche: string
  latest: { version: string; files: RemoteFile[] }
  installed: string | null
  update_available: boolean
  changed_files: string[]
}

export async function fetchCatalog(base: string, token: string, installed: string, fetchImpl: typeof fetch = fetch): Promise<RemotePack[]> {
  const url = `${base.replace(/\/$/, '')}/v1/packs?installed=${encodeURIComponent(installed)}`
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`pack catalog failed (${res.status})`)
  const body = await res.json() as { packs?: RemotePack[] }
  return body.packs ?? []
}

export async function downloadFile(url: string, dest: string, headers: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<void> {
  const { createWriteStream } = await import('node:fs')
  const { stat, rename, rm } = await import('node:fs/promises')
  const part = `${dest}.part`
  let have = 0
  try { have = (await stat(part)).size } catch { have = 0 }
  const reqHeaders = { ...headers }
  if (have > 0) reqHeaders.range = `bytes=${have}-`
  const res = await fetchImpl(url, { headers: reqHeaders })
  if (res.status === 416) {
    await rm(part, { force: true })
    return downloadFile(url, dest, headers, fetchImpl)
  }
  if (!res.ok && res.status !== 206) throw new Error(`download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(part, { flags: have > 0 && res.status === 206 ? 'a' : 'w' })
    stream.on('error', reject)
    stream.on('finish', () => resolve())
    stream.end(buf)
  })
  await rename(part, dest)
}
