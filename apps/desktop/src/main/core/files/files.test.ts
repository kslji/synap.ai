import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { makeDocx, makePdf, makePptx } from '../samples.js'
import { extractBytes, OCR_ENGINE, readGrantedFile } from './extract.js'
import { isExcluded } from './exclusions.js'
import { INDEX_BATCH } from './indexer.js'
import { classifyAccessError, settingsLink } from './os-access.js'
import { classifyFileAsk, grantAllowed, permissionQuestion, planAccess, suggestedFolders } from './permissions.js'
import { hashEmbedder } from '../code/embed.js'
import { openFileDb } from './store.js'
import { createFileSearch } from './service.js'
import { keepGranted, parseMdfind, parseWindowsSearch, searchFileNames, spotlightInvocation, windowsSearchInvocation, windowsSearchScript } from './search-adapters.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/tree-sitter')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

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
  const dir = mkdtempSync(join(tmpdir(), 'surf-read-'))
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
  assert.equal(plan.text, permissionQuestion('~/Documents'))
  assert.equal(plan.roots.length, 0)
})

test('revoke deletes the index and leaves the file on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-revoke-'))
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
  const dir = mkdtempSync(join(tmpdir(), 'surf-once-'))
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
  const dir = mkdtempSync(join(tmpdir(), 'surf-walk-'))
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
  const dir = mkdtempSync(join(tmpdir(), 'surf-cite-'))
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
    assert.match(turn.answer.text, /\[S1\]/)
    assert.match(turn.answer.citations[0]?.filePath ?? '', /resume\.txt/)
    assert.match(turn.answer.citations[0]?.title ?? '', /resume\.txt/)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('indexing pauses between batches and a watch refreshes one file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-batch-'))
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
  const dir = mkdtempSync(join(tmpdir(), 'surf-eval-'))
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
  try {
    await search.grant(docs, 'always')
    await search.grant(downloads, 'always')
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
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hash embedder is what the index uses until EmbeddingGemma is installed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-embed-'))
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
    const vectors = hashEmbedder()
    assert.equal(vectors.dim, 256)
  } finally {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
