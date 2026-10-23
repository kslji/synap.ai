/**
 * Offline benchmark harness for the local llama.cpp stack. No network is used except
 * loopback to the sidecar (or to `--base-url`).
 *
 * It measures the numbers the offline targets are stated in:
 *   - time to first token, first request (cold) and warm runs that reuse the KV cache
 *     via cache_prompt + a stable system-prompt prefix
 *   - decode speed (tok/s)
 *   - Tab latency: one real FIM /completion at the app's own token budget
 *   - memory: llama-server RSS once the model is loaded
 *
 * Usage:
 *   npm run bench:offline                       # start llama-server for this machine's RAM tier
 *   npm run bench:offline -- --runs 7 --tokens 96
 *   npm run bench:offline -- --base-url http://127.0.0.1:8080 --api-key KEY
 *   npm run bench:offline -- --stub             # no model on disk: validate the harness itself
 *   npm run bench:offline -- --model qwen3.5-4b-q4_k_m --fa on --json /tmp/bench.json
 *
 * Exit codes: 0 every target met, 1 a target missed, 2 not measurable here (model missing).
 * A blocked run still prints the machine profile and the model the RAM tier selects, so the
 * table is filled in on a machine that has the weights.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';

import { LlamaServer } from '../../apps/desktop/src/main/core/sidecar-manager.js';
import { detectHardware } from '../../apps/desktop/src/main/core/hardware.js';
import { buildCompletionPrompt } from '../../apps/desktop/src/main/core/code-agent/completion/fim.js';
import { predictBudget } from '../../apps/desktop/src/main/core/code-agent/completion/windows.js';
import { budgetForTier } from '../../apps/desktop/src/main/core/token-budget.js';

const ROOT = repoRoot();
const REGISTRY = join(ROOT, 'apps/desktop/resources/models.registry.json');
const BIN_DIR = join(ROOT, 'apps/desktop/resources/bin', `${platform()}-${arch()}`);

/** The repo root, so `npx tsx scripts/bench-offline/bench.ts` works from anywhere sane. */
function repoRoot(): string {
  const candidates = [process.env.SURF_REPO_ROOT, process.cwd()].filter((dir): dir is string => Boolean(dir));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'apps/desktop/resources/models.registry.json'))) return dir;
  }
  throw new Error('run this from the repo root, or set SURF_REPO_ROOT');
}

/** Targets from the roadmap. tok/s depends on whether the weights run on the GPU. */
const TARGET_TTFT_MS = 1_000;
const TARGET_TAB_MS = 300;
const TARGET_TPS_GPU = 20;
const TARGET_TPS_CPU = 10;

/**
 * Stable system prefix. Every warm run sends this byte-for-byte so llama.cpp can reuse
 * the cached KV for it; anything that changes per run would defeat cache_prompt.
 */
const SYSTEM_PREFIX = [
  'You are Surf, an offline coding assistant running on the user\'s own machine.',
  'Answer with the smallest correct change. Prefer exact, minimal edits over rewrites.',
  'Never invent files, APIs, or command output. If a step cannot be verified, say so.',
  'Keep replies short. Code goes in fenced blocks with the language tag.',
].join('\n');

const CHAT_PROMPT = 'In two sentences, what does a typecheck prove that a unit test does not?';

interface Args {
  baseUrl?: string;
  apiKey: string;
  model?: string;
  modelsDir?: string;
  runs: number;
  tokens: number;
  fa?: 'on' | 'off' | 'auto';
  gpuLayers?: number;
  stub: boolean;
  compareDraft: boolean;
  json?: string;
}

interface Sample {
  ttftMs: number;
  tokPerSec: number;
  tokens: number;
}

interface Report {
  stub: boolean;
  machine: Record<string, unknown>;
  model: Record<string, unknown>;
  metrics: Record<string, { value: number | null; unit: string; target: string; status: 'PASS' | 'FAIL' | 'INFO' | 'BLOCKED' }>;
  draft?: { withoutTps: number; withTps: number; deltaPct: number; verdict: 'keep' | 'drop' };
  blocked?: string;
  samples: { chat: Sample[]; tabMs: number[] };
  startedAt: string;
}

interface Suite {
  coldMs: number;
  warm: Sample[];
  tabMs: number[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { apiKey: 'bench', runs: 5, tokens: 64, stub: false, compareDraft: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--base-url') out.baseUrl = next();
    else if (flag === '--api-key') out.apiKey = next();
    else if (flag === '--model') out.model = next();
    else if (flag === '--models-dir') out.modelsDir = next();
    else if (flag === '--runs') out.runs = Math.max(1, Number(next()));
    else if (flag === '--tokens') out.tokens = Math.max(8, Number(next()));
    else if (flag === '--fa') out.fa = next() as Args['fa'];
    else if (flag === '--gpu-layers') out.gpuLayers = Number(next());
    else if (flag === '--json') out.json = next();
    else if (flag === '--stub') out.stub = true;
    else if (flag === '--compare-draft') out.compareDraft = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

const round = (value: number, digits = 0): number => Number(value.toFixed(digits));

/** Where the app keeps weights: SURF_MODELS_DIR, else Electron's userData/models for Synap.surf. */
function defaultModelsDir(): string {
  if (process.env.SURF_MODELS_DIR) return process.env.SURF_MODELS_DIR;
  const app = 'Synap.surf';
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', app, 'models');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app, 'models');
  return join(homedir(), '.config', app, 'models');
}

interface RegistryModel {
  id: string;
  file: string;
  size_bytes: number;
  min_ram_gb?: number;
  tiers?: number[];
  context_default?: number;
  context_max?: number;
  draft?: { id: string; file: string };
  sampling?: { temperature?: number; top_p?: number; top_k?: number; presence_penalty?: number };
}

function loadRegistry(): RegistryModel[] {
  const parsed = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { models?: RegistryModel[] } | RegistryModel[];
  return Array.isArray(parsed) ? parsed : (parsed.models ?? []);
}

/** The chat model the RAM tier selects: the largest that fits and lists this tier. */
function pickModel(models: RegistryModel[], args: Args, ramGb: number, tier: number): RegistryModel | undefined {
  const chats = models.filter((m) => (m.file ?? '').endsWith('.gguf') && !m.draft && m.context_default);
  const wanted = args.model ? chats.find((m) => m.id === args.model) : undefined;
  if (args.model) return wanted ?? chats.find((m) => m.id === args.model);
  const fits = chats
    .filter((m) => (m.min_ram_gb ?? 0) <= ramGb && (m.tiers ?? []).includes(tier))
    .sort((a, b) => (b.min_ram_gb ?? 0) - (a.min_ram_gb ?? 0));
  return fits[0] ?? chats.sort((a, b) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0))[0];
}

/** llama.cpp prints timings on non-stream replies; streaming only gives us wall-clock. */
interface ChatStreamResult {
  ttftMs: number;
  totalMs: number;
  tokens: number;
  predictedPerSecond?: number;
}

async function chatStream(baseUrl: string, apiKey: string, maxTokens: number, cachePrompt: boolean, sampling: RegistryModel['sampling']): Promise<ChatStreamResult> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PREFIX },
        { role: 'user', content: CHAT_PROMPT },
      ],
      max_tokens: maxTokens,
      stream: true,
      cache_prompt: cachePrompt,
      stream_options: { include_usage: true },
      temperature: sampling?.temperature ?? 0,
      top_p: sampling?.top_p ?? 1,
      ...(sampling?.top_k ? { top_k: sampling.top_k } : {}),
      ...(sampling?.presence_penalty ? { presence_penalty: sampling.presence_penalty } : {}),
    }),
  });
  if (!response.ok || !response.body) throw new Error(`chat: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first = 0;
  let tokens = 0;
  let predictedPerSecond: number | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk: { choices?: { delta?: { content?: string } }[]; usage?: { completion_tokens?: number }; timings?: { predicted_per_second?: number } };
      try { chunk = JSON.parse(data); } catch { continue; }
      const text = chunk.choices?.[0]?.delta?.content ?? '';
      if (text.length > 0 && first === 0) first = performance.now();
      if (text.length > 0) tokens += 1;
      if (chunk.usage?.completion_tokens) tokens = Math.max(tokens, chunk.usage.completion_tokens);
      if (chunk.timings?.predicted_per_second) predictedPerSecond = chunk.timings.predicted_per_second;
    }
  }
  const totalMs = performance.now() - started;
  return { ttftMs: (first || totalMs) - started, totalMs, tokens, predictedPerSecond };
}

/** One Tab request at the app's own budget: FIM prompt, 48 tokens, stop on newline. */
async function tabOnce(baseUrl: string, apiKey: string): Promise<number> {
  const budget = predictBudget('line');
  const built = buildCompletionPrompt({
    prefix: 'export function total(items: number[]) {\n  return items.',
    suffix: '\n}\n',
    path: 'src/total.ts',
    snippets: [],
    fim: true,
  });
  const started = performance.now();
  const response = await fetch(`${baseUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      prompt: built.prompt,
      n_predict: budget.maxTokens,
      temperature: 0,
      top_k: 1,
      stop: budget.stop,
      cache_prompt: true,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`Tab: HTTP ${response.status}`);
  await response.json();
  return performance.now() - started;
}

/** Cold request, then warm runs (cache_prompt reuse), then the Tab requests. */
async function runSuite(baseUrl: string, apiKey: string, tokens: number, runs: number, sampling: RegistryModel['sampling']): Promise<Suite> {
  // Cold: the very first request, empty KV cache.
  const cold = await chatStream(baseUrl, apiKey, tokens, true, sampling);
  // Warm: identical prefix, cache_prompt on. What the app sees after the first turn.
  const warm: Sample[] = [];
  for (let i = 0; i < runs; i++) {
    const run = await chatStream(baseUrl, apiKey, tokens, true, sampling);
    const windowMs = Math.max(1, run.totalMs - run.ttftMs);
    const tokPerSec = run.predictedPerSecond ?? (run.tokens > 1 ? ((run.tokens - 1) / windowMs) * 1000 : 0);
    warm.push({ ttftMs: round(run.ttftMs, 0), tokPerSec: round(tokPerSec, 1), tokens: run.tokens });
  }
  const tabMs: number[] = [];
  for (let i = 0; i < runs; i++) tabMs.push(round(await tabOnce(baseUrl, apiKey), 0));
  return { coldMs: round(cold.ttftMs, 0), warm, tabMs };
}

function serverRssMb(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /VmRSS:\s+(\d+) kB/.exec(status);
    if (match) return round(Number(match[1]) / 1024, 0);
  } catch { /* not Linux */ }
  try {
    const ps = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
    const kb = Number(ps.trim());
    if (Number.isFinite(kb) && kb > 0) return round(kb / 1024, 0);
  } catch { /* not measurable */ }
  return null;
}

/**
 * A tiny llama.cpp-shaped stub. It exists so the harness itself can be exercised (request
 * shape, SSE parsing, percentiles, table) on a machine with no weights. Its timings are
 * synthetic and are labelled STUB everywhere they surface.
 */
function startStub(): Promise<{ url: string; close: () => Promise<void> }> {
  const TOKENS = 24;
  const GAP_MS = 4;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    if (url === '/tokenize') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"tokens":[1]}');
      return;
    }
    if (url === '/completion') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: 'length;\n', timings: { predicted_per_second: 1000 / GAP_MS } }));
      }, GAP_MS * 6);
      return;
    }
    if (url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      let sent = 0;
      const tick = setInterval(() => {
        sent += 1;
        const payload = sent === 1
          ? { choices: [{ delta: { content: 'A typecheck' } }] }
          : sent <= TOKENS
            ? { choices: [{ delta: { content: ' proves' } }] }
            : { choices: [{ delta: {} }], timings: { predicted_per_second: 1000 / GAP_MS } };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (sent > TOKENS) {
          clearInterval(tick);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, GAP_MS);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      done({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((closed) => server.close(() => closed())),
      });
    });
  });
}

function table(rows: [string, string, string, string][]): string {
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  return rows
    .map((r) => `${r[0].padEnd(widths[0])}  ${r[1].padStart(widths[1])}  ${r[2].padStart(widths[2])}  ${r[3]}`)
    .join('\n');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const hw = await detectHardware();
  const models = loadRegistry();
  const modelsDir = args.modelsDir ?? defaultModelsDir();
  const model = pickModel(models, args, hw.totalRamGb, hw.tier);
  const gpuLayers = args.gpuLayers ?? (hw.appleSilicon ? 999 : 999);
  // -c comes from the tier budget, which is what app-services passes to the sidecar.
  const ctx = budgetForTier(hw.tier).serverCtx;
  const onGpu = gpuLayers > 0;
  const targetTps = onGpu ? TARGET_TPS_GPU : TARGET_TPS_CPU;

  const report: Report = {
    stub: args.stub,
    startedAt: new Date().toISOString(),
    machine: {
      platform: `${hw.platform}-${hw.arch}`,
      cpu: hw.cpuModel,
      cores: hw.physicalCores,
      ramGb: hw.totalRamGb,
      tier: hw.tier,
      gpus: hw.gpus.map((g) => g.model),
    },
    model: model
      ? {
        id: model.id,
        file: model.file,
        sizeGib: round((model.size_bytes ?? 0) / 1024 ** 3, 2),
        ctx,
        gpuLayers,
        draft: model.draft?.file ?? null,
      }
      : { id: null },
    metrics: {},
    samples: { chat: [], tabMs: [] },
  };

  let server: LlamaServer | undefined;
  let serverOpts: ConstructorParameters<typeof LlamaServer>[0] | undefined;
  let stub: { url: string; close: () => Promise<void> } | undefined;
  let loadMs: number | null = null;
  let baseUrl: string;
  let apiKey = args.apiKey;

  if (args.stub) {
    stub = await startStub();
    baseUrl = stub.url;
    console.log('STUB MODE: timings are synthetic and only prove the harness works.\n');
  } else if (args.baseUrl) {
    baseUrl = args.baseUrl;
  } else {
    const binPath = join(BIN_DIR, platform() === 'win32' ? 'llama-server.exe' : 'llama-server');
    const modelPath = model ? join(modelsDir, model.file) : '';
    if (!existsSync(binPath)) {
      report.blocked = `llama-server is not installed (${binPath})`;
    } else if (!model) {
      report.blocked = 'no chat model in models.registry.json fits this machine';
    } else if (!existsSync(modelPath)) {
      report.blocked = `model weights are not on disk (${modelPath})`;
    }
    if (report.blocked) {
      printReport(report);
      return 2;
    }
    apiKey = Math.random().toString(36).slice(2);
    serverOpts = {
      binPath,
      modelPath,
      ctx,
      gpuLayers,
      threads: Math.max(1, hw.physicalCores - 1),
      cacheRamMiB: 512, // a warm server is the point of this benchmark
      extraArgs: args.fa ? ['-fa', args.fa] : [],
    };
    server = new LlamaServer(serverOpts);
    const startedLoad = performance.now();
    await server.start();
    loadMs = round(performance.now() - startedLoad, 0);
    baseUrl = server.baseUrl;
    apiKey = server.apiKey;
  }

  try {
    const suite = await runSuite(baseUrl, apiKey, args.tokens, args.runs, model?.sampling);
    let draftPass: Suite | undefined;
    if (args.compareDraft && server && serverOpts) {
      const draftPath = model?.draft ? join(modelsDir, model.draft.file) : '';
      if (!draftPath || !existsSync(draftPath)) {
        report.draft = undefined;
        console.log(`draft   : not on disk (${draftPath || 'no draft in the registry'}) - skipped the A/B pass\n`);
      } else {
        // Item 3: run the identical suite with the draft model attached and keep it only if faster.
        await server.stop();
        server = new LlamaServer({ ...serverOpts, draftModelPath: draftPath });
        await server.start();
        draftPass = await runSuite(server.baseUrl, server.apiKey, args.tokens, args.runs, model?.sampling);
      }
    }
    const rssMb = serverRssMb(server?.pid);

    const warmTtft = percentile(suite.warm.map((s) => s.ttftMs), 50);
    const tps = percentile(suite.warm.map((s) => s.tokPerSec), 50);
    const tab = percentile(suite.tabMs, 50);
    const stubNote = args.stub ? ' (STUB)' : '';
    const verdict = (pass: boolean): 'PASS' | 'FAIL' => (pass ? 'PASS' : 'FAIL');

    if (draftPass) {
      const withTps = percentile(draftPass.warm.map((s) => s.tokPerSec), 50);
      report.draft = {
        withoutTps: tps,
        withTps,
        deltaPct: round(((withTps - tps) / Math.max(1, tps)) * 100, 1),
        verdict: withTps > tps ? 'keep' : 'drop',
      };
    }

    report.samples = { chat: suite.warm, tabMs: suite.tabMs };
    report.metrics = {
      firstTokenCold: { value: suite.coldMs, unit: 'ms', target: `< ${TARGET_TTFT_MS}`, status: verdict(suite.coldMs < TARGET_TTFT_MS) },
      firstTokenWarmP50: { value: warmTtft, unit: 'ms', target: `< ${TARGET_TTFT_MS}`, status: verdict(warmTtft < TARGET_TTFT_MS) },
      decode: { value: tps, unit: 'tok/s', target: `>= ${targetTps} (${onGpu ? 'GPU' : 'CPU'})`, status: verdict(tps >= targetTps) },
      tabP50: { value: tab, unit: 'ms', target: `< ${TARGET_TAB_MS}`, status: verdict(tab < TARGET_TAB_MS) },
      tabP95: { value: percentile(suite.tabMs, 95), unit: 'ms', target: `< ${TARGET_TAB_MS}`, status: verdict(percentile(suite.tabMs, 95) < TARGET_TAB_MS) },
      memoryRss: { value: rssMb, unit: 'MB', target: `reference (weights ${round((model?.size_bytes ?? 0) / 1024 ** 2, 0)} MB)`, status: 'INFO' },
      modelLoad: { value: loadMs, unit: 'ms', target: 'INFO', status: 'INFO' },
    };
    if (args.stub) for (const metric of Object.values(report.metrics)) if (metric.status !== 'INFO') metric.target += stubNote;

    printReport(report);
    if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
    const failed = Object.values(report.metrics).some((m) => m.status === 'FAIL');
    return failed ? 1 : 0;
  } finally {
    await server?.stop();
    await stub?.close();
  }
}

function printReport(report: Report): void {
  const m = report.machine;
  const model = report.model;
  console.log('== Surf offline benchmark ==');
  console.log(`machine : ${m.platform} ${m.cores} cores, ${m.ramGb} GB RAM, tier ${m.tier}${(m.gpus as string[]).length ? `, ${(m.gpus as string[]).join(', ')}` : ''}`);
  console.log(`cpu     : ${m.cpu}`);
  console.log(`model   : ${model.id ?? 'none'} ${model.sizeGib ? `(${model.sizeGib} GiB, ctx ${model.ctx}, -ngl ${model.gpuLayers})` : ''}`);
  if (model.draft) console.log(`draft   : ${model.draft}`);
  if (report.draft) {
    console.log(`draft A/B: ${report.draft.withoutTps} -> ${report.draft.withTps} tok/s (${report.draft.deltaPct > 0 ? '+' : ''}${report.draft.deltaPct}%) => ${report.draft.verdict}`);
  }
  console.log('');
  if (report.blocked) {
    console.log(`BLOCKED: ${report.blocked}`);
    console.log('Install the weights (app Settings -> Models) or pass --base-url to a running llama-server.');
    console.log('');
    return;
  }
  const rows: [string, string, string, string][] = [['metric', 'target', 'measured', 'status']];
  for (const [name, metric] of Object.entries(report.metrics)) {
    rows.push([name, metric.target, metric.value === null ? 'n/a' : `${metric.value} ${metric.unit}`, metric.status]);
  }
  console.log(table(rows));
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'benchmark failed');
    process.exitCode = 1;
  });
