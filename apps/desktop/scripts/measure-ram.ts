/**
 * Start llama-server for each Qwen GGUF that is on disk and sample its RSS.
 * A missing file is not a failure. A file that will not load is a failure.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlamaServer } from '../src/main/core/sidecar-manager.ts'
import { availableRamGb, watchRss } from './rss.ts'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const sizes = ['2b', '4b', '9b'] as const

function modelsDir(): string {
  return process.env.SURF_MODELS_DIR || join(desktop, 'resources')
}

function find(size: string): string | null {
  const root = modelsDir()
  if (!existsSync(root)) return null
  const hit = readdirSync(root, { withFileTypes: true }).find((entry) => {
    if (!entry.isFile()) return false
    const lower = entry.name.toLowerCase()
    return lower.endsWith('.gguf') && lower.includes('qwen') && lower.includes(size) && !lower.includes('mmproj')
  })
  return hit ? join(root, hit.name) : null
}

function serverBin(): string {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(desktop, 'resources', 'bin', `${process.platform}-${process.arch}`, exe)
}

async function measureFile(path: string): Promise<{ rssMb: number }> {
  if (!existsSync(serverBin())) throw new Error('llama-server is not installed. Run node scripts/fetch-sidecars.mjs')
  const server = new LlamaServer({
    binPath: serverBin(),
    modelPath: path,
    ctx: path.toLowerCase().includes('9b') ? 16384 : 8192,
    threads: 4,
    gpuLayers: process.platform === 'darwin' ? 'auto' : 0,
    startupTimeoutMs: 180_000,
  })
  const watch = watchRss(() => server.pid)
  try {
    await server.start()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return { rssMb: Math.round(watch.stop() * 10) / 10 }
  } finally {
    watch.stop()
    await server.stop()
  }
}

async function main(): Promise<void> {
const rows = []
for (const size of sizes) {
  const path = find(size)
  if (!path) {
    rows.push({ size, measured: false, fileBytes: null, rssMb: null, reason: 'file-absent' })
    continue
  }
  const fileBytes = statSync(path).size
  const file = path.split(/[/\\]/).pop()
  try {
    const { rssMb } = await measureFile(path)
    rows.push({ size, measured: true, fileBytes, rssMb, file, reason: 'llama-server' })
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'load-failed'
    rows.push({ size, measured: false, fileBytes, rssMb: null, file, reason })
  }
}

const present = rows.filter((row) => row.reason !== 'file-absent')
const measured = present.length > 0 && present.every((row) => row.rssMb != null)
const report = { measured, availableRamGb: availableRamGb(), rows }
const outFlag = process.argv.findIndex((item) => item === '--out' || item.startsWith('--out='))
const out = outFlag < 0 ? undefined : process.argv[outFlag]?.startsWith('--out=') ? process.argv[outFlag].slice('--out='.length) : process.argv[outFlag + 1]
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
}
if (!measured) {
  process.stderr.write(present.length === 0
    ? 'RAM was not measured. No Qwen GGUF was found. A missing file is not a failure.\n'
    : 'RAM measurement failed for a GGUF that is on disk.\n')
}
if (present.some((row) => row.rssMb == null)) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
