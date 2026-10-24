import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from '../native-test-support.js'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { makeDocx, makePdf, makePptx } from '../samples.js'
import { extractBytes, OCR_ENGINE, readGrantedFile } from './extract.js'
import { isExcluded } from './exclusions.js'
import { INDEX_BATCH } from './indexer.js'
import { classifyAccessError, settingsLink } from './os-access.js'
import { classifyFileAsk, grantAllowed, namedTarget, permissionQuestion, planAccess, suggestedFolders } from './permissions.js'
import { INDEX_TIME_NOTE, isPromptFolder, suggestPlaces, type PlacesFs } from './suggestions.js'
import { hashEmbedder, type CodeEmbedder } from '../code/embed.js'
import { composeFileAnswer, composeNameAnswer } from './answer.js'
import { citedFileSources } from '../../../shared/cited-sources.js'
import { embeddingSample, openFileDb, type RankedChunk } from './store.js'
import { createFileSearch } from './service.js'
import { keepGranted, parseMdfind, parseWindowsSearch, searchFileNames, spotlightInvocation, windowsSearchInvocation, windowsSearchScript } from './search-adapters.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/tree-sitter')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// The file index excludes system folders, and macOS os.tmpdir() lives under /var
// (realpathing to /private) — both excluded. Keep fixtures in a plain, non-hidden
// folder inside the package, which is an allowed root.
const TEST_TMP = join(dirname(fileURLToPath(import.meta.url)), '../../../../surf-test-tmp')
mkdirSync(TEST_TMP, { recursive: true })

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('a file outside a grant is not read', async () => {
  let calls = 0
  await assert.rejects(() => readGrantedFile('/tmp/secret.txt', {
    style: 'posix',
    roots: [],
    read: async () => { calls += 1; return Buffer.from('nope') },
  }))
  assert.equal(calls, 0)
})

test('the opened project root can be named as an allowed root', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-read-'))
  const file = join(dir, 'note.txt')
  writeFileSync(file, 'pier 4')
  const bytes = await readGrantedFile(file, { style: 'posix', roots: [dir] })
  assert.equal(bytes.toString(), 'pier 4')
  rmSync(dir, { recursive: true, force: true })
})

test('planning a question does not grant a folder', () => {
  const home = '/Users/me'
  const suggestions = suggestedFolders(home, 'posix')
  const ask = classifyFileAsk('find my resume')
  assert.ok(ask)
  const plan = planAccess(ask, [], suggestions, home, 'posix')
  assert.equal(plan.action, 'ask')
  assert.equal(plan.text, permissionQuestion('a folder you choose'))
  assert.equal(plan.specific, false)
  assert.equal(plan.path, '')
  assert.equal(plan.roots.length, 0)
})

test('revoke deletes the index and leaves the file on disk', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-revoke-'))
  const home = dir
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  const file = join(docs, 'resume.txt')
  writeFileSync(file, 'Kabir Sharma resume for a marine engineer role.')
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
  })
  try {
    const grant = await search.grant(docs, 'always')
    assert.ok(search.chunks(grant.id) > 0)
    const found = await search.answerQuestion('find my resume', 'm1')
    assert.equal(found.kind, 'answer')
    if (found.kind === 'answer') assert.match(found.answer.citations[0]?.filePath ?? '', /resume\.txt/)
    search.revoke(grant.id)
    assert.equal(search.chunks(grant.id), 0)
    assert.equal(search.list().length, 0)
    assert.equal(readFileSync(file, 'utf8').includes('Kabir Sharma'), true)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an allow-once grant is dropped when the index opens again', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-once-'))
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume')
  const dbPath = join(dir, 'index.sqlite')
  const first = createFileSearch({ dbPath, keyHex: null, home: dir, platform: 'linux', watch: () => ({ close() {} }), sleep: async () => undefined })
  await first.grant(docs, 'once')
  assert.equal(first.list().length, 1)
  first.close()
  const second = createFileSearch({ dbPath, keyHex: null, home: dir, platform: 'linux', watch: () => ({ close() {} }), sleep: async () => undefined })
  try {
    assert.equal(second.list().length, 0)
    assert.equal(second.chunks(), 0)
  } finally {
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exclusions skip system, hidden, dependency, bundle, and secret paths', () => {
  const samples: [string, 'posix' | 'win32'][] = [
    ['/System/Library/CoreServices', 'posix'],
    ['/usr/bin/ruby', 'posix'],
    ['/Users/me/Library/Keychains/login.keychain-db', 'posix'],
    ['/Users/me/Documents/node_modules/left-pad/index.js', 'posix'],
    ['/Users/me/Documents/app/.git/config', 'posix'],
    ['/Users/me/Documents/Apps/Mail.app/Contents/Info.plist', 'posix'],
    ['/Users/me/Documents/.ssh/id_rsa', 'posix'],
    ['/Users/me/Documents/project/.env', 'posix'],
    ['/Users/me/Documents/secrets/login.pem', 'posix'],
    ['/Users/me/Documents/vault.kdbx', 'posix'],
    ['C:/Windows/System32/config', 'win32'],
    ['C:/Users/me/AppData/Local/Google/Chrome/User Data/Default/Login Data', 'win32'],
    ['C:/Users/me/Documents/notes.txt', 'posix'],
  ]
  for (const [file, style] of samples.slice(0, 12)) assert.equal(isExcluded(file, style), true, file)
  assert.equal(isExcluded('/Users/me/Documents/notes.txt', 'posix'), false)
  assert.equal(isExcluded('/Users/me/Documents/.env.example', 'posix'), false)
  assert.equal(grantAllowed('/usr', 'posix').ok, false)
})

test('macOS and Windows denials explain the block and link to settings', () => {
  const mac = classifyAccessError(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }), '/Users/me/Desktop/resume.txt', 'darwin')
  assert.equal(mac?.kind, 'macos-files-and-folders')
  assert.match(mac?.message ?? '', /Files and Folders/)
  assert.equal(mac?.settingsUrl, settingsLink('macos-files-and-folders'))
  const disk = classifyAccessError(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }), '/Users/me/secret.txt', 'darwin')
  assert.equal(disk?.kind, 'macos-full-disk')
  assert.match(disk?.message ?? '', /Full Disk Access/)
  const acl = classifyAccessError(Object.assign(new Error('access is denied'), { code: 'EACCES' }), 'C:\\Users\\me\\Documents', 'win32')
  assert.equal(acl?.kind, 'windows-acl')
  assert.match(acl?.message ?? '', /Windows denied/)
  const cfa = classifyAccessError(new Error('Controlled folder access blocked the write'), 'C:\\Users\\me\\Documents', 'win32')
  assert.equal(cfa?.kind, 'windows-controlled-folder')
  assert.equal(cfa?.settingsUrl, 'ms-settings:windowsdefender')
})

test('Spotlight and Windows Search adapters are used, and the walker is the fallback', async () => {
  const root = '/Users/me/Downloads'
  const spot = spotlightInvocation('gst', root)
  assert.equal(spot.command, 'mdfind')
  assert.ok(spot.args.includes('-onlyin'))
  assert.ok(spot.args.includes(root))
  const script = windowsSearchScript('gst', ['C:\\Users\\me\\Downloads'])
  assert.match(script, /System\.Data\.OleDb/)
  assert.match(script, /SystemIndex/)
  assert.match(script, /Search\.CollatorDSO/)
  const winCall = windowsSearchInvocation(script)
  assert.equal(winCall.command, 'powershell.exe')
  assert.equal(winCall.args[0], '-NoProfile')
  const spotlight = await searchFileNames({
    query: 'resume',
    roots: [root],
    style: 'posix',
    platform: 'darwin',
    spotlight: true,
    windowsSearch: false,
    run: async (command, args) => {
      assert.equal(command, 'mdfind')
      assert.ok(args.includes('-onlyin'))
      return { code: 0, stdout: `${root}/resume.pdf\n${root}/.env\n`, stderr: '' }
    },
  })
  assert.equal(spotlight.engine, 'spotlight')
  assert.deepEqual(spotlight.hits.map((hit) => hit.name), ['resume.pdf'])
  assert.equal(keepGranted(parseMdfind(`${root}/.env`), [root], 'posix').length, 0)
  const windows = await searchFileNames({
    query: 'gst',
    roots: ['C:\\Users\\me\\Downloads'],
    style: 'win32',
    platform: 'win32',
    spotlight: false,
    windowsSearch: true,
    run: async () => ({
      code: 0,
      stdout: '{"path":"C:\\\\Users\\\\me\\\\Downloads\\\\gst-return.pdf","name":"gst-return.pdf","size":12,"mtimeMs":0}\n',
      stderr: '',
    }),
  })
  assert.equal(windows.engine, 'windows')
  assert.equal(windows.hits[0]?.name, 'gst-return.pdf')
  assert.equal(parseWindowsSearch('not json').length, 0)
  const dir = mkdtempSync(join(TEST_TMP, 'surf-walk-'))
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'node_modules', 'secret.txt'), 'hidden package')
  writeFileSync(join(dir, '.env'), 'SUPER_SECRET_TOKEN')
  writeFileSync(join(dir, 'resume.txt'), 'resume')
  const walked = await searchFileNames({
    query: 'resume',
    roots: [dir],
    style: 'posix',
    platform: 'darwin',
    spotlight: true,
    windowsSearch: false,
    run: async () => { throw new Error('mdfind missing') },
  })
  assert.equal(walked.engine, 'walker')
  assert.deepEqual(walked.hits.map((hit) => hit.name), ['resume.txt'])
  rmSync(dir, { recursive: true, force: true })
})

test('text, code, pdf, docx, pptx, xlsx, csv, and images extract', async () => {
  assert.equal(OCR_ENGINE, 'tesseract.js')
  const opts = { style: 'posix' as const, roots: ['/tmp'], grammarDir, ocr: async () => 'Receipt total 240 rupees' }
  const text = await extractBytes('notes.md', Buffer.from('# Harbor\nThe harbor ferry leaves Pier 4.'), opts)
  assert.match(text.map((block) => block.text).join('\n'), /Pier 4/)
  const code = await extractBytes('billing.ts', Buffer.from('export function chargeRazorpay(key: string) {\n  return key\n}\n'), opts)
  assert.match(code.map((block) => `${block.heading ?? ''} ${block.text}`).join('\n'), /chargeRazorpay/)
  const pdf = await extractBytes('gst.pdf', makePdf(['This PDF is the GST return. Output tax 18400 rupees.']), opts)
  assert.match(pdf.map((block) => block.text).join('\n'), /18400/)
  const docx = await extractBytes('invoice.docx', await makeDocx([{ text: 'Invoice INV-441 is due on 18 April 2026.' }]), opts)
  assert.match(docx.map((block) => block.text).join('\n'), /INV-441/)
  const pptx = await extractBytes('brief.pptx', await makePptx([['Tide window', 'High water at 14:10']]), opts)
  assert.match(pptx.map((block) => block.text).join('\n'), /14:10/)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['sku', 'qty'], ['ropes', '40']]), 'stock')
  const xlsx = await extractBytes('stock.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer, opts)
  assert.match(xlsx.map((block) => block.text).join('\n'), /ropes/)
  const csv = await extractBytes('stock.csv', Buffer.from('sku,qty\nlamp,7\n'), opts)
  assert.match(csv.map((block) => block.text).join('\n'), /lamp/)
  const image = await extractBytes('receipt.png', png, opts)
  assert.match(image[0]?.text ?? '', /240 rupees/)
})

test('answers cite the file path', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-cite-'))
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume. Marine engineer in Mumbai.')
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
  })
  try {
    await search.grant(docs, 'always')
    const turn = await search.answerQuestion('find my resume', 'm-cite')
    assert.equal(turn.kind, 'answer')
    if (turn.kind !== 'answer') return
    assert.match(turn.answer.text, /Kabir Sharma/)
    assert.match(turn.answer.text, /\[S1\]/)
    assert.doesNotMatch(turn.answer.text, /\[S\d+\]\s+~/)
    assert.equal(turn.answer.citations.length, citedFileSources(turn.answer.text, turn.answer.citations).length)
    assert.match(turn.answer.citations[0]?.filePath ?? '', /resume\.txt/)
    assert.equal(turn.answer.citations[0]?.fileName, 'resume.txt')
    assert.match(turn.answer.citations[0]?.title ?? '', /resume\.txt/)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('indexing pauses between batches and a watch refreshes one file', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-batch-'))
  const folder = join(dir, 'Downloads')
  mkdirSync(folder)
  for (let i = 0; i < INDEX_BATCH + 1; i++) writeFileSync(join(folder, `note-${i}.txt`), `note number ${i} about ferries`)
  let sleeps = 0
  const watchBox: { fire: (() => void) | null } = { fire: null }
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    debounceMs: 0,
    sleep: async () => { sleeps += 1 },
    watch: (_root, onChange) => {
      watchBox.fire = onChange
      return { close() {} }
    },
  })
  try {
    const grant = await search.grant(folder, 'always')
    assert.equal(grant.fileCount, INDEX_BATCH + 1)
    assert.equal(grant.indexedCount, INDEX_BATCH + 1)
    assert.ok(sleeps >= 1)
    const changed = join(folder, 'note-0.txt')
    writeFileSync(changed, 'note number 0 now mentions the razorpay ledger')
    const stamped = statSync(changed)
    const bumped = stamped.mtimeMs + 5000
    const { utimesSync } = await import('node:fs')
    utimesSync(changed, bumped / 1000, bumped / 1000)
    assert.ok(watchBox.fire)
    watchBox.fire()
    await new Promise((resolve) => setTimeout(resolve, 30))
    const again = await search.answerQuestion('which file has the razorpay ledger', 'm-watch')
    assert.equal(again.kind, 'answer')
    if (again.kind === 'answer') assert.match(again.answer.text, /razorpay ledger/)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('file question eval over a fixture folder', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-eval-'))
  const docs = join(dir, 'Documents')
  const downloads = join(dir, 'Downloads')
  mkdirSync(docs)
  mkdirSync(join(downloads, 'node_modules'), { recursive: true })
  mkdirSync(join(downloads, '.ssh'))
  mkdirSync(join(downloads, '.git'))
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume. Marine engineer. Based in Mumbai.')
  writeFileSync(join(docs, 'notes.md'), '# Harbor note\nThe harbor ferry leaves Pier 4 at 06:40.')
  writeFileSync(join(downloads, 'gst-return.pdf'), makePdf(['This PDF is the GST return for FY 2025-26. Output tax 18400 rupees.']))
  writeFileSync(join(downloads, 'gst-notes.txt'), 'GST notes: input tax credit is 3200 rupees for the April return.')
  writeFileSync(join(downloads, 'razorpay-setup.md'), '# Razorpay key setup\nThe Razorpay key setup uses key_id from the dashboard.')
  writeFileSync(join(downloads, 'invoice.docx'), await makeDocx([{ text: 'Invoice INV-441 is due on 18 April 2026 for 408.50 USD.' }]))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['sku', 'qty'], ['ropes', '40']]), 'stock')
  writeFileSync(join(downloads, 'stock.xlsx'), XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  writeFileSync(join(downloads, 'stock.csv'), 'sku,qty\nlamp,7\n')
  writeFileSync(join(downloads, 'brief.pptx'), await makePptx([['Tide window', 'High water at 14:10']]))
  writeFileSync(join(downloads, 'billing.ts'), 'export function chargeRazorpay(key: string) {\n  return key\n}\n')
  writeFileSync(join(downloads, 'receipt.png'), png)
  writeFileSync(join(downloads, '.env'), 'SUPER_SECRET_TOKEN=do-not-index')
  writeFileSync(join(downloads, 'node_modules', 'secret.txt'), 'node_modules secret should not be indexed')
  writeFileSync(join(downloads, '.ssh', 'id_rsa'), 'private key material')
  writeFileSync(join(downloads, '.git', 'config'), 'git secret')
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    grammarDir,
    ocr: async () => 'Receipt total 240 rupees',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
  })
  const cases: { q: string; file?: string; phrase?: string; refuse?: boolean }[] = [
    { q: 'find my resume', file: 'resume.txt' },
    { q: 'summarise the PDF in Downloads about GST', file: 'gst-return.pdf' },
    { q: 'which file has the Razorpay key setup', file: 'razorpay-setup.md' },
    { q: 'what is invoice INV-441', file: 'invoice.docx' },
    { q: 'how many ropes are in the stock spreadsheet', file: 'stock.xlsx' },
    { q: 'what time is high water on the slides', file: 'brief.pptx' },
    { q: 'which file defines chargeRazorpay', file: 'billing.ts' },
    { q: 'what does the receipt image say', file: 'receipt.png', phrase: '240' },
    { q: 'where are the GST notes', file: 'gst-notes.txt' },
    { q: 'what sku is listed in stock.csv', file: 'stock.csv' },
    { q: 'what does the harbor note say', file: 'notes.md' },
    { q: 'what is the password in the .env file', refuse: true },
  ]
  const logs: string[] = []
  const info = console.info
  console.info = (...args: unknown[]) => {
    logs.push(args.map((part) => String(part)).join(' '))
    info.apply(console, args)
  }
  try {
    await search.grant(docs, 'always')
    await search.grant(downloads, 'always')
    const rates = logs.flatMap((line) => {
      const match = /\[surf\] file index files=\d+ perSec=([0-9.]+)/.exec(line)
      return match?.[1] ? [Number(match[1])] : []
    })
    assert.ok(rates.length >= 1)
    assert.ok(rates.every((rate) => rate > 0))
    assert.ok((search.limits().filesPerSec ?? 0) > 0)
    console.info(`file-search fixture throughput ${search.limits().filesPerSec} files/sec`)
    const asked = await search.answerQuestion('find my resume in a folder I have not opened', 'no-grant')
    assert.notEqual(asked.kind, 'skip')
    let passed = 0
    const misses: string[] = []
    for (const [index, item] of cases.entries()) {
      const turn = await search.answerQuestion(item.q, `eval-${index}`)
      const ok = turn.kind === 'answer' && (item.refuse
        ? turn.answer.citations.length === 0 && /will not read/i.test(turn.answer.text) && !/SUPER_SECRET_TOKEN/.test(turn.answer.text)
        : (turn.answer.citations[0]?.filePath ?? '').includes(item.file ?? '') && (!item.phrase || turn.answer.text.includes(item.phrase)))
      if (ok) passed += 1
      else misses.push(`${item.q} => ${turn.kind === 'answer' ? turn.answer.citations[0]?.filePath ?? turn.answer.text.slice(0, 80) : turn.kind}`)
    }
    const rate = passed / cases.length
    console.info(`file-search eval ${passed}/${cases.length} passed (${Math.round(rate * 100)}%)`)
    if (misses.length) console.info(misses.join('\n'))
    assert.equal(rate, 1, misses.join('\n'))
    const db = openFileDb(join(dir, 'index.sqlite'), null)
    const blob = (db.prepare('SELECT text FROM chunks').all() as { text: string }[]).map((row) => row.text).join('\n')
    db.close()
    assert.equal(blob.includes('SUPER_SECRET_TOKEN'), false)
    assert.equal(blob.includes('node_modules secret'), false)
    assert.equal(blob.includes('private key material'), false)
  } finally {
    console.info = info
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('file answers lead with the passage and cite only markers that appear', () => {
  const home = '/Users/me'
  const hit = (name: string, path: string, text: string): RankedChunk => ({
    id: 1, path, name, heading: null, locator: null, text, cosine: 1, rrf: 1,
  })
  const one = composeFileAnswer('find my resume', [
    hit('resume.txt', '/Users/me/Documents/resume.txt', 'Kabir Sharma resume. Marine engineer.'),
    hit('notes.md', '/Users/me/Documents/notes.md', 'Harbor ferry notes.'),
  ], home, 'posix')
  assert.match(one.text, /^Kabir Sharma resume/)
  assert.match(one.text, /\[S1\]/)
  assert.doesNotMatch(one.text, /\[S2\]/)
  assert.doesNotMatch(one.text, /\[S\d+\]\s+~\//)
  assert.equal(one.citations.length, 1)
  assert.equal(one.citations[0]?.fileName, 'resume.txt')
  assert.equal(citedFileSources(one.text, one.citations).length, 1)
  assert.equal(citedFileSources(one.text, [...one.citations, { ...one.citations[0], filePath: '/unused' }]).length, 1)

  const both = composeFileAnswer('summarise the notes', [
    hit('gst-return.pdf', '/Users/me/Downloads/gst-return.pdf', '# GST return\nOutput tax 18400 rupees.'),
    hit('gst-notes.txt', '/Users/me/Downloads/gst-notes.txt', 'Input tax credit is 3200.'),
  ], home, 'posix')
  assert.match(both.text, /18400/)
  assert.match(both.text, /\[S1\]/)
  assert.match(both.text, /\[S2\]/)
  assert.equal(both.text.startsWith('#'), false)
  assert.doesNotMatch(both.text, /\[S\d+\]\s+\//)
  assert.equal(both.citations.length, 2)
  assert.deepEqual(both.citations.map((item) => item.fileName), ['gst-return.pdf', 'gst-notes.txt'])

  const named = composeNameAnswer([{ name: 'resume.txt', path: '/Users/me/Documents/resume.txt' }], home, 'posix')
  assert.match(named.text, /resume\.txt matches that name\. \[S1\]/)
  assert.doesNotMatch(named.text, /\[S1\]\s+~/)
  assert.equal(named.citations.length, 1)
})

test('hash embedder is temporary until Jina code embeddings is installed', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-embed-'))
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume')
  let gemma = 0
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
    tryGemma: async () => { gemma += 1; return null },
  })
  try {
    await search.grant(docs, 'always')
    assert.ok(gemma >= 1)
    assert.equal(search.list()[0]?.embedder, 'hash')
    const vectors = hashEmbedder()
    assert.equal(vectors.dim, 256)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Jina code embeddings re-embeds a fallback folder and a failed pass leaves the old vectors', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-reembed-'))
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume. Marine engineer in Mumbai.')
  writeFileSync(join(docs, 'notes.md'), 'The harbor ferry leaves Pier 4 at 06:40.')
  const dbPath = join(dir, 'index.sqlite')
  let current: CodeEmbedder | null = null
  const phases: string[] = []
  const search = createFileSearch({
    dbPath,
    keyHex: null,
    home: dir,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
    tryGemma: async () => current,
    onProgress: (progress) => {
      if (progress.phase === 'embed') phases.push(`${progress.status}:${progress.done}/${progress.total}`)
    },
  })
  const sample = () => {
    const id = search.list()[0]?.id
    if (!id) return null
    const db = openFileDb(dbPath, null)
    try { return embeddingSample(db, id) } finally { db.close() }
  }
  try {
    await search.grant(docs, 'always')
    assert.equal(search.list()[0]?.embedder, 'hash')
    const before = sample()
    assert.notEqual(before, 0.5)
    let calls = 0
    current = {
      dim: 256,
      embedDocs: async (rows) => {
        calls += 1
        if (calls > 1) throw new Error('stopped')
        return rows.map(() => {
          const vector = new Float32Array(256)
          vector[0] = 0.5
          return vector
        })
      },
      embedQueries: async (queries) => queries.map(() => new Float32Array(256)),
    }
    await search.upgradeEmbeddings()
    assert.equal(search.list()[0]?.embedder, 'hash')
    assert.notEqual(sample(), 0.5)
    current = constantEmbedder(0.5)
    await search.upgradeEmbeddings()
    assert.equal(search.list()[0]?.embedder, 'gemma')
    assert.equal(sample(), 0.5)
    assert.ok(phases.some((item) => item.startsWith('indexing:')))
    assert.ok(phases.some((item) => item.startsWith('ready:')))
    const found = await search.answerQuestion('find my resume', 'after-gemma')
    assert.equal(found.kind, 'answer')
    if (found.kind === 'answer') assert.match(found.answer.citations[0]?.filePath ?? '', /resume\.txt/)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suggestions rank home folders from metadata and skip protected prompts', () => {
  const calls: string[] = []
  const dirs: Record<string, string[]> = {
    '/Users/me': ['Desktop', 'Documents', 'Downloads', 'Projects', 'OneDrive', 'Library', '.hidden', 'notes.txt', 'iCloud Drive'],
    '/Users/me/Projects': ['a.txt', 'b.txt', 'src'],
    '/Users/me/Projects/src': ['c.txt'],
    '/Users/me/OneDrive': ['d.txt'],
    '/Users/me/iCloud Drive': ['secret.txt'],
    '/Volumes': ['Macintosh HD', 'Backup'],
    '/Volumes/Backup': ['disk.txt'],
  }
  const files: Record<string, number> = {
    '/Users/me/notes.txt': 4,
    '/Users/me/Projects/a.txt': 10,
    '/Users/me/Projects/b.txt': 30,
    '/Users/me/Projects/src/c.txt': 5,
    '/Users/me/OneDrive/d.txt': 8,
    '/Users/me/iCloud Drive/secret.txt': 9,
    '/Volumes/Backup/disk.txt': 100,
  }
  const fs: PlacesFs = {
    list(dir) {
      calls.push(`list ${dir}`)
      return dirs[dir] ?? 'denied'
    },
    stat(file) {
      calls.push(`stat ${file}`)
      if (dirs[file]) return { isDirectory: true, size: 0 }
      if (file in files) return { isDirectory: false, size: files[file] ?? 0 }
      return 'missing'
    },
  }
  const places = suggestPlaces({ home: '/Users/me', style: 'posix', platform: 'darwin', fs })
  const touched = calls.join('\n')
  assert.equal(touched.includes('/Users/me/Desktop'), false)
  assert.equal(touched.includes('/Users/me/Documents'), false)
  assert.equal(touched.includes('/Users/me/Downloads'), false)
  assert.equal(touched.includes('/Users/me/Library'), false)
  assert.equal(touched.includes('iCloud Drive'), false)
  assert.equal(touched.includes('/Volumes/Backup'), false)
  assert.equal(isPromptFolder('/Users/me/Desktop', '/Users/me', 'posix', 'darwin'), true)
  assert.equal(isPromptFolder('/Users/me/Projects', '/Users/me', 'posix', 'linux'), false)
  const projects = places.find((place) => place.label === '~/Projects')
  const drive = places.find((place) => place.label === '~/OneDrive')
  assert.equal(projects?.kind, 'common')
  assert.equal(projects?.fileCount, 3)
  assert.equal(projects?.byteSize, 45)
  assert.equal(drive?.kind, 'common')
  assert.ok((projects?.fileCount ?? 0) > (drive?.fileCount ?? 0))
  assert.ok(places.findIndex((place) => place.id === 'folder-projects' || place.label === '~/Projects') < places.findIndex((place) => place.label === '~/OneDrive'))
  assert.equal(places.find((place) => place.label === '~/Desktop')?.needsPermission, true)
  assert.equal(places.find((place) => place.label === '~/Desktop')?.fileCount, null)
  assert.equal(places.find((place) => place.label === 'Backup')?.needsPermission, true)
  assert.equal(places.find((place) => place.label === 'Backup')?.note, INDEX_TIME_NOTE)
  const home = places[places.length - 1]
  assert.equal(home?.kind, 'home')
  assert.equal(home?.note, INDEX_TIME_NOTE)
  assert.equal(places.some((place) => place.label === '~/Library'), false)
})

test('windows suggestions include other drives and keep the home folder note', () => {
  const key = (file: string) => file.replace(/\\/g, '/')
  const dirs: Record<string, string[]> = {
    'C:/Users/me': ['Projects', 'Documents'],
    'C:/Users/me/Projects': ['a.txt'],
    'C:/Users/me/Documents': ['b.txt'],
    'D:/': ['Work'],
    'D:/Work': ['c.txt'],
    'E:/': [],
  }
  const files: Record<string, number> = {
    'C:/Users/me/Projects/a.txt': 3,
    'C:/Users/me/Documents/b.txt': 4,
    'D:/Work/c.txt': 9,
  }
  const fs: PlacesFs = {
    list: (dir) => dirs[key(dir)] ?? 'denied',
    stat: (file) => {
      const path = key(file)
      if (dirs[path]) return { isDirectory: true, size: 0 }
      if (path in files) return { isDirectory: false, size: files[path] ?? 0 }
      return 'missing'
    },
  }
  const places = suggestPlaces({ home: 'C:\\Users\\me', style: 'win32', platform: 'win32', fs })
  const labels = places.map((place) => place.label)
  assert.ok(labels.includes('D:'))
  assert.ok(labels.includes('E:'))
  assert.equal(labels.includes('C:'), false)
  assert.equal(places.find((place) => place.label === 'D:')?.note, INDEX_TIME_NOTE)
  assert.equal(places.find((place) => place.kind === 'home')?.note, INDEX_TIME_NOTE)
  assert.equal(places.find((place) => place.label === '~/Projects')?.kind, 'common')
})

test('a named folder is offered on its own and a file path becomes that folder', () => {
  const home = '/Users/me'
  const projects = classifyFileAsk('find the resume in Projects')
  assert.ok(projects)
  const plan = planAccess(projects, [], [], home, 'posix')
  assert.equal(plan.action, 'ask')
  assert.equal(plan.specific, true)
  assert.equal(plan.path, '/Users/me/Projects')
  assert.equal(plan.text, permissionQuestion('~/Projects'))
  assert.equal(plan.note, null)
  const file = namedTarget('open ~/Projects/resume.txt', home, 'posix')
  assert.equal(file?.path, '/Users/me/Projects')
  const homePlan = planAccess(classifyFileAsk('find my resume in my home folder')!, [], [], home, 'posix')
  assert.equal(homePlan.specific, true)
  assert.equal(homePlan.path, home)
  assert.equal(homePlan.note, INDEX_TIME_NOTE)
  const drive = namedTarget('search D:\\ for the invoice pdf', 'C:\\Users\\me', 'win32')
  assert.equal(drive?.broad, true)
  assert.equal(drive?.label, 'D:')
})

test('indexing can pause and resume, and limits cap files and types', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-pause-'))
  const folder = join(dir, 'Projects')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.txt'), 'alpha ferry note')
  writeFileSync(join(folder, 'b.txt'), 'beta ferry note')
  writeFileSync(join(folder, 'c.md'), 'markdown should stay out')
  writeFileSync(join(folder, 'd.txt'), 'delta ferry note')
  let hold = true
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    debounceMs: 0,
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
    onProgress: (progress) => {
      if (hold && progress.status === 'indexing' && progress.done >= 1) {
        hold = false
        search.pause(progress.grantId)
      }
    },
  })
  try {
    search.setLimits({ maxFiles: 2, extensions: 'txt' })
    assert.deepEqual(search.limits().extensions, ['txt'])
    assert.equal(search.limits().maxFiles, 2)
    const grant = await search.grant(folder, 'always')
    assert.equal(grant.status, 'paused')
    assert.ok(grant.indexedCount < grant.fileCount)
    assert.ok(grant.indexedCount >= 1)
    assert.equal(grant.fileCount, 2)
    const resumed = await search.resume(grant.id)
    assert.equal(resumed?.status, 'ready')
    assert.equal(resumed?.indexedCount, 2)
    const missed = await search.answerQuestion('where is the markdown note', 'md')
    assert.equal(missed.kind, 'answer')
    if (missed.kind === 'answer') assert.equal(missed.answer.citations.some((item) => item.filePath?.endsWith('c.md')), false)
    assert.ok((search.limits().filesPerSec ?? 0) > 0)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a question that names an ungranted folder asks for that folder', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-named-'))
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  mkdirSync(join(dir, 'Projects'))
  writeFileSync(join(docs, 'resume.txt'), 'Kabir Sharma resume')
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home: dir,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
  })
  try {
    await search.grant(docs, 'always')
    const turn = await search.answerQuestion('find the resume in Projects', 'named')
    assert.equal(turn.kind, 'ask')
    if (turn.kind === 'ask') {
      assert.equal(turn.prompt.specific, true)
      assert.equal(turn.prompt.path, join(dir, 'Projects'))
      assert.match(turn.prompt.question, /Projects/)
    }
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('granting a home folder still skips Library and secrets', async () => {
  const dir = mkdtempSync(join(TEST_TMP, 'surf-home-'))
  const home = join(dir, 'Users', 'me')
  mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true })
  mkdirSync(join(home, 'Projects'))
  writeFileSync(join(home, 'Library', 'Keychains', 'login.keychain-db'), 'key material')
  writeFileSync(join(home, '.env'), 'SUPER_SECRET_TOKEN=nope')
  writeFileSync(join(home, 'Projects', 'note.txt'), 'The harbor ferry leaves Pier 4.')
  const search = createFileSearch({
    dbPath: join(dir, 'index.sqlite'),
    keyHex: null,
    home,
    platform: 'linux',
    watch: () => ({ close() {} }),
    sleep: async () => undefined,
  })
  try {
    await search.grant(home, 'always')
    const db = openFileDb(join(dir, 'index.sqlite'), null)
    const blob = (db.prepare('SELECT text FROM chunks').all() as { text: string }[]).map((row) => row.text).join('\n')
    db.close()
    assert.match(blob, /Pier 4/)
    assert.equal(blob.includes('key material'), false)
    assert.equal(blob.includes('SUPER_SECRET_TOKEN'), false)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function constantEmbedder(sample: number): CodeEmbedder {
  const vector = () => {
    const out = new Float32Array(256)
    out[0] = sample
    return out
  }
  return {
    dim: 256,
    embedDocs: async (docs) => docs.map(() => vector()),
    embedQueries: async (queries) => queries.map(() => vector()),
  }
}
