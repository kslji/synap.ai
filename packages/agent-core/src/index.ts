/**
 * @surf/agent-core - the shared, transport-agnostic agent core.
 *
 * Part 1 owns the provider-agnostic types and the ModelProvider seam. The loop and
 * the transport-specific providers live in the desktop main process and depend on
 * these types, so Offline and Online run ONE core through ONE seam.
 *
 * reply-format.ts adds the second half of that promise: ONE answer format, spelled
 * out once, that both sub-chats put in front of their model.
 */
export type {
  Role,
  ContentPart,
  ToolCall,
  ChatMessage,
  ToolCallResponseFormat,
  CompletionRequest,
  ModelTurn,
  CodeStepStatus,
  CodeDiagnosticView,
  CodeStepView,
  CodeDiffStatus,
  CodeDiffView,
  CodePlanStepView,
  CodeUndoView,
  CodePlanView,
} from './types.js'

export type { GenerateOptions, ModelProvider } from './provider.js'
export { providerToComplete, completeToProvider } from './provider.js'

export {
  ANSWER_RULES,
  CALCULATOR_RULE,
  EXACT_NUMBER_RULE,
  MARKDOWN_RULE,
  MYTH_RULE,
  NO_REPEAT_RULE,
  SOURCE_RULE,
  UNTRUSTED_RULE,
  chatSystemPrompt,
} from './reply-format.js'
export type { ChatOrigin } from './reply-format.js'
