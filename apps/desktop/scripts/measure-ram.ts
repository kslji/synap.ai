/**
 * Report on-disk size of the 4B and 9B GGUF files when they are present.
 * Missing files are not a failure. This does not start llama-server.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.SURF_MODELS_DIR || join(process.cwd(), 'resources')
const names = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : []

function find(size: string): string | null {
  const hit = names.find((name) => {
    const lower = name.toLowerCase()
    return lower.endsWith('.gguf') && lower.includes('qwen') && lower.includes(size)
  })
  return hit ? join(root, hit) : null
}

const rows = ['4b', '9b'].map((size) => {
  const path = find(size)
  if (!path || !existsSync(path)) return { size, measured: false, fileBytes: null, rssMb: null, reason: 'file-absent' }
  return { size, measured: false, fileBytes: statSync(path).size, rssMb: null, file: path.split(/[/\\]/).pop(), reason: 'weights-present-not-loaded' }
})

process.stdout.write(`${JSON.stringify({ measured: rows.every((row) => row.rssMb != null), rows }, null, 2)}\n`)
if (!rows.every((row) => row.rssMb != null)) {
  process.stderr.write('RAM was not measured. llama-server was not started. A missing GGUF is not a failure.\n')
}
