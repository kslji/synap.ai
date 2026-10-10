/**
 * App updates (main process).
 * Windows NSIS can replace an unsigned install. macOS in-place update needs a Developer ID;
 * an ad-hoc signature uses the disk-image banner instead. See docs/RELEASE.md.
 * Offline: the user picks an installer from USB plus its .sig file.
 */
import { app, dialog, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { verify as edVerify } from 'node:crypto'
import { join } from 'node:path'
import { ed25519PublicKey } from './pack-verify.js'
import { surfEnv } from './surf-env.js'
import {
  parseReleaseTag,
  planUpdate,
  type RemoteRelease,
  type UpdateChannel,
  type UpdateOffer,
} from './update-plan.js'

const { autoUpdater } = electronUpdater
const REPO = 'kslji/synap.ai'

export type { UpdateOffer, UpdateChannel }

export function macSignedBuild(): boolean {
  const candidates = [
    join(process.resourcesPath, 'release-mode.json'),
    join(app.getAppPath(), 'resources', 'release-mode.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { macSigned?: boolean }
      return raw.macSigned === true
    } catch { /* try the next path */ }
  }
  return false
}

export async function fetchReleases(fetchImpl: typeof fetch = fetch): Promise<RemoteRelease[]> {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SurfAI' },
  })
  if (!response.ok) return []
  const rows = await response.json() as Array<{
    tag_name?: string
    prerelease?: boolean
    body?: string | null
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }>
  const releases: RemoteRelease[] = []
  for (const row of rows) {
    const parsed = parseReleaseTag(row.tag_name ?? '')
    if (!parsed) continue
    releases.push({
      tag: row.tag_name ?? '',
      version: parsed.version,
      prerelease: Boolean(row.prerelease) || parsed.prerelease,
      notes: (row.body ?? '').slice(0, 500),
      assets: (row.assets ?? [])
        .filter((asset) => asset.name && asset.browser_download_url)
        .map((asset) => ({ name: asset.name as string, url: asset.browser_download_url as string })),
    })
  }
  return releases
}

export async function checkAppUpdate(opts: {
  offlineOnly: boolean
  channel: UpdateChannel
  fetchImpl?: typeof fetch
}): Promise<UpdateOffer | null> {
  if (opts.offlineOnly || surfEnv('EVAL') || surfEnv('SMOKE')) return null
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
  try {
    const releases = await fetchReleases(opts.fetchImpl)
    return planUpdate({
      releases,
      channel: opts.channel,
      current: app.getVersion(),
      platform,
      arch: process.arch,
      macSigned: macSignedBuild(),
    })
  } catch (error) {
    console.warn('[updater]', (error as Error).message)
    return null
  }
}

export function initAutoUpdate(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (error) => console.warn('[updater]', error.message))
}

export async function applyUpdate(offer: UpdateOffer, channel: UpdateChannel): Promise<void> {
  if (offer.kind === 'manual' || (process.platform === 'darwin' && !macSignedBuild())) {
    await shell.openExternal(offer.url)
    return
  }
  autoUpdater.allowPrerelease = channel === 'beta'
  await autoUpdater.checkForUpdates()
  await autoUpdater.downloadUpdate()
  autoUpdater.quitAndInstall(false, true)
}

/** RELEASE_PUBKEY_HEX is compiled into the app; the private key lives only in CI secrets. */
export async function installOfflineUpdate(win: BrowserWindow, releasePubkeyHex: string): Promise<boolean> {
  const ext = process.platform === 'win32' ? ['exe'] : ['dmg']
  const pick = await dialog.showOpenDialog(win, { title: 'Choose Synap.surf installer', filters: [{ name: 'Installer', extensions: ext }], properties: ['openFile'] })
  if (pick.canceled || !pick.filePaths[0]) return false
  const file = pick.filePaths[0]
  const [bytes, sig] = await Promise.all([readFile(file), readFile(file + '.sig').catch(() => null)])
  if (!sig || sig.length !== 64 || !edVerify(null, bytes, ed25519PublicKey(releasePubkeyHex), sig)) {
    await dialog.showMessageBox(win, { type: 'error', message: 'This installer is not signed by Synap.surf. It was not opened.' })
    return false
  }
  const err = await shell.openPath(file)
  if (err) throw new Error(err)
  if (process.platform === 'win32') setTimeout(() => app.quit(), 1500)
  return true
}
