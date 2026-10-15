/**
 * Measure the code index on a sample tree.
 * Uses the deterministic hash embedder so disk size matches 256-d EmbeddingGemma vectors
 * without starting llama-server. RSS includes the Node process, not a model.
 *
 *   npx tsx scripts/measure-code-index.ts [folder]
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashEmbedder } from '../src/main/core/code/embed.js'
import { CodeIndex, dbFileBytes } from '../src/main/core/code/project.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] ?? join(here, '../src/main/core')
const grammarDir = join(here, '../resources/tree-sitter')
const dbPath = join(mkdtempSync(join(tmpdir(), 'surf-code-measure-')), 'index.sqlite')
async function main(): Promise<void> {
  const before = process.memoryUsage()
  const started = Date.now()
  const index = new CodeIndex({
    root,
    dbPath,
    keyHex: null,
    grammarDir,
    embedder: hashEmbedder(),
  })
  const status = await index.run()
  const after = process.memoryUsage()
  const firstMs = Date.now() - started
  const again = Date.now()
  const second = await index.run()
  const incrementalMs = Date.now() - again
  index.close()
  console.log(JSON.stringify({
    root,
    files: status.files,
    symbols: status.symbols,
    state: status.state,
    embeddings: status.embeddings,
    dbBytes: dbFileBytes(dbPath),
    firstMs,
    incrementalMs,
    secondFiles: second.files,
    rssBefore: before.rss,
    rssAfter: after.rss,
    heapBefore: before.heapUsed,
    heapAfter: after.heapUsed,
    note: '256-d vectors match EmbeddingGemma storage. RSS is this Node process, not llama-server.',
  }, null, 2))
}

void main()
