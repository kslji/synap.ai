/**
 * What Settings → Packs shows for the Code pack. Figures come from the signed
 * manifest and the local embedding cache, never from a placeholder.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { PackRow } from '../../shared/ipc-contract.js'
import { codePackDir, loadCodePack, type CodePackManifest } from './code-pack.js'
import { installBundledCodePack } from './code-pack-install.js'
import { codePackIndexProgress } from './code-pack-index.js'
import { gatePackDecrypt } from './licence.js'
import type { TrustedKeys } from './pack-verify.js'

export const CODE_PACK_ABSENT = 'The Code pack is not installed. Coding answers will not cite the offline language reference.'

export async function codePackListing(opts: {
  userData: string
  bundledDir: string
  keys: TrustedKeys
  allowed: boolean
  embedderReady: boolean
}): Promise<PackRow> {
  const dest = codePackDir(opts.userData)
  let loaded = await loadCodePack(dest, opts.keys)
  if (loaded.status !== 'ready') {
    const installed = await installBundledCodePack(opts.bundledDir, dest, opts.keys)
    if (installed.status === 'ready') loaded = installed
    else if (loaded.status === 'absent') loaded = installed
  }
  if (loaded.status === 'absent') {
    return row({
      installed: false,
      version: null,
      note: CODE_PACK_ABSENT,
      indexState: 'off',
    })
  }
  if (loaded.status === 'invalid') {
    return row({
      installed: false,
      version: null,
      note: `The Code pack on this computer could not be verified. ${loaded.message}`,
      indexState: 'error',
    })
  }
  const gate = gatePackDecrypt(true, { allowed: opts.allowed, contentKey: null, encrypted: false })
  const manifest = loaded.manifest
  const index = codePackIndexProgress()
  const indexState = gate.status === 'locked'
    ? 'blocked'
    : !opts.embedderReady && index.state !== 'ready'
      ? 'off'
      : index.state === 'pending' ? 'pending' : index.state
  return row({
    installed: true,
    version: manifest.version,
    latestVersion: manifest.version,
    sizeBytes: packBytes(dest, manifest),
    sources: manifest.sources.map((source) => ({
      title: source.title,
      version: source.version,
      licence: source.licence,
      url: source.url,
    })),
    updatedAt: manifest.created_at,
    indexProgress: index.total > 0 ? index.done / index.total : index.state === 'ready' ? 1 : null,
    indexState,
    note: gate.status === 'locked' ? gate.message : null,
    syncedAt: Date.parse(manifest.created_at) || null,
  })
}

function packBytes(dir: string, manifest: CodePackManifest): number {
  let total = 0
  for (const name of ['manifest.json', 'manifest.sig', ...manifest.files.map((file) => file.name)]) {
    try { total += statSync(join(dir, name)).size } catch { /* a missing file is already an invalid pack */ }
  }
  return total
}

function row(extra: Partial<PackRow> & { installed: boolean; version: string | null }): PackRow {
  return {
    id: 'code',
    title: 'Code',
    niche: 'code',
    latestVersion: extra.version,
    updateAvailable: false,
    syncedAt: null,
    progress: null,
    error: null,
    ...extra,
  }
}
