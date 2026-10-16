/** When a signed-in desktop may check for pack updates. Downloads are separate. */

export const DEFAULT_SYNC_MS = 6 * 60 * 60 * 1000
/** Background knowledge-pack check. Every plan includes this while the subscription is active. */
export const PACK_AUTO_SYNC_MS = 24 * 60 * 60 * 1000
export const PACK_UPDATES = 'pack_updates'

/**
 * Auto-sync runs only for an active subscription that includes pack_updates.
 * A development build skips the licence check. An ended subscription does not.
 */
export function packAutoSyncAllowed(input: { state: string; features: readonly string[] | null }): boolean {
  if (input.state === 'dev') return true
  if (input.state !== 'valid' && input.state !== 'grace') return false
  return (input.features ?? []).includes(PACK_UPDATES)
}

/** A downloaded pack is swapped in only when no answer is in progress. */
export function canSwapPack(chatBusy: boolean): boolean {
  return chatBusy === false
}

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

/** Prefer the updates route. An empty stub means the pack server has nothing published yet. */
export async function fetchPackUpdates(
  base: string,
  token: string,
  installed: string,
  deviceIdHash?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ packs: RemotePack[]; stub: boolean; contentKeySealed: string | null }> {
  const root = base.replace(/\/$/, '')
  const device = deviceIdHash && /^[0-9a-f]{64}$/i.test(deviceIdHash)
    ? `&device_id_hash=${encodeURIComponent(deviceIdHash)}`
    : ''
  const url = `${root}/v1/packs/updates?installed=${encodeURIComponent(installed)}${device}`
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 404) return { packs: await fetchCatalog(base, token, installed, fetchImpl), stub: false, contentKeySealed: null }
  if (!res.ok) throw new Error(`pack updates failed (${res.status})`)
  const body = await res.json() as { packs?: RemotePack[]; stub?: boolean; content_key_sealed?: unknown }
  const sealed = typeof body.content_key_sealed === 'string' && /^[0-9a-f]+$/i.test(body.content_key_sealed)
    ? body.content_key_sealed
    : null
  return { packs: body.packs ?? [], stub: body.stub === true, contentKeySealed: sealed }
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
