/**
 * Code-pack eval on the CI Qwen 2B subset.
 * The report stores ids and booleans only. Prompt and answer text stay out of it.
 *
 * Retrieval is exact: every expected fact string must appear in the top chunks.
 * Model answers are scored the same way, pack context on versus off.
 * Temperature is 0 so a rerun is comparable. The app's chat sampling is unchanged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlamaClient } from '../src/main/core/llama-client.ts'
import { LlamaServer } from '../src/main/core/sidecar-manager.ts'
import { loadCodePack } from '../src/main/core/code-pack.ts'
import { CODE_PACK_QUESTIONS, type CodePackQuestion } from '../src/main/core/code-pack-eval-set.ts'
import { ensureCitations, packReferenceBlock, unknownApiRefusal } from '../src/main/core/code-pack-prompt.ts'
import { searchCodePack, type PackHit } from '../src/main/core/code-pack-search.ts'
import { openCodePackDatabase } from '../src/main/core/code-pack-store.ts'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(desktop, '..', '..')

function option(name: string): string | undefined {
  const eq = process.argv.find((item) => item.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  const next = index >= 0 ? process.argv[index + 1] : undefined
  return next && !next.startsWith('--') ? next : undefined
}

function serverBin(): string {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(desktop, 'resources', 'bin', `${process.platform}-${process.arch}`, exe)
}

function hasAll(text: string, expect: string[]): boolean {
  return expect.every((fact) => text.includes(fact))
}

function hitsFor(db: ReturnType<typeof openCodePackDatabase>, question: CodePackQuestion): PackHit[] {
  return searchCodePack(db, question.question, {
    filter: { languages: [question.language], libraries: question.libraries ?? [] },
    k: 8,
  })
}

const DENIAL = /not in the code pack|does not exist|doesn't exist|do not exist|don't exist|no such|unknown api|not a real|do not know|don't know|cannot find|can't find|not defined|will not guess/i

function refusesFake(text: string): boolean {
  return DENIAL.test(text)
}

async function ask(server: LlamaServer, prompt: string): Promise<string> {
  const client = new LlamaClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    sampling: { temperature: 0, top_p: 1, top_k: 1, presence_penalty: 0 },
    chatTemplateKwargs: { enable_thinking: false },
  })
  const result = await client.chatCollect(
    [{ role: 'user', content: prompt }],
    undefined,
    undefined,
    160,
    undefined,
    () => undefined,
  )
  const text = result.choices[0]?.message.content
  return typeof text === 'string' ? text : ''
}

function onPrompt(question: string, reference: string): string {
  return `${reference}\n\nQuestion: ${question}\nAnswer from the sources. Cite each source you use as From: <label>.`
}

function offPrompt(question: string): string {
  return `Question: ${question}\nAnswer from what you know. If you are not sure, say you do not know. Do not invent APIs.`
}

interface Row {
  id: string
  retrieval: boolean
  on_fact: boolean | null
  off_fact: boolean | null
  on_cited_model: boolean | null
  on_cited_product: boolean | null
  on_fake: boolean | null
  off_fake: boolean | null
  on_model_called: boolean
}

async function main(): Promise<void> {
  const packDir = option('pack') ?? join(desktop, 'resources', 'code-pack')
  const keys = JSON.parse(readFileSync(join(desktop, 'resources', 'pack-keys.json'), 'utf8')) as { keys: Record<string, string> }
  const loaded = await loadCodePack(packDir, keys.keys)
  if (loaded.status !== 'ready') throw new Error(`code pack ${loaded.status}`)
  const db = openCodePackDatabase(join(packDir, 'keyword.sqlite'))
  const prepared = CODE_PACK_QUESTIONS.map((question) => {
    const hits = hitsFor(db, question)
    const blob = hits.map((hit) => `${hit.heading}\n${hit.text}`).join('\n')
    const block = packReferenceBlock(hits, 2400)
    return { question, hits, blob, block }
  })
  db.close()

  const retrievalMisses = prepared.filter((row) => !row.question.fakeApi && !hasAll(row.blob, row.question.expect))
  for (const row of prepared) {
    const ok = row.question.fakeApi ? true : hasAll(row.blob, row.question.expect)
    process.stdout.write(`retrieval ${row.question.id} ${ok ? 'ok' : 'miss'}\n`)
  }
  if (retrievalMisses.length) {
    process.stderr.write(`retrieval missed ${retrievalMisses.map((row) => row.question.id).join(',')}\n`)
  }

  const modelId = 'qwen3.5-2b-q4_k_m'
  const modelFile = option('model') ?? join(option('dir') ?? process.env.SURF_MODELS_DIR ?? join(repo, '.surf-models'), 'Qwen3.5-2B-Q4_K_M.gguf')
  const skipModel = process.argv.includes('--retrieval-only')
  const rows: Row[] = []
  if (!skipModel) {
    if (!existsSync(serverBin())) throw new Error('llama-server is not installed. Run node apps/desktop/scripts/fetch-sidecars.mjs')
    if (!existsSync(modelFile)) throw new Error(`missing ${modelFile}`)
    const server = new LlamaServer({
      binPath: serverBin(),
      modelPath: modelFile,
      ctx: 8192,
      threads: Math.min(8, availableParallelism()),
      gpuLayers: process.platform === 'darwin' ? 'auto' : 0,
      startupTimeoutMs: 180_000,
    })
    await server.start()
    try {
      for (const row of prepared) {
        const question = row.question
        const refusal = unknownApiRefusal(question.question, row.hits)
        let onText = ''
        let called = false
        if (question.fakeApi && refusal) onText = refusal
        else if (row.block.text) {
          called = true
          onText = await ask(server, onPrompt(question.question, row.block.text))
        }
        called = called || !question.fakeApi
        if (!question.fakeApi && !row.block.text) {
          called = true
          onText = await ask(server, offPrompt(question.question))
        }
        const offText = await ask(server, offPrompt(question.question))
        const product = ensureCitations(onText, row.block.used)
        const scored: Row = {
          id: question.id,
          retrieval: question.fakeApi ? !refusal || refusal.includes('not in the Code pack') : hasAll(row.blob, question.expect),
          on_fact: question.fakeApi ? null : hasAll(onText, question.expect),
          off_fact: question.fakeApi ? null : hasAll(offText, question.expect),
          on_cited_model: question.fakeApi ? null : onText.includes('From: '),
          on_cited_product: question.fakeApi ? null : row.block.used.slice(0, 3).every((hit) => product.includes(`From: ${hit.citation}`)),
          on_fake: question.fakeApi ? refusesFake(onText) : null,
          off_fake: question.fakeApi ? refusesFake(offText) : null,
          on_model_called: question.fakeApi ? !refusal : called,
        }
        rows.push(scored)
        const shotPath = process.env.SURF_CODE_PACK_SHOT
        if (shotPath && question.id === 'py-asyncio-run' && row.block.used[0]) {
          const hit = row.block.used[0]
          writeFileSync(shotPath, `${JSON.stringify({
            question: question.question,
            answer: product,
            citation: hit.citation,
            version: hit.version,
            url: hit.sourceUrl,
            excerpt: hit.text.slice(0, 280),
            heading: hit.heading,
          })}\n`)
        }
        process.stdout.write(`${question.id} on=${scored.on_fact ?? scored.on_fake} off=${scored.off_fact ?? scored.off_fake}\n`)
      }
    } finally {
      await server.stop()
    }
  } else {
    for (const row of prepared) {
      rows.push({
        id: row.question.id,
        retrieval: row.question.fakeApi ? true : hasAll(row.blob, row.question.expect),
        on_fact: null,
        off_fact: null,
        on_cited_model: null,
        on_cited_product: null,
        on_fake: null,
        off_fake: null,
        on_model_called: false,
      })
    }
  }

  const facts = rows.filter((row) => row.on_fact != null)
  const fakes = rows.filter((row) => row.on_fake != null)
  const count = (values: Array<boolean | null>) => values.filter((value) => value === true).length
  const report = {
    pack_version: loaded.manifest.version,
    chunk_count: loaded.manifest.chunk_count ?? null,
    signing_key_id: loaded.manifest.signing_key_id,
    model: skipModel ? null : modelId,
    sampling: skipModel ? null : { temperature: 0, top_p: 1, top_k: 1, presence_penalty: 0, enable_thinking: false, max_tokens: 160 },
    retrieval: { total: facts.length, pass: count(facts.map((row) => row.retrieval)) },
    model_on: skipModel ? null : {
      fact_total: facts.length,
      fact_pass: count(facts.map((row) => row.on_fact)),
      cited_before_footer: count(facts.map((row) => row.on_cited_model)),
      cited_after_footer: count(facts.map((row) => row.on_cited_product)),
      fake_total: fakes.length,
      fake_pass: count(fakes.map((row) => row.on_fake)),
    },
    model_off: skipModel ? null : {
      fact_total: facts.length,
      fact_pass: count(facts.map((row) => row.off_fact)),
      fake_total: fakes.length,
      fake_pass: count(fakes.map((row) => row.off_fake)),
    },
    rows,
  }
  const out = option('out') ?? join(repo, 'harness', 'reports', 'code-pack-eval.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`wrote ${out}\n`)
  if (retrievalMisses.length) process.exit(1)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`)
  process.exit(1)
})
