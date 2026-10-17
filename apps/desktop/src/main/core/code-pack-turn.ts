/**
 * Retrieval for one Code-agent turn.
 * The licence gate runs before the sqlite file is opened.
 */
import { join } from 'node:path'
import type { Citation } from '../../shared/ipc-contract.js'
import type { CodeEmbedder } from './code/embed.js'
import { codePackDir, loadCodePack } from './code-pack.js'
import { detectProjectStack } from './code-pack-detect.js'
import { installBundledCodePack } from './code-pack-install.js'
import { codePackVectorPath, indexCodePackEmbeddings, openCodePackVectors } from './code-pack-index.js'
import { packReferenceBlock, unknownApiRefusal } from './code-pack-prompt.js'
import { searchCodePack, type PackHit } from './code-pack-search.js'
import { openCodePackDatabase } from './code-pack-store.js'
import { gatePackDecrypt } from './licence.js'
import type { TrustedKeys } from './pack-verify.js'

export interface CodePackTurn {
  reference: string
  citations: Citation[]
  hits: PackHit[]
  /** Set when the question names an API the pack does not contain. */
  answerOverride: string | null
}

const EMPTY: CodePackTurn = { reference: '', citations: [], hits: [], answerOverride: null }

export async function prepareCodePackTurn(opts: {
  userData: string
  bundledDir: string
  keys: TrustedKeys
  allowed: boolean
  projectRoot: string
  question: string
  maxChars?: number
  embedQuery?: (text: string) => Promise<Float32Array | null>
}): Promise<CodePackTurn> {
  const dest = codePackDir(opts.userData)
  let loaded = await loadCodePack(dest, opts.keys)
  if (loaded.status !== 'ready') {
    const installed = await installBundledCodePack(opts.bundledDir, dest, opts.keys)
    if (installed.status === 'ready') loaded = installed
  }
  const gate = gatePackDecrypt(loaded.status === 'ready', { allowed: opts.allowed, contentKey: null, encrypted: false })
  if (loaded.status !== 'ready' || gate.status !== 'ready') return EMPTY
  let db
  try {
    db = openCodePackDatabase(join(dest, 'keyword.sqlite'))
  } catch {
    return EMPTY
  }
  const vectors = openCodePackVectors(codePackVectorPath(dest))
  try {
    let qvec: Float32Array | null = null
    if (vectors && opts.embedQuery) {
      try { qvec = await opts.embedQuery(opts.question) } catch { qvec = null }
    }
    const stack = detectProjectStack(opts.projectRoot)
    const hits = searchCodePack(db, opts.question, {
      filter: { languages: stack.languages, libraries: stack.libraries },
      qvec,
      vectorDb: vectors,
      k: 8,
    })
    const refusal = unknownApiRefusal(opts.question, hits)
    if (refusal) return { reference: '', citations: [], hits, answerOverride: refusal }
    const block = packReferenceBlock(hits, opts.maxChars ?? 2400)
    return {
      reference: block.text,
      citations: block.used.map(citationFor),
      hits: block.used,
      answerOverride: null,
    }
  } finally {
    db.close()
    vectors?.close()
  }
}

export async function stepCodePackIndex(opts: {
  userData: string
  keys: TrustedKeys
  allowed: boolean
  embedder: CodeEmbedder
  busy?: () => boolean
}): Promise<void> {
  const dest = codePackDir(opts.userData)
  const loaded = await loadCodePack(dest, opts.keys)
  const gate = gatePackDecrypt(loaded.status === 'ready', { allowed: opts.allowed, contentKey: null, encrypted: false })
  if (loaded.status !== 'ready' || gate.status !== 'ready') return
  if (opts.busy?.()) return
  const db = openCodePackDatabase(join(dest, 'keyword.sqlite'))
  try {
    await indexCodePackEmbeddings({
      packDb: db,
      cachePath: codePackVectorPath(dest),
      embedder: opts.embedder,
      packVersion: loaded.manifest.version,
      maxChunks: 16,
      busy: opts.busy,
    })
  } finally {
    db.close()
  }
}

function citationFor(hit: PackHit): Citation {
  return {
    title: hit.citation,
    url: hit.sourceUrl,
    pack: hit.citation,
    version: hit.version,
    kind: 'document',
    excerpt: hit.text.slice(0, 280),
    locator: hit.heading,
  }
}
