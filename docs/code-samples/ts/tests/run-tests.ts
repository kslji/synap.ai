/**
 * Runs the samples against real binaries/models where available (plain Node 22, no Electron needed):
 *   npx tsx tests/run-tests.ts
 * Env (optional): LLAMA_BIN, CHAT_GGUF, MMPROJ_GGUF, EMBED_GGUF, PACK_DIR, TEST_IMAGE
 * Tests needing a missing file are SKIPPED, not failed.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Calculator, calculatorTools } from '../calculator.js';
import { openUserDb, openPackDb, migrate } from '../db.js';
import { verifyPack, compareVersions } from '../pack-verify.js';
import { hybridSearch, ftsQuery } from '../retrieval.js';
import { LlamaServer } from '../sidecar-manager.js';
import { LlamaClient, imageMessage } from '../llama-client.js';
import { Embedder, EMBEDDINGGEMMA2_256, formatDoc, formatQuery, truncateNormalize } from '../embedding.js';
import { parseRegistry, pick } from '../model-registry.js';
import { detectHardware, tierFor } from '../hardware.js';
import { downloadVerified } from '../model-download.js';
import { LlamaServerTokenizer, HfTokenizer, heuristicCounter, allocate, BUDGETS, formatReport, PER_MESSAGE_OVERHEAD } from '../token-budget.js';

const results: [string, 'PASS' | 'FAIL' | 'SKIP', string][] = [];
async function test(name: string, fn: () => Promise<string | void>, skipIf?: string | false) {
  if (skipIf) { results.push([name, 'SKIP', skipIf]); return; }
  const t0 = Date.now();
  try { const note = (await fn()) ?? ''; results.push([name, 'PASS', `${note} (${Date.now() - t0} ms)`]); }
  catch (e) { results.push([name, 'FAIL', (e as Error).stack ?? String(e)]); }
}
const env = (k: string) => process.env[k] ?? '';
const tmp = mkdtempSync(join(tmpdir(), 'harbor-'));

await test('calculator: arithmetic, units, blocked functions, timeout', async () => {
  const calc = new Calculator(new URL('../calculator.worker.ts', import.meta.url), ['--import', 'tsx']);
  assert.equal((await calc.calc('(12.5*3)/7')).ok, true);
  const r = await calc.calc('sqrt(2)^2 + 0.1 + 0.2');
  assert.ok(r.ok && Math.abs((r.value ?? 0) - 2.3) < 1e-9, JSON.stringify(r));
  const k = await calc.convert(12, 'knot', 'km/h');
  assert.ok(k.ok && Math.abs((k.value ?? 0) - 22.224) < 1e-6, JSON.stringify(k));
  const f = await calc.convert(350, 'degF', 'degC');
  assert.ok(f.ok && Math.abs((f.value ?? 0) - 176.6667) < 1e-3, JSON.stringify(f));
  for (const evil of ['import({x:1})', 'evaluate("1+1")', 'createUnit("foo")', 'parse("1")', 'simplify("x+x")', 'constructor', '[].constructor.constructor("return process")()']) {
    const e = await calc.calc(evil);
    assert.equal(e.ok, false, `should block: ${evil} -> ${JSON.stringify(e)}`);
  }
  const big = await calc.calc('x'.repeat(600));
  assert.equal(big.ok, false);
  const slow = await calc.calc('det(ones(400,400)) + det(ones(400,400)) + det(ones(400,400))');
  const pct = await calc.calc('15% * 2400');
  calc.close();
  return `slow-expr -> ${slow.ok ? 'finished' : (slow as { error: string }).error}; "15% * 2400" -> ${pct.ok ? pct.result : (pct as { error: string }).error}`;
});

await test('model registry: schema, licences, tier picks', async () => {
  const reg = parseRegistry(JSON.parse(readFileSync(new URL('../models.registry.json', import.meta.url), 'utf8')));
  assert.equal(pick(reg, 'chat', 0).id, 'qwen3.5-2b-q4_k_m');
  assert.equal(pick(reg, 'chat', 1).id, 'qwen3.5-4b-q4_k_m');
  assert.equal(pick(reg, 'chat', 2).id, 'qwen3.5-9b-q4_k_m');
  const emb = pick(reg, 'embedding', 1);
  assert.equal(emb.id, 'embeddinggemma-2-text-q8_0');
  assert.equal(emb.spec_id, EMBEDDINGGEMMA2_256.id); assert.equal(emb.dim, EMBEDDINGGEMMA2_256.dim);
  assert.equal(emb.query_prefix, EMBEDDINGGEMMA2_256.queryPrefix); assert.equal(emb.doc_template, EMBEDDINGGEMMA2_256.docTemplate);
  assert.equal(tierFor(7.7, 0, false), 1);
  assert.equal(tierFor(15.6, 0, true), 2);
  assert.equal(tierFor(5.8, 0, false), 0);
  const hw = await detectHardware();
  return `this box: ${hw.totalRamGb} GB RAM, ${hw.physicalCores} cores, ${hw.gpus.length} GPU(s) -> tier ${hw.tier}`;
});

await test('user db: SQLCipher mode + sqlite-vec + FTS5 + migrations + wrong key', async () => {
  const p = join(tmp, 'user.db');
  const key = 'a'.repeat(64);
  const m1 = `CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);
    CREATE VIRTUAL TABLE notes_fts USING fts5(body, content='notes', content_rowid='id');
    CREATE VIRTUAL TABLE notes_vec USING vec0(id INTEGER PRIMARY KEY, embedding float[4]);`;
  const db = openUserDb(p, key, [m1]);
  db.prepare('INSERT INTO notes(id, body) VALUES (1, ?)').run('fuel oil purifier maintenance');
  db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
  db.prepare('INSERT INTO notes_vec(id, embedding) VALUES (1, ?)').run(Buffer.from(new Float32Array([1, 0, 0, 0]).buffer));
  const fts = db.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'purifier'").all();
  const vec = db.prepare('SELECT id, distance FROM notes_vec WHERE embedding MATCH ? AND k = 1').all(Buffer.from(new Float32Array([1, 0, 0, 0]).buffer));
  assert.equal(fts.length, 1); assert.equal(vec.length, 1);
  migrate(db, [m1]); // idempotent
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  db.close();
  assert.notEqual(readFileSync(p).subarray(0, 15).toString(), 'SQLite format 3', 'file must be encrypted');
  assert.throws(() => openUserDb(p, 'b'.repeat(64)), /wrong key/);
  let cli = 'sqlcipher CLI not installed';
  try {
    const out = execFileSync('sqlcipher', [p], { input: `PRAGMA key = "x'${key}'";\nSELECT count(*) FROM notes;\n` }).toString().trim();
    assert.match(out, /1$/); cli = 'sqlcipher 4 CLI reads it';
  } catch (e) { if (!(e as NodeJS.ErrnoException).code) throw e; }
  return cli;
});

const packDir = env('PACK_DIR');
await test('pack: Ed25519 manifest verification + tamper detection', async () => {
  const pub = readFileSync(join(packDir, 'signing_pub.hex'), 'utf8').trim();
  const m = await verifyPack(packDir, { trustedKeys: { k2026a: pub }, expectedEmbedding: EMBEDDINGGEMMA2_256 });
  await assert.rejects(verifyPack(packDir, { trustedKeys: { k2026a: pub }, expectedEmbedding: { ...EMBEDDINGGEMMA2_256, dim: 512 } }), /does not match app/);
  await assert.rejects(verifyPack(packDir, { trustedKeys: { k2026a: pub }, expectedEmbedding: EMBEDDINGGEMMA2_256, installedVersion: m.version }), /not newer/);
  await assert.rejects(verifyPack(packDir, { trustedKeys: { k2026a: 'ab'.repeat(32) }, expectedEmbedding: EMBEDDINGGEMMA2_256 }), /bad pack signature|point/);
  const t = mkdtempSync(join(tmp, 'tamper-'));
  for (const f of ['manifest.json', 'manifest.sig', 'pack.sqlite']) copyFileSync(join(packDir, f), join(t, f));
  const body = readFileSync(join(t, 'manifest.json'), 'utf8');
  writeFileSync(join(t, 'manifest.json'), body.replace('"niche": "marine"', '"niche": "evil"'));
  await assert.rejects(verifyPack(t, { trustedKeys: { k2026a: pub }, expectedEmbedding: EMBEDDINGGEMMA2_256 }), /bad pack signature/);
  assert.equal(compareVersions('2026.10.08.10', '2026.10.08.9'), 1);
  return `${m.pack_id}@${m.version}, ${m.files.length} file(s)`;
}, !existsSync(join(packDir, 'signing_pub.hex')) && 'PACK_DIR with signing_pub.hex not set');

const bin = env('LLAMA_BIN'), embedGguf = env('EMBED_GGUF'), chatGguf = env('CHAT_GGUF'), mmproj = env('MMPROJ_GGUF');
let embedSrv: LlamaServer | null = null;
await test('sidecar: llama-server embeddings (EmbeddingGemma 2 @256) + hybrid retrieval on the pack', async () => {
  // unit checks of the spec helpers (no server needed)
  assert.equal(formatQuery(EMBEDDINGGEMMA2_256, ' engine overheats '), 'task: search result | query: engine overheats');
  assert.equal(formatDoc(EMBEDDINGGEMMA2_256, null, 'x'), 'title: none | text: x');
  const tn = truncateNormalize([3, 4, 12], 2); assert.ok(Math.abs(tn[0] - 0.6) < 1e-6 && Math.abs(tn[1] - 0.8) < 1e-6);
  assert.throws(() => truncateNormalize([NaN, 1], 2), /NaN/);
  embedSrv = new LlamaServer({ binPath: bin, modelPath: embedGguf, embeddings: true, pooling: 'mean', ctx: 2048, logFile: join(tmp, 'embed.log') });
  await embedSrv.start();
  const r = await fetch(`${embedSrv.baseUrl}/v1/models`); // no key -> must be rejected
  assert.equal(r.status, 401);
  const client = new LlamaClient({ baseUrl: embedSrv.baseUrl, apiKey: embedSrv.apiKey });
  const embedder = new Embedder(client, EMBEDDINGGEMMA2_256);
  const notes: string[] = [];
  const pack = openPackDb(join(packDir, 'pack.sqlite'));
  const expect = ['answer', 'answer', 'insufficient'];
  const qs = ['When did the SOLAS convention enter into force?', 'convention on dumping of wastes at sea', 'best pizza recipe with pineapple', 'समुद्र में कचरा डंप करने पर कन्वेंशन'];
  for (const [i, q] of qs.entries()) {
    const [qv] = await embedder.embedQueries([q]);
    assert.equal(qv.length, 256);
    const { top, decision } = hybridSearch({ 'marine-core': pack }, q, qv);
    if (expect[i]) assert.equal(decision, expect[i], q);
    notes.push(`"${q}" -> ${decision} (best cos ${Math.max(0, ...top.map((h) => h.cosine)).toFixed(2)}, ${top.length} hits)`);
  }
  assert.equal(ftsQuery('a "b" OR c*'), '""');
  pack.close();
  return notes.join(' | ');
}, !(existsSync(bin) && existsSync(embedGguf) && existsSync(join(packDir, 'pack.sqlite'))) && 'LLAMA_BIN/EMBED_GGUF/PACK_DIR not set');
await (embedSrv as LlamaServer | null)?.stop();

let chatSrv: LlamaServer | null = null;
await test('sidecar: Qwen3.5 chat + tool calling (calculator) + vision via mmproj', async () => {
  chatSrv = new LlamaServer({ binPath: bin, modelPath: chatGguf, mmprojPath: existsSync(mmproj) ? mmproj : undefined, ctx: 8192, logFile: join(tmp, 'chat.log') });
  await chatSrv.start();
  const client = new LlamaClient({ baseUrl: chatSrv.baseUrl, apiKey: chatSrv.apiKey });
  const calc = new Calculator(new URL('../calculator.worker.ts', import.meta.url), ['--import', 'tsx']);
  const t0 = Date.now();
  const res = await client.runWithTools(
    [{ role: 'system', content: 'You are Harbor, a helpful offline assistant. Use tools for arithmetic and unit conversion.' },
     { role: 'user', content: 'A ship burns 23.7 tonnes of fuel per day. How much in 17.5 days? Also convert 14 knots to km/h.' }],
    calculatorTools,
    {
      calculator: async (a) => { const r = await calc.calc(String(a.expression)); return r.ok ? r.result : `error: ${r.error}`; },
      unit_convert: async (a) => { const r = await calc.convert(Number(a.value), String(a.from), String(a.to)); return r.ok ? r.result : `error: ${r.error}`; },
    });
  calc.close();
  assert.ok(res.toolCalls.length >= 1, 'model should call a tool');
  assert.ok(!/<think>/.test(res.answer), 'thinking must be off');
  const toolNote = `tools: ${res.toolCalls.map((c) => `${c.function.name}(${c.function.arguments})`).join(', ')}; answer: ${res.answer.replace(/\s+/g, ' ').slice(0, 160)} [${Date.now() - t0} ms]`;
  let visionNote = 'vision skipped (no TEST_IMAGE/mmproj)';
  const img = env('TEST_IMAGE');
  if (existsSync(mmproj) && existsSync(img)) {
    const t1 = Date.now();
    const v = await client.chat([imageMessage('What is shown in this image? One sentence.', readFileSync(img), 'image/png')], undefined, undefined, 120);
    visionNote = `vision: ${String(v.choices[0].message.content).replace(/\s+/g, ' ').slice(0, 160)} [${Date.now() - t1} ms]`;
  }
  return `${toolNote} | ${visionNote}`;
}, !(existsSync(bin) && existsSync(chatGguf)) && 'LLAMA_BIN/CHAT_GGUF not set');

await test('token budget: Qwen3.5 tokenizer (server vs @huggingface/tokenizers), template overhead, allocator', async () => {
  const srv = chatSrv!;
  const exact = new LlamaServerTokenizer(srv.baseUrl, srv.apiKey);
  const hf = await HfTokenizer.load(env('QWEN_TOKENIZER_DIR'));
  const samples = {
    english: 'The main engine lube oil pressure alarm activated at 1.2 bar; check the filter differential pressure and the pump suction strainer.',
    hindi: 'मुख्य इंजन के लुब्रिकेटिंग तेल का दबाव कम है, कृपया फ़िल्टर और पंप की जाँच करें।',
    code: 'const x = await fetch(`${base}/v1/chat/completions`, { method: "POST" });',
  };
  const notes: string[] = [];
  for (const [k, t] of Object.entries(samples)) {
    const [a, b, h] = [await exact.count(t), await hf.count(t), await heuristicCounter.count(t)];
    assert.equal(b, a, `${k}: hf ${b} != server ${a}`);
    notes.push(`${k}: ${a} tok (heuristic ${h})`);
  }
  const one = [{ role: 'user' as const, content: 'hello' }];
  const overhead = (await exact.countChat(one)) - (await exact.count('hello'));
  notes.push(`template overhead 1 msg = ${overhead} tok (const ${PER_MESSAGE_OVERHEAD})`);
  const system = 'You are Harbor, a private offline assistant running on this computer. Be concise and accurate. ' +
    'If sources are given, answer only from them and cite [n]. If you are not sure, say so. Use tools for arithmetic and units.';
  const pack = openPackDb(join(packDir, 'pack.sqlite'));
  const chunks = (pack.prepare('SELECT c.id, c.text, d.title FROM chunks c JOIN documents d ON d.id=c.doc_id LIMIT 8').all() as { id: number; text: string; title: string }[])
    .map((r, i) => ({ id: String(r.id), text: r.text, title: r.title, score: 1 - i / 10 }));
  pack.close();
  const history = Array.from({ length: 6 }, (_, i) => ({ user: `Question ${i} about ballast water rules?`, assistant: `Answer ${i}: `.padEnd(400, 'x ') }));
  const { messages, maxTokens, report } = await allocate(exact, BUDGETS.tier1, { system, tools: calculatorTools, chunks, history,
    historySummary: 'User is a second engineer asking about IMO conventions.', question: 'When did SOLAS 1974 enter into force?' });
  const real = await exact.countChat(messages);
  const promptEst = report.total - maxTokens;
  notes.push(formatReport(report), `allocator prompt est ${promptEst} vs exact template (without tools) ${real}`);
  return notes.join(' | ');
}, !(existsSync(bin) && existsSync(chatGguf) && existsSync(join(env('QWEN_TOKENIZER_DIR'), 'tokenizer.json'))) && 'QWEN_TOKENIZER_DIR not set');
await (chatSrv as LlamaServer | null)?.stop();

await test('model download: resume via HTTP Range + SHA-256 (EmbeddingGemma 2 Q8_0, 310 MB)', async () => {
  const reg = parseRegistry(JSON.parse(readFileSync(new URL('../models.registry.json', import.meta.url), 'utf8')));
  const e = pick(reg, 'embedding', 1);
  const spec = { url: e.url, dest: join(tmp, e.file), size: e.size_bytes, sha256: e.sha256 };
  const ac = new AbortController();
  await downloadVerified(spec, (d) => { if (d > 10_000_000) ac.abort(); }, ac.signal).catch(() => undefined); // simulate a dropped connection
  const partial = existsSync(spec.dest + '.part') ? readFileSync(spec.dest + '.part').length : 0;
  assert.ok(partial > 0 && partial < spec.size, `partial=${partial}`);
  await downloadVerified(spec);
  assert.equal(readFileSync(spec.dest).length, spec.size);
  return `interrupted at ${(partial / 1e6).toFixed(1)} MB, resumed and verified`;
}, process.env.SKIP_NETWORK ? 'SKIP_NETWORK set' : false);

console.log('\n' + results.map(([n, s, d]) => `${s.padEnd(4)}  ${n}\n      ${d.split('\n')[0]}`).join('\n'));
const failed = results.filter((r) => r[1] === 'FAIL');
for (const f of failed) console.error(`\n--- ${f[0]} ---\n${f[2]}`);
process.exit(failed.length ? 1 : 0);
