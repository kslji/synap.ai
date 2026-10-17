/**
 * Download Qwen3.5-2B Q4_K_M for the offline installer and check its SHA-256.
 * The expected size and hash come from models.registry.json.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const destDir = process.argv[2]
if (!destDir) {
  console.error('usage: node scripts/fetch-setup-model.mjs <directory>')
  process.exit(1)
}
const registry = JSON.parse(readFileSync(fileURLToPath(new URL('../resources/models.registry.json', import.meta.url)), 'utf8'))
const model = registry.models.find((row) => row.id === 'qwen3.5-2b-q4_k_m')
if (!model) {
  console.error('registry is missing qwen3.5-2b-q4_k_m')
  process.exit(1)
}
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, model.file)

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

if (!existsSync(dest) || statSync(dest).size !== model.size_bytes) {
  const result = spawnSync('curl', ['-L', '--fail', '--retry', '3', '--continue-at', '-', '-o', dest, model.url], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
const size = statSync(dest).size
if (size !== model.size_bytes) {
  console.error(`size ${size} != ${model.size_bytes}`)
  process.exit(1)
}
const digest = await hashFile(dest)
if (digest !== model.sha256) {
  console.error(`sha256 ${digest} != ${model.sha256}`)
  process.exit(1)
}
console.log(`ok ${model.file} ${size} ${digest}`)
