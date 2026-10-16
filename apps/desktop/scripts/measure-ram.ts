/**
 * Report on-disk size of the 4B and 9B GGUF files when they are present.
 * Missing files are not a failure. This does not start llama-server.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.SURF_MODELS_DIR || join(process.cwd(), 'resources')
const names = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : []

function find(hint: string): string | null {
  const hit = names.find((name) => name.toLowerCase().includes(hint) && name.endsWith('.gguf'))
  return hit ? join(root, hit) : null
}

const rows = ['4b', '9b'].map((size) => {
  const path = find(size)
  if (!path || !existsSync(path)) return { size, measured: false, reason: 'file-absent' }
  return { size, measured: true, bytes: statSync(path).size, file: path.split(/[/\\]/).pop() }
})

process.stdout.write(`${JSON.stringify({ measured: rows.every((row) => row.measured), rows }, null, 2)}\n`)
if (!rows.every((row) => row.measured)) {
  process.stderr.write('RAM measurement skipped: 4B or 9B GGUF is not in SURF_MODELS_DIR.\n')
}
