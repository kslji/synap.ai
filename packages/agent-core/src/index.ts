/**
 * @surf/agent-core - the shared, transport-agnostic agent core.
 *
 * Part 1 owns the provider-agnostic types and the ModelProvider seam. The loop and
 * the transport-specific providers live in the desktop main process and depend on
 * these types, so Offline and Online run ONE core through ONE seam.
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
