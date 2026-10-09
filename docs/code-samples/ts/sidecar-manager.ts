/**
 * Sidecar manager (main process): starts/stops native helper binaries such as llama-server.
 * Native executables are started with child_process.spawn. (Electron's utilityProcess.fork is for
 * Node.js scripts - we use it for our own JS background workers, not for llama-server/whisper.)
 *
 * Security: llama-server listens on 127.0.0.1 only, on a random free port, with a random API key,
 * so other local apps/websites cannot use it. The renderer never talks to it directly.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

export interface LlamaServerOptions {
  binPath: string; //          resolveSidecar('llama-server') - see below
  modelPath: string;
  mmprojPath?: string; //      Qwen3.5 vision encoder; omit to save RAM when no image support is needed
  embeddings?: boolean; //     true = embedding server (EmbeddingGemma 2, mean pooling), false = chat server
  pooling?: 'cls' | 'mean' | 'last';
  ctx?: number;
  threads?: number;
  gpuLayers?: number | 'auto';
  logFile?: string;
  extraArgs?: string[];
  startupTimeoutMs?: number;
}

export type SidecarState = 'stopped' | 'starting' | 'ready' | 'crashed';

export class LlamaServer extends EventEmitter {
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private restarts = 0;
  private stopping = false;
  private tail: string[] = [];
  state: SidecarState = 'stopped';
  port = 0;
  readonly apiKey = randomBytes(24).toString('base64url');

  constructor(private readonly opts: LlamaServerOptions) { super(); }

  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }

  args(): string[] {
    const o = this.opts;
    const a = ['-m', o.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '--api-key', this.apiKey,
      '-c', String(o.ctx ?? 8192), '-np', '1', '--no-webui'];  // -np 1: one slot = one user; -c ALWAYS set (default would be 262144)
    if (o.threads) a.push('-t', String(o.threads));
    if (o.gpuLayers !== undefined) a.push('-ngl', String(o.gpuLayers));
    // EmbeddingGemma 2 attends bidirectionally: the whole input must fit in ONE micro-batch, so -ub = -b = -c.
    if (o.embeddings) a.push('--embeddings', '--pooling', o.pooling ?? 'mean', '-ub', String(o.ctx ?? 2048), '-b', String(o.ctx ?? 2048));
    else a.push('--jinja'); // chat template from the GGUF + OpenAI-style tool calling
    if (o.mmprojPath) a.push('--mmproj', o.mmprojPath);
    return [...a, ...(o.extraArgs ?? [])];
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.port = await freePort();
    this.state = 'starting';
    this.emit('state', this.state);
    if (this.opts.logFile) this.log ??= createWriteStream(this.opts.logFile, { flags: 'a' });
    const env = { ...process.env };
    // llama.cpp release builds ship shared libs next to the binary. Windows/macOS find them there;
    // Linux needs LD_LIBRARY_PATH.
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [dirname(this.opts.binPath), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    const child = spawn(this.opts.binPath, this.args(), { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    const onData = (b: Buffer) => {
      this.log?.write(b);
      this.tail.push(...b.toString().split('\n').filter(Boolean));
      if (this.tail.length > 50) this.tail.splice(0, this.tail.length - 50);
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', (code, signal) => this.onExit(code, signal));
    await this.waitHealthy(this.opts.startupTimeoutMs ?? 120_000);
    this.state = 'ready';
    this.restarts = 0;
    this.emit('state', this.state);
  }

  /** /health returns 503 while the model loads and 200 when ready. */
  private async waitHealthy(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.child || this.child.exitCode !== null) throw new Error(`llama-server exited during startup:\n${this.tail.join('\n')}`);
      try {
        const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.stop();
    throw new Error('llama-server did not become healthy in time');
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.stopping) { this.state = 'stopped'; this.emit('state', this.state); return; }
    this.state = 'crashed';
    this.emit('state', this.state, { code, signal, tail: this.tail.slice(-10) });
    // exponential backoff: 1s, 2s, 4s ... give up after 5 tries (then the UI offers a smaller model)
    if (this.restarts < 5) {
      const delay = 1000 * 2 ** this.restarts++;
      setTimeout(() => { if (!this.stopping) this.start().catch((e) => this.emit('error', e)); }, delay);
    }
  }

  async stop(graceMs = 5000): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGTERM'); // on Windows this is TerminateProcess
    const t = setTimeout(() => child.kill('SIGKILL'), graceMs);
    await exited;
    clearTimeout(t);
  }

  /** Swap model (e.g. user downloads the 9B) by restarting with new options. */
  async restartWith(patch: Partial<LlamaServerOptions>): Promise<void> {
    await this.stop();
    Object.assign(this.opts, patch);
    await this.start();
  }
}

/**
 * Where bundled binaries live. electron-builder copies resources/bin/<platform>-<arch>/ via
 * extraResources to <app>/Contents/Resources/bin (mac) or resources\bin (win) = process.resourcesPath.
 * Pass `isPackaged` / `resourcesPath` / `appRoot` from Electron (app.isPackaged, process.resourcesPath).
 */
export function resolveSidecar(name: string, isPackaged: boolean, resourcesPath: string, appRoot: string): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return isPackaged
    ? `${resourcesPath}/bin/${exe}`
    : `${appRoot}/resources/bin/${process.platform}-${process.arch}/${exe}`;
}
