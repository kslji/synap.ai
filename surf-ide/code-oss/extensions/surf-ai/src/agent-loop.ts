/**
 * The multi-step coding agent loop.
 *
 * The loop runs on the device in both Offline and Online modes; the backend
 * only answers one turn at a time. The model talks in a strict text protocol:
 * each step is prose (shown as a thought) followed by exactly one fenced
 * `SURF_ACTION` block holding JSON — either a tool call or the final answer.
 * Keeping parse/build/loop logic here, with the backend and tools injected as
 * callbacks, means the whole loop is unit-testable without vscode or a model.
 */

import type { ChatTurn } from './chat-types';

export const ACTION_FENCE = 'SURF_ACTION';

export type AgentAction =
  | { kind: 'final'; text: string }
  | { kind: 'tool'; tool: string; args: Record<string, unknown> };

/** Tool result fed back to the model; also rendered as a step pill in the UI. */
export interface AgentObservation {
  ok: boolean;
  output: string;
  /** Short human label for the step pill, e.g. `Reading src/app.ts`. */
  label?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** One-line argument hint so the model formats the call correctly. */
  argsHint: string;
  run: (args: Record<string, unknown>) => Promise<AgentObservation>;
}

export interface AgentLoopEvents {
  /** A compact progress pill for each action the loop takes. */
  onStep?: (label: string) => void;
  /** Tokens of the current step's prose, streamed live. */
  onDelta?: (text: string) => void;
  /** Reasoning tokens for the collapsible Thinking… block. */
  onReasoning?: (text: string) => void;
}

export interface AgentLoopOptions {
  maxSteps?: number;
  signal?: AbortSignal;
  enableThinking?: boolean;
}

/** What one loop step needs from the backend (local sidecar or gateway). */
export type AgentRunTurn = (turns: ChatTurn[], sinks: {
  onContent?: (text: string) => void;
  onReasoning?: (text: string) => void;
}) => Promise<string>;

const DEFAULT_MAX_STEPS = 10;

/** Build the system prompt that teaches the action protocol and lists the tools. */
export function buildAgentSystemPrompt(tools: AgentTool[]): string {
  const catalogue = tools.map((t) => `- ${t.name}(${t.argsHint}): ${t.description}`).join('\n');
  return [
    'You are Surf, a coding agent working inside the user\u2019s workspace. You complete tasks by using tools.',
    '',
    'Every step, reply with a short thought (one or two sentences), then EXACTLY one fenced action block:',
    '',
    '```' + ACTION_FENCE,
    '{ "tool": "tool_name", "args": { ... } }',
    '```',
    '',
    'When the task is finished, reply with the final answer in the same shape:',
    '',
    '```' + ACTION_FENCE,
    '{ "final": "the answer for the user" }',
    '```',
    '',
    'Available tools:',
    catalogue,
    '',
    'Rules:',
    '- One action per step. Never invent tool output; wait for the observation.',
    '- Break multi-file work into subtasks: inspect, then change one file per propose_edit/create_file step.',
    '- After edits, run the project checks (build/test) and fix diagnostics before finishing.',
    '- Never emit more than one action block in a step.'
  ].join('\n');
}

/**
 * Parse one model reply into an action. The last fenced ACTION_FENCE block
 * wins (models sometimes show examples); a reply with no valid block is the
 * final answer verbatim, so a loosely-behaving model still ends the loop
 * gracefully instead of burning steps.
 */
export function parseAgentAction(reply: string): AgentAction {
  return parseAgentActionDetail(reply).action;
}

/**
 * Parse `reply` and report whether a valid action was extracted from a fenced
 * block. `fromValidBlock` is what lets the loop tell a legitimate final answer
 * (`{ "final": ... }`) apart from a malformed `SURF_ACTION` block that only
 * fell back to prose — only the latter deserves a corrective retry.
 */
function parseAgentActionDetail(reply: string): { action: AgentAction; fromValidBlock: boolean } {
  const fence = '```' + ACTION_FENCE;
  const blocks: string[] = [];
  let at = reply.indexOf(fence);
  while (at !== -1) {
    const bodyStart = reply.indexOf('\n', at);
    const bodyEnd = bodyStart === -1 ? -1 : reply.indexOf('```', bodyStart);
    if (bodyEnd === -1) { break; }
    blocks.push(reply.slice(bodyStart + 1, bodyEnd));
    at = reply.indexOf(fence, bodyEnd);
  }
  for (const body of blocks.reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const action = toAction(parsed);
    if (action) {
      return { action, fromValidBlock: true };
    }
  }
  return { action: { kind: 'final', text: reply.trim() }, fromValidBlock: false };
}

function toAction(parsed: unknown): AgentAction | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.final === 'string') {
    return { kind: 'final', text: obj.final };
  }
  if (typeof obj.tool === 'string' && obj.tool.trim()) {
    const args = obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
      ? obj.args as Record<string, unknown>
      : {};
    return { kind: 'tool', tool: obj.tool, args };
  }
  return null;
}

/** The observation text handed back to the model, capped so history stays small. */
const OBSERVATION_LIMIT = 3600;

function formatObservation(result: AgentObservation): string {
  const head = result.ok ? 'Observation: ok' : 'Observation: FAILED';
  const body = result.output.length > OBSERVATION_LIMIT
    ? result.output.slice(0, OBSERVATION_LIMIT) + '\n…truncated…'
    : result.output;
  return body ? `${head}\n${body}` : head;
}

export interface AgentLoopResult {
  answer: string;
  steps: number;
  /** True when the loop hit maxSteps without the model declaring a final answer. */
  stoppedAtLimit: boolean;
  cancelled: boolean;
}

/**
 * Run the loop: model step → action → tool → observation → next step. The
 * conversation is rebuilt every step (system prompt + user task + history), so
 * a cancelled or errored turn never leaves half-appended state behind.
 */
export async function runAgentLoop(
  task: string,
  tools: AgentTool[],
  runTurn: AgentRunTurn,
  events: AgentLoopEvents = {},
  options: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const history: ChatTurn[] = [{ role: 'user', content: task }];
  let steps = 0;
  let parseNudges = 0;

  const aborted = () => options.signal?.aborted === true;

  while (steps < maxSteps) {
    if (aborted()) {
      return { answer: '', steps, stoppedAtLimit: false, cancelled: true };
    }
    const turns: ChatTurn[] = [
      { role: 'system', content: buildAgentSystemPrompt(tools) },
      ...history
    ];
    const reply = await runTurn(
      turns,
      {
        onContent: events.onDelta,
        onReasoning: events.onReasoning
      }
    );
    if (aborted()) {
      return { answer: '', steps, stoppedAtLimit: false, cancelled: true };
    }
    steps += 1;
    const { action, fromValidBlock } = parseAgentActionDetail(reply);

    if (action.kind === 'final') {
      // A malformed action block (a SURF_ACTION fence that didn't parse) gets
      // one corrective retry; a valid final or plain prose ends the loop.
      const malformed = !fromValidBlock && reply.includes('```' + ACTION_FENCE);
      if (malformed && parseNudges === 0 && steps < maxSteps) {
        parseNudges += 1;
        history.push({ role: 'assistant', content: reply });
        history.push({
          role: 'user',
          content: 'That action block was not valid JSON. Reply again with exactly one valid ```'
            + ACTION_FENCE + ' block, or finish with { "final": "..." }.'
        });
        continue;
      }
      return { answer: action.text, steps, stoppedAtLimit: false, cancelled: false };
    }

    const tool = tools.find((t) => t.name === action.tool);
    events.onStep?.(pillFor(action, tool));
    const result: AgentObservation = !tool
      ? { ok: false, output: `Unknown tool "${action.tool}". Available: ${tools.map((t) => t.name).join(', ')}` }
      : await safeRun(tool, action.args);
    if (aborted()) {
      return { answer: '', steps, stoppedAtLimit: false, cancelled: true };
    }
    history.push({ role: 'assistant', content: reply });
    history.push({ role: 'user', content: formatObservation(result) });
  }

  return {
    answer: 'I stopped after ' + maxSteps + ' steps without finishing. Narrow the task or run it again.',
    steps,
    stoppedAtLimit: true,
    cancelled: false
  };
}

async function safeRun(tool: AgentTool, args: Record<string, unknown>): Promise<AgentObservation> {
  try {
    return await tool.run(args);
  } catch (error) {
    return { ok: false, output: (error as Error).message || String(error) };
  }
}

/** Compact pill text the chat shows while the step runs. */
function pillFor(action: Extract<AgentAction, { kind: 'tool' }>, tool: AgentTool | undefined): string {
  if (!tool) { return `Unknown tool ${action.tool}…`; }
  const path = typeof action.args.path === 'string' ? action.args.path : '';
  const command = typeof action.args.command === 'string' ? action.args.command : '';
  const query = typeof action.args.query === 'string' ? action.args.query : '';
  switch (action.tool) {
    case 'read_file': return `Reading ${path || 'file'}…`;
    case 'list_dir': return `Listing ${path || 'folder'}…`;
    case 'search_project': return `Searching project for ${query ? `"${query}"` : 'code'}…`;
    case 'propose_edit': return `Proposing edit to ${path || 'file'}…`;
    case 'create_file': return `Creating ${path || 'file'}…`;
    case 'delete_file': return `Deleting ${path || 'file'}…`;
    case 'run_command': return `Running ${command || 'command'}…`;
    case 'check_diagnostics': return 'Checking diagnostics…';
    default: return `${action.tool}…`;
  }
}
