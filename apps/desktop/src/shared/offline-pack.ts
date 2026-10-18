/**
 * Offline installers are zip files, one per Qwen size, with the search model
 * beside it. NSIS cannot hold the 4B or 9B file. asar cannot hold the 9B file.
 * A zip under 2 GiB is a GitHub Release asset. A larger zip goes to the public
 * Hugging Face dataset.
 */
import { GITHUB_ASSET_LIMIT_BYTES, fitsGitHubAsset, setupCatalog, setupEmbedding, type SetupEmbed, type SetupModel } from './setup-choice.js'

export const NSIS_DATABLOCK_LIMIT_BYTES = 2_147_483_648
export const ASAR_LIMIT_BYTES = 4_200_000_000
export const OFFLINE_DISK_MARGIN_BYTES = 1_073_741_824
export const HF_OFFLINE_REPO = 'kslji/synap-surf-offline'
export const GITHUB_RELEASE_REPO = 'kslji/synap.ai'

export type OfflineOs = 'mac' | 'windows'
export type OfflineArch = 'arm64' | 'x64'
export type OfflineToken = '2b' | '4b' | '9b'
export type OfflineHost = 'github' | 'huggingface'

export interface BundledFile {
  role: 'chat' | 'embedding'
  file: string
  sizeBytes: number
  sha256: string
}

export interface BundledManifest {
  modelId: string
  files: [BundledFile, BundledFile] | BundledFile[]
}

export interface OfflineCatalogEntry {
  name: string
  bytes: number
  url: string
  host: OfflineHost
  os: OfflineOs
  arch: OfflineArch
  token: OfflineToken
  modelBytes: number
}

const SAFE_FILE = /^[A-Za-z0-9._-]+$/

export function offlinePackaging(): 'zip' {
  return 'zip'
}

/** Standard NSIS stores the payload in one data block of about 2 GiB. */
export function nsisCanEmbed(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes < NSIS_DATABLOCK_LIMIT_BYTES
}

/** asar refuses a package around 4.2 GB. The 9B file is larger than that. */
export function asarCanHold(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes < ASAR_LIMIT_BYTES
}

export function offlineAssetName(version: string, arch: OfflineArch, token: OfflineToken): string {
  const ver = version.trim().replace(/^v/, '')
  return `Synap.surf-${ver}-${arch}-${token}-offline.zip`
}

export function releaseTag(tag: string): string {
  const trimmed = tag.trim()
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function offlineHostFor(bytes: number): OfflineHost {
  return fitsGitHubAsset(bytes) ? 'github' : 'huggingface'
}

export function offlineUploadPlan(bytes: number, hasToken: boolean): 'github' | 'huggingface' | 'missing-token' {
  if (fitsGitHubAsset(bytes)) return 'github'
  return hasToken ? 'huggingface' : 'missing-token'
}

export function huggingfaceFileUrl(repo: string, tag: string, name: string): string {
  return `https://huggingface.co/datasets/${repo}/resolve/main/${releaseTag(tag)}/${encodeURIComponent(name)}`
}

export function githubReleaseAssetUrl(tag: string, name: string, repo = GITHUB_RELEASE_REPO): string {
  return `https://github.com/${repo}/releases/download/${releaseTag(tag)}/${name}`
}

export function setupModelsSegments(os: OfflineOs): string[] {
  return os === 'mac' ? ['Contents', 'Resources', 'setup-models'] : ['resources', 'setup-models']
}

/** Extra bytes while the zip is built: an app copy, the zip, and the download cache when the files are not already on disk. */
export function offlineExtraBytes(appBytes: number, modelBytes: number, downloadModels: boolean): number {
  const zipBytes = appBytes + modelBytes
  return appBytes + zipBytes + (downloadModels ? modelBytes : 0)
}

export function offlineDiskNeed(appBytes: number, modelBytes: number, downloadModels: boolean): number {
  return offlineExtraBytes(appBytes, modelBytes, downloadModels) + OFFLINE_DISK_MARGIN_BYTES
}

export function offlineDiskOk(freeBytes: number, appBytes: number, modelBytes: number, downloadModels: boolean): boolean {
  return Number.isFinite(freeBytes) && freeBytes >= offlineDiskNeed(appBytes, modelBytes, downloadModels)
}

export function offlineDiskMessage(token: string, needBytes: number, freeBytes: number): string {
  return `The ${token} offline zip needs ${needBytes} bytes free and this disk has ${freeBytes} free. Use a larger runner.`
}

export function missingHfTokenMessage(token: string, bytes: number, repo: string): string {
  return `The ${token} offline package is ${bytes} bytes. That is over GitHub's 2 GiB asset limit. Add the HF_TOKEN Actions secret and create the public dataset ${repo}.`
}

export function buildBundledManifest(model: SetupModel, embedding: SetupEmbed): BundledManifest {
  return {
    modelId: model.id,
    files: [
      { role: 'chat', file: model.file, sizeBytes: model.sizeBytes, sha256: model.sha256 },
      { role: 'embedding', file: embedding.file, sizeBytes: embedding.sizeBytes, sha256: embedding.sha256 },
    ],
  }
}

export function acceptBundledManifest(
  raw: unknown,
  catalog: readonly SetupModel[],
  embedding: SetupEmbed | null,
): BundledManifest | null {
  if (!raw || typeof raw !== 'object' || !embedding) return null
  const body = raw as { modelId?: unknown; files?: unknown }
  if (typeof body.modelId !== 'string' || !Array.isArray(body.files) || body.files.length !== 2) return null
  const chosen = catalog.find((model) => model.id === body.modelId)
  if (!chosen) return null
  const files: BundledFile[] = []
  for (const item of body.files) {
    if (!item || typeof item !== 'object') return null
    const row = item as { role?: unknown; file?: unknown; sizeBytes?: unknown; sha256?: unknown }
    if (row.role !== 'chat' && row.role !== 'embedding') return null
    if (typeof row.file !== 'string' || !SAFE_FILE.test(row.file)) return null
    if (typeof row.sizeBytes !== 'number' || !Number.isInteger(row.sizeBytes) || row.sizeBytes <= 0) return null
    if (typeof row.sha256 !== 'string' || row.sha256.length === 0) return null
    files.push({ role: row.role, file: row.file, sizeBytes: row.sizeBytes, sha256: row.sha256 })
  }
  const chat = files.filter((file) => file.role === 'chat')
  const embed = files.filter((file) => file.role === 'embedding')
  if (chat.length !== 1 || embed.length !== 1) return null
  const chatFile = chat[0]
  const embedFile = embed[0]
  if (!chatFile || !embedFile) return null
  if (chatFile.file !== chosen.file || chatFile.sizeBytes !== chosen.sizeBytes || chatFile.sha256 !== chosen.sha256) return null
  if (embedFile.file !== embedding.file || embedFile.sizeBytes !== embedding.sizeBytes || embedFile.sha256 !== embedding.sha256) return null
  return { modelId: chosen.id, files: [chatFile, embedFile] }
}

export function planOfflineModel(
  models: readonly {
    id: string
    role?: string
    file: string
    url: string
    size_bytes: number
    sha256: string
    min_ram_gb: number
    params_b?: number | null
  }[],
  token: OfflineToken,
): { model: SetupModel; embedding: SetupEmbed; modelBytes: number } | null {
  const catalog = setupCatalog(models)
  const embedding = setupEmbedding(models)
  const model = catalog.find((item) => item.token === token)
  if (!model || !embedding) return null
  return { model, embedding, modelBytes: model.sizeBytes + embedding.sizeBytes }
}

export { GITHUB_ASSET_LIMIT_BYTES }
