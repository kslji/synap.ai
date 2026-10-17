/**
 * Build the signed Code pack: fetch pinned sources, clean, chunk, keyword index.
 * Embeddings are not created here. The app builds them on the device.
 *
 *   scripts/build-code-pack --dev-key --update-dev-pubkey
 *   CODE_PACK_SIGNING_KEY=<64 hex> CODE_PACK_SIGNING_KEY_ID=code-pack-1 scripts/build-code-pack
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chunkByHeading } from '../../apps/desktop/src/main/core/code-pack-chunk.ts'
import { createCodePackDatabase, insertCodePackChunks, type CodePackChunkRow } from '../../apps/desktop/src/main/core/code-pack-store.ts'
import { SOURCES, type CleanKind, type RawFile, type SourceSpec, type TreeSpec } from './catalog.ts'
import { goDocToMarkdown, htmlToMarkdown, javaDocToMarkdown, rstToMarkdown, rustDocToMarkdown, texiToMarkdown } from './clean.ts'
import { loadSigningSeed, publicHex, seedToPrivateKey, signManifest, writeDevSeed } from './sign.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const outDir = join(repo, 'apps', 'desktop', 'resources', 'code-pack')
const cacheDir = join(here, '.cache')
const keysPath = join(repo, 'apps', 'desktop', 'resources', 'pack-keys.json')

const flag = (name: string) => process.argv.includes(`--${name}`)

interface Piece {
  source: SourceSpec
  library: string
  headingHint: string
  text: string
  url: string
}

async function main(): Promise<void> {
  const keyId = process.env.CODE_PACK_SIGNING_KEY_ID?.trim() || 'code-pack-dev'
  const loaded = loadSigningSeed(flag('dev-key'))
  if (loaded.source === 'generated') writeDevSeed(loaded.seed)
  const privateKey = seedToPrivateKey(loaded.seed)
  const pub = publicHex(privateKey)
  if (flag('update-dev-pubkey')) updateDevKey(keyId, pub)
  else assertTrusted(keyId, pub)

  mkdirSync(cacheDir, { recursive: true })
  const pieces: Piece[] = []
  const notices: string[] = []
  for (const source of SOURCES) {
    process.stdout.write(`source ${source.id}\n`)
    if (source.licenceUrl && source.licenceIncludes) {
      const licence = await fetchText(source.licenceUrl)
      if (!licence.includes(source.licenceIncludes)) {
        throw new Error(`${source.id} licence file did not contain ${source.licenceIncludes}`)
      }
    }
    const got = source.id === 'cards' ? readCards(source) : await fetchSource(source)
    const capped = capPieces(got, source.maxChars)
    pieces.push(...capped)
    notices.push(noticeBlock(source, capped.length))
    process.stdout.write(`  pieces ${capped.length}\n`)
  }
  const rows = chunkPieces(pieces)
  if (rows.length < 50) throw new Error(`only ${rows.length} chunks, expected a real pack`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const dbPath = join(outDir, 'keyword.sqlite')
  const db = createCodePackDatabase(dbPath)
  insertCodePackChunks(db, rows)
  db.close()
  const sourceRows = SOURCES.map((source) => ({
    id: source.id,
    title: source.title,
    version: source.version,
    licence: source.licence,
    url: source.url,
    attribution: source.attribution,
  }))
  const notice = [
    'Code pack attribution',
    '',
    'This pack is a compilation. Each work keeps its own licence.',
    'Original Synap.surf cards are CC0-1.0 and are not derivatives of the upstream texts.',
    'Embeddings are not in this pack. The app builds them on the device.',
    '',
    ...notices,
  ].join('\n')
  writeFileSync(join(outDir, 'NOTICE'), notice)
  writeFileSync(join(outDir, 'sources.json'), `${JSON.stringify(sourceRows, null, 2)}\n`)
  const files = ['keyword.sqlite', 'NOTICE', 'sources.json'].map((name) => fileEntry(join(outDir, name), name))
  const manifest = {
    format: 'surf-code-pack/1',
    pack_id: 'code',
    version: '2026.10.17',
    created_at: '2026-10-17T00:00:00Z',
    min_app_version: '0.1.0',
    signing_key_id: keyId,
    notes: keyId === 'code-pack-dev'
      ? 'Development signature. Replace CODE_PACK_SIGNING_KEY before a production pack.'
      : 'Signed with the CI key.',
    chunk_count: rows.length,
    sources: sourceRows,
    files,
  }
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(outDir, 'manifest.json'), body)
  writeFileSync(join(outDir, 'manifest.sig'), signManifest(body, privateKey))
  const bytes = files.reduce((sum, file) => sum + file.size, 0) + body.length + 64
  process.stdout.write(`chunks ${rows.length}\n`)
  process.stdout.write(`bytes ${bytes}\n`)
  process.stdout.write(`key ${keyId} ${pub}\n`)
  process.stdout.write(`signed from ${loaded.source}\n`)
}

function readCards(source: SourceSpec): Piece[] {
  const dir = join(here, 'cards')
  const pieces: Piece[] = []
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.md'))) {
    const raw = readFileSync(join(dir, name), 'utf8')
    const meta = frontmatter(raw)
    const body = raw.replace(/^---[\s\S]*?---\n/, '')
    pieces.push({
      source: {
        ...source,
        language: meta.language || source.language,
        library: meta.library || source.library,
        title: meta.title || source.title,
      },
      library: meta.library || source.library,
      headingHint: basename(name, '.md'),
      text: body,
      url: meta.source_url || source.url,
    })
  }
  return pieces
}

function frontmatter(raw: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(raw)
  const out: Record<string, string> = {}
  if (!match) return out
  for (const line of match[1].split('\n')) {
    const split = line.indexOf(':')
    if (split > 0) out[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  return out
}

async function fetchSource(source: SourceSpec): Promise<Piece[]> {
  if (source.archiveUrl) return fetchArchive(source)
  const files = source.files ? [...source.files] : []
  if (source.tree) files.push(...await listTree(source.tree))
  if (!source.rawBase && !files.length) return []
  const pieces: Piece[] = []
  for (const file of files) {
    const url = `${source.rawBase ?? ''}${file.path}`
    const text = clean(await fetchText(url), file.clean, file.library)
    if (text.length < 40) continue
    pieces.push({ source, library: file.library, headingHint: file.library, text, url: pageUrl(source, file) })
  }
  return pieces
}

async function listTree(tree: TreeSpec): Promise<RawFile[]> {
  const match = new RegExp(tree.match)
  const files: RawFile[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (files.length >= tree.limit || depth > 2) return
    const url = `https://api.github.com/repos/${tree.repo}/contents/${dir}?ref=${tree.ref}`
    const parsed = JSON.parse(await fetchText(url)) as { name?: string; path?: string; type?: string; message?: string }[] | { message?: string }
    if (!Array.isArray(parsed)) throw new Error(`${tree.repo} ${dir}: ${parsed.message ?? 'not a directory'}`)
    for (const row of parsed) {
      if (!row.name || !row.path || !row.type) continue
      if (row.type === 'dir') {
        await walk(row.path, depth + 1)
        continue
      }
      if (row.type !== 'file' || !match.test(row.name)) continue
      const stem = row.name.replace(/\.[^.]+$/, '')
      files.push({
        path: `https://raw.githubusercontent.com/${tree.repo}/${tree.ref}/${row.path}`,
        library: tree.libraryFrom === 'fixed' ? (tree.library || stem) : stem,
        clean: tree.clean,
      })
      if (files.length >= tree.limit) return
    }
  }
  await walk(tree.dir, 0)
  if (!files.length) throw new Error(`no files in ${tree.repo} ${tree.dir}`)
  return files
}

async function fetchArchive(source: SourceSpec): Promise<Piece[]> {
  const dest = join(cacheDir, source.id)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const archive = join(cacheDir, `${source.id}.bin`)
  if (!existsSync(archive) || statSync(archive).size < 1000) {
    writeFileSync(archive, await downloadArchive(source))
  }
  if (source.archiveUrl!.endsWith('.zip')) execFileSync('unzip', ['-q', archive, '-d', dest])
  else execFileSync('tar', ['-xf', archive, '-C', dest])
  const needles = source.archivePick ?? []
  const found = walkFiles(dest).filter((path) => needles.some((needle) => path.includes(needle)))
  const picked = found.slice(0, 24)
  if (!picked.length) throw new Error(`${source.id} archive had none of ${needles.join(', ')}`)
  return picked.map((path) => {
    const raw = readFileSync(path, 'utf8')
    const library = basename(path).replace(/\.[^.]+$/, '')
    return {
      source,
      library,
      headingHint: library,
      text: clean(raw, source.archiveClean || 'html', library).slice(0, 80_000),
      url: source.url,
    }
  })
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) out.push(...walkFiles(path))
    else out.push(path)
  }
  return out
}

function clean(text: string, kind: CleanKind, library: string): string {
  if (kind === 'html') return htmlToMarkdown(text)
  if (kind === 'rst') return rstToMarkdown(text)
  if (kind === 'java') return javaDocToMarkdown(text, library)
  if (kind === 'go') return goDocToMarkdown(text, library)
  if (kind === 'rust') return rustDocToMarkdown(text, library)
  if (kind === 'texi') return texiToMarkdown(text)
  if (kind === 'adoc') return text.replace(/^=+ /gm, (marks) => `${'#'.repeat(marks.trim().length)} `)
  return text
}

function capPieces(pieces: Piece[], maxChars: number): Piece[] {
  const out: Piece[] = []
  let used = 0
  for (const piece of pieces) {
    if (used >= maxChars) break
    const room = maxChars - used
    const text = piece.text.length > room ? piece.text.slice(0, room) : piece.text
    if (text.length < 40) continue
    out.push({ ...piece, text })
    used += text.length
  }
  return out
}

function chunkPieces(pieces: Piece[]): CodePackChunkRow[] {
  const rows: CodePackChunkRow[] = []
  for (const piece of pieces) {
    const drafts = chunkByHeading(piece.text)
    const chunks = drafts.length ? drafts : [{ heading: piece.headingHint, text: piece.text.slice(0, 1800) }]
    for (const draft of chunks) {
      const marked = libraryMark(draft.heading, piece.library)
      const text = draft.text.trim()
      if (text.length < 40) continue
      const citation = piece.source.licence === 'CC0-1.0'
        ? `Synap.surf Code pack, ${marked.heading}`
        : `${piece.source.title}, ${marked.library}`
      rows.push({
        language: piece.source.language,
        library: marked.library,
        version: piece.source.version,
        sourceUrl: piece.url,
        licence: piece.source.licence,
        title: piece.source.title,
        heading: marked.heading,
        citation,
        text,
      })
    }
  }
  return rows
}

function libraryMark(heading: string, fallback: string): { heading: string; library: string } {
  const match = /^(.*)\s+\{library=([a-z0-9.+-]+)\}$/.exec(heading.trim())
  if (!match) return { heading, library: fallback }
  return { heading: match[1], library: match[2] }
}

function pageUrl(source: SourceSpec, file: RawFile): string {
  if (file.path.startsWith('https://')) return file.path
  if (source.id === 'python') return `https://docs.python.org/3.14/library/${file.library}.html`
  if (source.id === 'node') return `https://nodejs.org/docs/v24.10.0/api/${file.library}.html`
  if (source.id === 'mdn') return `https://developer.mozilla.org/${file.path.replace(/^files\//, '').replace(/\/index\.md$/, '')}`
  return source.url
}

function noticeBlock(source: SourceSpec, pieces: number): string {
  return [
    source.title,
    `  version: ${source.version}`,
    `  licence: ${source.licence}`,
    `  url: ${source.url}`,
    `  attribution: ${source.attribution}`,
    `  pieces: ${pieces}`,
    '',
  ].join('\n')
}

function fileEntry(path: string, name: string): { name: string; size: number; sha256: string } {
  const body = readFileSync(path)
  return { name, size: body.length, sha256: createHash('sha256').update(body).digest('hex') }
}

function updateDevKey(id: string, hex: string): void {
  const parsed = JSON.parse(readFileSync(keysPath, 'utf8')) as { keys: Record<string, string> }
  parsed.keys[id] = hex
  writeFileSync(keysPath, `${JSON.stringify(parsed, null, 2)}\n`)
}

function assertTrusted(id: string, hex: string): void {
  const parsed = JSON.parse(readFileSync(keysPath, 'utf8')) as { keys: Record<string, string> }
  if (parsed.keys[id] !== hex) {
    throw new Error(`public key for ${id} does not match pack-keys.json. Pass --update-dev-pubkey only for the dev key, or set the matching CODE_PACK_SIGNING_KEY.`)
  }
}

async function fetchText(url: string): Promise<string> {
  return (await fetchBytes(url)).toString('utf8')
}

async function downloadArchive(source: SourceSpec): Promise<Buffer> {
  const urls = [source.archiveUrl!]
  if (source.id === 'sqlite') {
    urls.push('https://www.sqlite.org/2026/sqlite-doc-3540100.zip', 'https://sqlite.org/2025/sqlite-doc-3540100.zip')
  }
  let last = 'no archive url'
  for (const url of urls) {
    try { return await fetchBytes(url) } catch (error) { last = (error as Error).message }
  }
  throw new Error(`${source.id} archive: ${last}`)
}

async function fetchBytes(url: string): Promise<Buffer> {
  let last = 'fetch failed'
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const headers: Record<string, string> = { 'User-Agent': 'synap-code-pack' }
      if (url.includes('api.github.com')) headers.Accept = 'application/vnd.github+json'
      const response = await fetch(url, { headers, redirect: 'follow' })
      if (response.status === 404) throw new Error(`404 ${url}`)
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      last = (error as Error).message
      if (last.startsWith('404')) throw error
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw new Error(last)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
