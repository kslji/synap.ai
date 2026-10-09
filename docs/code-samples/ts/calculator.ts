/**
 * Calculator + unit conversion tools for the LLM (main process).
 * Why mathjs in a worker_thread and not isolated-vm / vm2 / eval:
 *  - the model only needs arithmetic + units, not JavaScript; mathjs parses its own expression language
 *  - isolated-vm is a native module (another per-platform rebuild) and its current major needs Node >= 24
 *  - node:vm is explicitly "not a security mechanism"; eval/new Function are never acceptable
 *  - the worker gives a hard timeout (terminate) so `2^2^2^2^2` or huge matrices cannot hang the app
 */
import { Worker } from 'node:worker_threads';
import type { CalcRequest, CalcResponse } from './calculator.worker.js';

const MAX_EXPR = 500;
const TIMEOUT_MS = 1000;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (r: CalcResponse) => void; timer: NodeJS.Timeout };

export class Calculator {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  /** workerUrl: compiled worker file. electron-vite: `import workerUrl from './calculator.worker?modulePath'`. */
  constructor(private readonly workerUrl: URL | string, private readonly execArgv: string[] = []) {}

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.workerUrl, { execArgv: this.execArgv, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    w.on('message', (r: CalcResponse) => {
      const p = this.pending.get(r.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(r.id);
      p.resolve(r);
    });
    w.on('error', () => this.reset('calculator worker crashed'));
    w.on('exit', () => { if (this.worker === w) this.worker = null; });
    w.unref();
    return (this.worker = w);
  }

  private reset(reason: string): void {
    const w = this.worker;
    this.worker = null;
    void w?.terminate();
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ id, ok: false, error: reason }); }
    this.pending.clear();
  }

  private run(req: DistributiveOmit<CalcRequest, 'id'>): Promise<CalcResponse> {
    const id = ++this.seq;
    const w = this.ensure();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.reset('timeout'), TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      w.postMessage({ ...req, id });
    });
  }

  calc(expression: string): Promise<CalcResponse> {
    if (expression.length > MAX_EXPR) return Promise.resolve({ id: 0, ok: false, error: 'expression too long' });
    return this.run({ kind: 'calc', expression });
  }

  convert(value: number, from: string, to: string): Promise<CalcResponse> {
    if (!Number.isFinite(value) || from.length > 40 || to.length > 40) {
      return Promise.resolve({ id: 0, ok: false, error: 'bad input' });
    }
    return this.run({ kind: 'convert', value, from, to });
  }

  close(): void { this.reset('closed'); }
}

/** OpenAI-style tool schemas passed to llama-server (--jinja enables tool calling). */
export const calculatorTools = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Evaluate a math expression exactly (e.g. "(12.5*3)/7", "sqrt(2)^3", "15% * 2400"). Use for ANY arithmetic.',
      parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unit_convert',
      description: 'Convert a value between units, e.g. 12 knot -> km/h, 350 degF -> degC, 2 nmi -> km.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } },
        required: ['value', 'from', 'to'],
      },
    },
  },
] as const;
