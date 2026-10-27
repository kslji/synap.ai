/**
 * Qwen3.5 thinking policy, in one place so no call-site can drift.
 *
 * Thinking adds latency and nothing else to a short, well-specified job, so it is off for
 * everything a person waits on: Tab completion, inline edit, quick chat, and each edit step of a
 * plan. It is on only where a wrong answer is expensive: planning a task and fixing a step that
 * just failed.
 *
 * The template in this build ignores a per-request `reasoning_budget` (measured: reasoning ran to
 * whatever max_tokens allowed), so the cap is enforced in two requests - think up to the cap, then
 * force the answer with thinking off and the reasoning handed back as context.
 */
import type { ChatMessage } from '@surf/agent-core'

/** Reasoning tokens a plan or fix may use before the answer is forced. */
export const REASONING_TOKEN_CAP = 512

export type ThinkingCall = 'tab' | 'inline-edit' | 'quick-chat' | 'edit-step' | 'plan' | 'fix'

const THINKS: Record<ThinkingCall, boolean> = {
  tab: false,
  'inline-edit': false,
  'quick-chat': false,
  'edit-step': false,
  plan: true,
  fix: true,
}

export function thinkingFor(call: ThinkingCall): boolean {
  return THINKS[call]
}

/** The first request of a thinking step: reasoning only, no tools, no grammar, no answer. */
export function reasoningRequest(): { maxTokens: number; enableThinking: true } {
  return { maxTokens: REASONING_TOKEN_CAP, enableThinking: true }
}

/** What the model is told when its own thinking is handed back to it. */
export function answerPrompt(reasoning: string): string {
  return [
    'Here is your own thinking so far, stopped at the limit.',
    '<thinking>',
    reasoning.trim(),
    '</thinking>',
    'Stop thinking. Give the final answer now.',
  ].join('\n')
}

/** The forced answer request: the same messages, then one user turn carrying the reasoning. */
export function answerMessages(messages: readonly ChatMessage[], reasoning: string): ChatMessage[] {
  if (!reasoning.trim()) return [...messages]
  return [...messages, { role: 'user', content: answerPrompt(reasoning) }]
}
