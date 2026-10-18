/**
 * Build one offline zip: the app plus one Qwen file plus the search model.
 * A zip under 2 GiB stays for the GitHub Release. A larger zip is uploaded to
 * the public Hugging Face dataset and then deleted, so it is not a Release asset.
 *
 *   npx tsx scripts/pack-offline-zip.ts --app <app> --os mac|windows --arch arm64|x64 \
 *     --token 2b|4b|9b --version 0.2.0 --tag v0.2.0 --out <dir> --catalog <file.json>
 *
 * HF_TOKEN is read from the environment and is never written to disk here.
 * --no-sign is only for a Linux fixture. A Mac release zip is signed on macOS.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, createReadStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { downloadVerified } from '../src/main/core/model-download.ts'
import {
  HF_OFFLINE_REPO,
  buildBundledManifest,
  githubReleaseAssetUrl,
  huggingfaceFileUrl,
  missingHfTokenMessage,
  offlineAssetName,
  offlineDiskMessage,
  offlineDiskNeed,
  offlineDiskOk,
  offlineHostFor,
  offlineUploadPlan,
  planOfflineModel,
  releaseTag,
  setupModelsSegments,
  type OfflineArch,
  type OfflineCatalogEntry,
  type OfflineOs,
  type OfflineToken,
} from '../src/shared/offline-pack.ts'
import type { SetupEmbed, SetupModel } from '../src/shared/setup-choice.ts'

export class OfflinePackError extends Error {
  readonly exitCode: number
  constructor(exitCode: number, message: string) {
    super(message)
    this.name = 'OfflinePackError'
    this.exitCode = exitCode
  }
}

export interface PackOfflineInput {
  appDir: string
  os: OfflineOs
  arch: OfflineArch
  version: string
  tag: string
  outDir: string
  catalogPath: string
  repo: string
  hasHfToken: boolean
  model: SetupModel
  embedding: SetupEmbed
  chatPath: string
  embedPath: string
  noSign: boolean
  /** True when the model files were downloaded into a cache that statfs has not paid for yet. */
  countDownloadCache: boolean
  freeBytes?: number
  platform?: NodeJS.Platform
  upload?: (file: string, repo: string, pathInRepo: string) => void
}

export function directoryBytes(root: string): number {
  let total = 0
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    let entries: Dirent[] = []
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try { total += statSync(full).size } catch { /* a vanished file is not part of the estimate */ }
      }
    }
  }
  return total
}

export function readDiskFree(dir: string): number {
  mkdirSync(dir, { recursive: true })
  const stats = statfsSync(dir)
  return Number(stats.bavail) * Number(stats.bsize)
}

export function resolvePackedApp(appDir: string, os: OfflineOs): string {
  if (os === 'mac') {
    if (appDir.endsWith('.app') && existsSync(join(appDir, 'Contents'))) return appDir
    if (existsSync(appDir)) {
      const match = readdirSync(appDir).find((name) => name.endsWith('.app') && existsSync(join(appDir, name, 'Contents')))
      if (match) return join(appDir, match)
    }
    throw new OfflinePackError(1, `No Mac app in ${appDir}.`)
  }
  if (existsSync(join(appDir, 'SynapSurf.exe'))) return appDir
  if (!existsSync(appDir)) throw new OfflinePackError(1, `No Windows app in ${appDir}.`)
  const stack = [appDir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.toLowerCase() === 'synapsurf.exe') return current
    }
  }
  throw new OfflinePackError(1, `No Windows app in ${appDir}.`)
}

export function appendOfflineCatalog(path: string, entry: OfflineCatalogEntry): void {
  let current: OfflineCatalogEntry[] = []
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (Array.isArray(parsed)) current = parsed.filter(isCatalogEntry)
    } catch { current = [] }
  }
  const next = current.filter((item) => item.name !== entry.name).concat(entry)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
}

function isCatalogEntry(value: unknown): value is OfflineCatalogEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<OfflineCatalogEntry>
  return typeof row.name === 'string' && typeof row.bytes === 'number' && typeof row.url === 'string'
    && (row.host === 'github' || row.host === 'huggingface')
    && (row.os === 'mac' || row.os === 'windows')
    && (row.arch === 'arm64' || row.arch === 'x64')
    && (row.token === '2b' || row.token === '4b' || row.token === '9b')
    && typeof row.modelBytes === 'number'
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function assertModelFile(path: string, file: string, size: number, sha256: string): Promise<void> {
  let info: { size: number }
  try { info = await stat(path) } catch {
    throw new OfflinePackError(1, `${file} is not in the model directory.`)
  }
  if (info.size !== size) throw new OfflinePackError(1, `${file} is ${info.size} bytes. The registry says ${size}.`)
  const digest = await sha256File(path)
  if (digest !== sha256) throw new OfflinePackError(1, `${file} checksum did not match the registry.`)
}

function placeFile(source: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) unlinkSync(dest)
  try { linkSync(source, dest) } catch { copyFileSync(source, dest) }
}

function signMac(app: string): void {
  const cleared = spawnSync('xattr', ['-cr', app], { encoding: 'utf8' })
  if (cleared.status !== 0) throw new OfflinePackError(1, `xattr failed on the Mac app. ${cleared.stderr || ''}`.trim())
  const signed = spawnSync('codesign', ['--force', '--sign', '-', app], { encoding: 'utf8' })
  if (signed.status !== 0) throw new OfflinePackError(1, `codesign failed on the Mac app. ${signed.stderr || ''}`.trim())
}

function zipStore(folder: string, destZip: string): void {
  mkdirSync(dirname(destZip), { recursive: true })
  if (existsSync(destZip)) unlinkSync(destZip)
  const result = spawnSync('zip', ['-r', '-0', '-y', destZip, basename(folder)], { cwd: dirname(folder), encoding: 'utf8' })
  if (result.status !== 0) throw new OfflinePackError(1, `zip failed. ${result.stderr || result.stdout || result.status}`)
}

function uploadHuggingFace(file: string, repo: string, pathInRepo: string): void {
  const script = [
    'import os, sys',
    'from huggingface_hub import HfApi',
    'token = os.environ.get("HF_TOKEN", "")',
    'if not token:',
    '    sys.exit("HF_TOKEN is empty.")',
    'api = HfApi(token=token)',
    'info = api.repo_info(repo_id=sys.argv[3], repo_type="dataset")',
    'if info.private:',
    '    sys.exit("The dataset " + sys.argv[3] + " is private. Make it public so the website can link to it.")',
    'api.upload_file(path_or_fileobj=sys.argv[1], path_in_repo=sys.argv[2], repo_id=sys.argv[3], repo_type="dataset", commit_message=sys.argv[4])',
  ].join('\n')
  const result = spawnSync('python3', ['-c', script, file, pathInRepo, repo, `Add ${basename(file)}`], { encoding: 'utf8' })
  if (result.status !== 0) throw new OfflinePackError(1, `Hugging Face upload failed. ${result.stderr || result.stdout || ''}`.trim())
}

export async function packOfflineZip(input: PackOfflineInput): Promise<OfflineCatalogEntry> {
  const modelBytes = input.model.sizeBytes + input.embedding.sizeBytes
  if (offlineUploadPlan(modelBytes, input.hasHfToken) === 'missing-token') {
    throw new OfflinePackError(1, missingHfTokenMessage(input.model.token, modelBytes, input.repo))
  }
  const platform = input.platform ?? process.platform
  if (input.os === 'mac' && !input.noSign && platform !== 'darwin') {
    throw new OfflinePackError(1, 'Mac offline zips are signed on a macOS runner.')
  }
  const app = resolvePackedApp(input.appDir, input.os)
  mkdirSync(input.outDir, { recursive: true })
  const appBytes = directoryBytes(app)
  const free = input.freeBytes ?? readDiskFree(input.outDir)
  if (!offlineDiskOk(free, appBytes, modelBytes, input.countDownloadCache)) {
    throw new OfflinePackError(2, offlineDiskMessage(input.model.token, offlineDiskNeed(appBytes, modelBytes, input.countDownloadCache), free))
  }
  await assertModelFile(input.chatPath, input.model.file, input.model.sizeBytes, input.model.sha256)
  await assertModelFile(input.embedPath, input.embedding.file, input.embedding.sizeBytes, input.embedding.sha256)
  const stageParent = join(input.outDir, `.stage-${input.os}-${input.arch}-${input.model.token}`)
  rmSync(stageParent, { recursive: true, force: true })
  mkdirSync(stageParent, { recursive: true })
  const stagedName = input.os === 'mac' ? 'Synap.surf.app' : 'Synap.surf'
  const staged = join(stageParent, stagedName)
  try {
    const copy = spawnSync('cp', ['-a', app, staged], { encoding: 'utf8' })
    if (copy.status !== 0) cpSync(app, staged, { recursive: true, verbatimSymlinks: true })
    const modelsRoot = join(staged, ...setupModelsSegments(input.os))
    placeFile(input.chatPath, join(modelsRoot, input.model.file))
    placeFile(input.embedPath, join(modelsRoot, input.embedding.file))
    const manifest = buildBundledManifest(input.model, input.embedding)
    writeFileSync(join(modelsRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    if (input.os === 'mac' && !input.noSign) signMac(staged)
    const name = offlineAssetName(input.version, input.arch, input.model.token)
    const zipPath = join(input.outDir, name)
    zipStore(staged, zipPath)
    const zipBytes = statSync(zipPath).size
    if (offlineUploadPlan(zipBytes, input.hasHfToken) === 'missing-token') {
      throw new OfflinePackError(1, missingHfTokenMessage(input.model.token, zipBytes, input.repo))
    }
    const host = offlineHostFor(zipBytes)
    const tag = releaseTag(input.tag)
    const url = host === 'github' ? githubReleaseAssetUrl(tag, name) : huggingfaceFileUrl(input.repo, tag, name)
    const entry: OfflineCatalogEntry = {
      name,
      bytes: zipBytes,
      url,
      host,
      os: input.os,
      arch: input.arch,
      token: input.model.token,
      modelBytes,
    }
    if (host === 'huggingface') {
      const pathInRepo = `${tag}/${name}`
      if (input.upload) input.upload(zipPath, input.repo, pathInRepo)
      else uploadHuggingFace(zipPath, input.repo, pathInRepo)
      unlinkSync(zipPath)
    }
    appendOfflineCatalog(input.catalogPath, entry)
    return entry
  } finally {
    rmSync(stageParent, { recursive: true, force: true })
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function fileReady(path: string, size: number): Promise<boolean> {
  try { return (await stat(path)).size === size } catch { return false }
}

async function main(): Promise<void> {
  const os = arg('os')
  const arch = arg('arch')
  const token = arg('token')
  const version = arg('version')
  const appDir = arg('app')
  const outDir = arg('out')
  const catalogPath = arg('catalog')
  if (!appDir || (os !== 'mac' && os !== 'windows') || (arch !== 'arm64' && arch !== 'x64') || (token !== '2b' && token !== '4b' && token !== '9b') || !version || !outDir || !catalogPath) {
    throw new OfflinePackError(1, 'Usage: pack-offline-zip.ts --app <app> --os mac|windows --arch arm64|x64 --token 2b|4b|9b --version <version> --out <dir> --catalog <file.json>')
  }
  const parsed = JSON.parse(readFileSync(new URL('../resources/models.registry.json', import.meta.url), 'utf8')) as { models?: unknown }
  if (!Array.isArray(parsed.models)) throw new OfflinePackError(1, 'The model registry has no models list.')
  const planned = planOfflineModel(parsed.models as Parameters<typeof planOfflineModel>[0], token as OfflineToken)
  if (!planned) throw new OfflinePackError(1, `No registry row for ${token}.`)
  const repo = process.env.HF_OFFLINE_REPO?.trim() || HF_OFFLINE_REPO
  const hasHfToken = Boolean(process.env.HF_TOKEN?.trim())
  if (offlineUploadPlan(planned.modelBytes, hasHfToken) === 'missing-token') {
    throw new OfflinePackError(1, missingHfTokenMessage(token, planned.modelBytes, repo))
  }
  const app = resolvePackedApp(appDir, os)
  mkdirSync(outDir, { recursive: true })
  const modelsDir = arg('models-dir') || join(outDir, `.models-${token}`)
  await mkdir(modelsDir, { recursive: true })
  const chatPath = join(modelsDir, planned.model.file)
  const embedPath = join(modelsDir, planned.embedding.file)
  const ready = await fileReady(chatPath, planned.model.sizeBytes) && await fileReady(embedPath, planned.embedding.sizeBytes)
  const free = readDiskFree(outDir)
  const appBytes = directoryBytes(app)
  if (!offlineDiskOk(free, appBytes, planned.modelBytes, !ready)) {
    throw new OfflinePackError(2, offlineDiskMessage(token, offlineDiskNeed(appBytes, planned.modelBytes, !ready), free))
  }
  if (!ready) {
    await downloadVerified({ url: planned.model.url, dest: chatPath, size: planned.model.sizeBytes, sha256: planned.model.sha256 })
    await downloadVerified({ url: planned.embedding.url, dest: embedPath, size: planned.embedding.sizeBytes, sha256: planned.embedding.sha256 })
  }
  const entry = await packOfflineZip({
    appDir,
    os,
    arch,
    version,
    tag: arg('tag') || `v${version.replace(/^v/, '')}`,
    outDir,
    catalogPath,
    repo,
    hasHfToken,
    model: planned.model,
    embedding: planned.embedding,
    chatPath,
    embedPath,
    noSign: flag('no-sign'),
    countDownloadCache: false,
  })
  process.stdout.write(`${entry.name} ${entry.bytes} ${entry.host} ${entry.url}\n`)
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invoked) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'offline pack failed'
    process.stderr.write(`${message}\n`)
    process.exit(error instanceof OfflinePackError ? error.exitCode : 1)
  })
}
