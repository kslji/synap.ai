/**
 * One-shot neural bake-off. Not part of CI. Writes agents/code/bakeoff.json.
 * Usage: npx tsx src/main/core/bakeoff-run.ts
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBEDDINGGEMMA2_256, Embedder } from './embedding.js'
import { LlamaClient } from './llama-client.js'
import { LlamaServer } from './sidecar-manager.js'
import { bm25Recall, CODE_FIXTURE, CODE_QUERIES, hybridRecall, pickWinner, qwenQuery, vectorRecall } from './code-retrieval.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const models = process.env.SURF_MODELS_DIR || '/home/ubuntu/surf-models'
const bin = join(root, 'apps/desktop/resources/bin/linux-x64/llama-server')

async function embedAll(server: LlamaServer, inputs: string[]): Promise<Float32Array[]> {
  const client = new LlamaClient({ baseUrl: server.baseUrl, apiKey: server.apiKey })
  const raw = await client.embed(inputs)
  return raw.map((vector) => {
    let norm = 0
    for (const value of vector) norm += value * value
    norm = Math.sqrt(norm) || 1
    const out = new Float32Array(vector.length)
    for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm
    return out
  })
}

async function main(): Promise<void> {
  const gemmaPath = join(models, 'embeddinggemma-2-Q8_0.gguf')
  const qwenPath = join(models, 'Qwen3-Embedding-0.6B-Q8_0.gguf')
  const gemma = new LlamaServer({ binPath: bin, modelPath: gemmaPath, embeddings: true, pooling: 'mean', ctx: 2048, gpuLayers: 0 })
  await gemma.start()
  const gemmaClient = new LlamaClient({ baseUrl: gemma.baseUrl, apiKey: gemma.apiKey })
  const gemmaEmbedder = new Embedder(gemmaClient, EMBEDDINGGEMMA2_256, 8)
  const gemmaDocs = await gemmaEmbedder.embedDocs(CODE_FIXTURE.map((chunk) => ({ title: chunk.name, text: chunk.text })))
  const gemmaQueries = await gemmaEmbedder.embedQueries(CODE_QUERIES.map((query) => query.text))
  await gemma.stop()

  const qwen = new LlamaServer({ binPath: bin, modelPath: qwenPath, embeddings: true, pooling: 'last', ctx: 2048, gpuLayers: 0 })
  await qwen.start()
  const qwenDocs = await embedAll(qwen, CODE_FIXTURE.map((chunk) => `${chunk.name}\n${chunk.text}`))
  const qwenQueries = await embedAll(qwen, CODE_QUERIES.map((query) => qwenQuery(query.text)))
  await qwen.stop()

  const scores = {
    bm25: bm25Recall(),
    gemma: vectorRecall(gemmaDocs, gemmaQueries),
    qwen: vectorRecall(qwenDocs, qwenQueries),
    hybrid: 0,
  }
  const hybridGemma = hybridRecall(gemmaDocs, gemmaQueries)
  const hybridQwen = hybridRecall(qwenDocs, qwenQueries)
  scores.hybrid = Math.max(hybridGemma, hybridQwen)
  const winner = pickWinner(scores)
  const report = {
    winner,
    coderank: 'not-feasible',
    qwenEmbedding: 'measured',
    scores,
    hybridGemma,
    hybridQwen,
    queries: CODE_QUERIES.length,
    note: 'CodeRankEmbed has no official GGUF. EmbeddingGemma uses the product 256-d spec. Qwen3-Embedding-0.6B uses last-token pooling.',
  }
  const dest = join(root, 'agents/code/bakeoff.json')
  writeFileSync(dest, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
