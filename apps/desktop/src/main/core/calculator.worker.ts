/**
 * Runs inside a worker_thread (see calculator.ts). Evaluates ONLY math expressions with mathjs.
 * mathjs has its own parser (no eval / new Function), and we additionally disable the functions the
 * mathjs security page lists as risky: import, createUnit, reviver, evaluate, parse, simplify,
 * derivative, resolve. The worker gives us a hard timeout and keeps a runaway expression from
 * freezing the main process.
 */
import { parentPort } from 'node:worker_threads';
import { create, all, type MathJsInstance } from 'mathjs';

const math = create(all, { number: 'number', precision: 64 }) as MathJsInstance;
// Marine/everyday units mathjs lacks. Must be created BEFORE createUnit is disabled below.
math.createUnit('knot', { definition: '1852 m/h', aliases: ['knots', 'kn', 'kt'] });
math.createUnit('nauticalmile', { definition: '1852 m', aliases: ['nauticalmiles', 'nmi'] });
math.createUnit('lakh', { definition: '100000', aliases: ['lakhs'] });
math.createUnit('crore', { definition: '10000000', aliases: ['crores'] });
const limitedEvaluate = math.evaluate.bind(math);
const disabled = (name: string) => () => { throw new Error(`function ${name} is disabled`); };
math.import(
  Object.fromEntries(
    ['import', 'createUnit', 'reviver', 'evaluate', 'parse', 'simplify', 'derivative', 'resolve', 'compile']
      .map((n) => [n, disabled(n)]),
  ),
  { override: true },
);

export type CalcRequest =
  | { id: number; kind: 'calc'; expression: string }
  | { id: number; kind: 'convert'; value: number; from: string; to: string };
export type CalcResponse = { id: number; ok: true; result: string; value?: number } | { id: number; ok: false; error: string };

function handle(req: CalcRequest): CalcResponse {
  try {
    if (req.kind === 'calc') {
      const r = limitedEvaluate(req.expression, {}); // empty scope: no variables from outside
      if (typeof r === 'function') throw new Error('result is a function');
      const value = typeof r === 'number' ? r : undefined;
      return { id: req.id, ok: true, result: math.format(r, { precision: 12, lowerExp: -9, upperExp: 15 }), value };
    }
    const u = math.unit(req.value, req.from).to(req.to);
    return { id: req.id, ok: true, result: u.format({ precision: 10 }), value: u.toNumber(req.to) };
  } catch (e) {
    return { id: req.id, ok: false, error: (e as Error).message };
  }
}

parentPort?.on('message', (req: CalcRequest) => parentPort!.postMessage(handle(req)));
