/**
 * Download registry GGUF files and check size plus SHA-256.
 * Weights stay outside git. A cache hit is hashed again before use.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const REGISTRY = join(REPO, 'apps', 'desktop', 'resources', 'models.registry.json')

export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function verifyFile(path, sha256, sizeBytes) {
  if (!existsSync(path)) return { ok: false, reason: 'missing', size: 0, sha256: '' }
  const size = statSync(path).size
  if (size !== sizeBytes) return { ok: false, reason: 'size', size, sha256: '' }
  const digest = await hashFile(path)
  if (digest !== sha256) return { ok: false, reason: 'sha256', size, sha256: digest }
  return { ok: true, reason: 'match', size, sha256: digest }
}

export function registryEntries(ids, { mmproj = false } = {}) {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'))
  const want = new Set(ids)
  const files = []
  for (const model of registry.models) {
    if (!want.has(model.id)) continue
    files.push({
      id: model.id,
      file: model.file,
      url: model.url,
      sha256: model.sha256,
      sizeBytes: model.size_bytes,
      minRamGb: model.min_ram_gb,
      kind: 'weights',
    })
    if (mmproj && model.mmproj) {
      files.push({
        id: model.id,
        file: `${model.id}--${model.mmproj.file}`,
        url: model.mmproj.url,
        sha256: model.mmproj.sha256,
        sizeBytes: model.mmproj.size_bytes,
        minRamGb: model.min_ram_gb,
        kind: 'mmproj',
      })
    }
  }
  const missing = [...want].filter((id) => !files.some((row) => row.id === id && row.kind === 'weights'))
  if (missing.length) throw new Error(`registry has no ${missing.join(', ')}`)
  return files
}

export async function ensureModel(entry, dir) {
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, entry.file)
  const have = await verifyFile(dest, entry.sha256, entry.sizeBytes)
  if (have.ok) return { ...have, path: dest, cached: true }
  if (existsSync(dest)) rmSync(dest)
  const partial = `${dest}.part`
  if (existsSync(partial)) rmSync(partial)
  const response = await fetch(entry.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'synap-model-eval' },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${entry.file}`)
  await pipeline(response.body, createWriteStream(partial))
  const checked = await verifyFile(partial, entry.sha256, entry.sizeBytes)
  if (!checked.ok) {
    rmSync(partial, { force: true })
    throw new Error(`${entry.file} failed ${checked.reason} check`)
  }
  renameSync(partial, dest)
  return { ...checked, path: dest, cached: false }
}

function argValue(name) {
  const eq = process.argv.find((item) => item.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

async function main() {
  const printId = argValue('print')
  const ids = (argValue('ids') ?? printId ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!ids.length) throw new Error('pass --ids or --print')
  const mmproj = process.argv.includes('--mmproj')
  const entries = registryEntries(ids, { mmproj })
  if (printId || process.argv.includes('--print-key')) {
    if (printId) {
      const row = entries.find((item) => item.id === printId && item.kind === 'weights')
      if (!row) throw new Error(`no weights for ${printId}`)
      process.stdout.write(`sha256=${row.sha256}\nfile=${row.file}\nsize=${row.sizeBytes}\n`)
    }
    if (process.argv.includes('--print-key')) {
      process.stdout.write(`key=${entries.map((item) => item.sha256).join('-')}\n`)
    }
    return
  }
  const dir = argValue('dir') ?? process.env.SURF_MODELS_DIR ?? join(REPO, '.surf-models')
  for (const entry of entries) {
    const saved = await ensureModel(entry, dir)
    process.stdout.write(`${saved.cached ? 'cached' : 'downloaded'} ${entry.file} ${saved.sha256}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
