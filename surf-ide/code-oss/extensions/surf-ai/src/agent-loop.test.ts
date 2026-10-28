/**
 * Agent loop tests: the action protocol, the step/observation cycle against a
 * scripted fake backend, cancellation via AbortSignal, the step limit, and the
 * pill labels the chat renders.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentAction, runAgentLoop, buildAgentSystemPrompt, type AgentTool } from './agent-loop';
import type { ChatTurn } from './chat-types';

const fence = (body: unknown) => '```SURF_ACTION\n' + JSON.stringify(body) + '\n```';

test('the action protocol parses tool calls and final answers', () => {
  assert.deepEqual(
    parseAgentAction(fence({ tool: 'read_file', args: { path: 'a.ts' } })),
    { kind: 'tool', tool: 'read_file', args: { path: 'a.ts' } }
  );
  assert.deepEqual(parseAgentAction(fence({ final: 'done' })), { kind: 'final', text: 'done' });
  // The last valid block wins when a model shows examples before deciding.
  const two = fence({ tool: 'first', args: {} }) + '\nsome note\n' + fence({ final: 'second' });
  assert.deepEqual(parseAgentAction(two), { kind: 'final', text: 'second' });
  // No block at all: the prose is the answer, so the loop cannot hang.
  assert.deepEqual(parseAgentAction('Just prose.'), { kind: 'final', text: 'Just prose.' });
  // A malformed block falls through to prose, not a crash.
  assert.equal(parseAgentAction('```SURF_ACTION\n{not json}\n```').kind, 'final');
});

test('the system prompt lists every tool so the model can choose one', () => {
  const tools: AgentTool[] = [
    { name: 'read_file', description: 'Read a file.', argsHint: 'path: string', run: async () => ({ ok: true, output: '' }) }
  ];
  const prompt = buildAgentSystemPrompt(tools);
  assert.match(prompt, /read_file\(path: string\)/);
  assert.match(prompt, /SURF_ACTION/);
});

function scriptedTurn(resplies: string[]): { run: (turns: ChatTurn[]) => Promise<string>; calls: ChatTurn[][] } {
  const calls: ChatTurn[][] = [];
  let i = 0;
  return {
    calls,
    run: async (turns: ChatTurn[]) => {
      calls.push(turns);
      return resplies[Math.min(i++, resplies.length - 1)];
    }
  };
}

test('a two-step task reads, proposes, and finishes with history intact', async () => {
  const readCalls: unknown[] = [];
  const proposeCalls: unknown[] = [];
  const tools: AgentTool[] = [
    {
      name: 'read_file',
      description: 'Read a file.',
      argsHint: 'path: string',
      run: async (args) => { readCalls.push(args); return { ok: true, output: 'const x = 1;' }; }
    },
    {
      name: 'propose_edit',
      description: 'Propose an edit.',
      argsHint: 'path, search, replace',
      run: async (args) => { proposeCalls.push(args); return { ok: true, output: 'Edit proposed for a.ts (+1/-1).' }; }
    }
  ];
  const backend = scriptedTurn([
    'Let me read it first.\n' + fence({ tool: 'read_file', args: { path: 'a.ts' } }),
    'Now the change.\n' + fence({ tool: 'propose_edit', args: { path: 'a.ts', search: '1', replace: '2' } }),
    fence({ final: 'Proposed the fix in a.ts; accept it in the diff.' })
  ]);
  const steps: string[] = [];
  const deltas: string[] = [];
  const result = await runAgentLoop(
    'fix a.ts',
    tools,
    (turns) => backend.run(turns),
    { onStep: (label) => steps.push(label), onDelta: (t) => deltas.push(t) }
  );
  assert.equal(result.cancelled, false);
  assert.equal(result.stoppedAtLimit, false);
  assert.match(result.answer, /accept it in the diff/);
  assert.equal(result.steps, 3);
  assert.deepEqual(readCalls, [{ path: 'a.ts' }]);
  assert.deepEqual(proposeCalls, [{ path: 'a.ts', search: '1', replace: '2' }]);
  assert.deepEqual(steps, ['Reading a.ts…', 'Proposing edit to a.ts…']);

  // Multi-turn history: step 2's call carries step 1's assistant reply and the
  // observation, so the model sees what the tool actually returned.
  const secondCall = backend.calls[1];
  assert.equal(secondCall[0].role, 'system');
  assert.equal(secondCall[1].content, 'fix a.ts');
  assert.ok(secondCall.some((t) => t.content.includes('const x = 1;')));
  assert.ok(secondCall.some((t) => t.role === 'assistant' && t.content.includes('read_file')));
});

test('an unknown tool is reported back and the loop continues', async () => {
  const backend = scriptedTurn([
    fence({ tool: 'teleport', args: {} }),
    fence({ final: 'sorry, no teleport' })
  ]);
  const result = await runAgentLoop('do it', [], (turns) => backend.run(turns));
  assert.match(result.answer, /no teleport/);
  assert.ok(backend.calls[1].some((t) => t.content.includes('Unknown tool')));
});

test('aborting mid-loop stops immediately and reports cancelled', async () => {
  const controller = new AbortController();
  const tools: AgentTool[] = [
    {
      name: 'run_command',
      description: 'Run a command.',
      argsHint: 'command: string',
      run: async () => {
        controller.abort();
        return { ok: true, output: 'done' };
      }
    }
  ];
  let calls = 0;
  const result = await runAgentLoop(
    'npm test',
    tools,
    async () => {
      calls += 1;
      return fence({ tool: 'run_command', args: { command: 'npm test' } });
    },
    {},
    { signal: controller.signal }
  );
  assert.equal(result.cancelled, true);
  assert.equal(calls, 1);
});

test('a model that never finishes hits the step limit, not an infinite loop', async () => {
  let calls = 0;
  const tools: AgentTool[] = [
    { name: 'list_dir', description: 'List.', argsHint: 'path', run: async () => ({ ok: true, output: 'x' }) }
  ];
  const result = await runAgentLoop(
    'endless',
    tools,
    async () => { calls += 1; return fence({ tool: 'list_dir', args: { path: '.' } }); },
    {},
    { maxSteps: 4 }
  );
  assert.equal(result.stoppedAtLimit, true);
  assert.equal(calls, 4);
});
