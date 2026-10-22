/**
 * The ModelProvider seam.
 *
 * Offline and Online both reach the model through ONE interface. The agent loop
 * (runCodeAgent / runSplitTask) stays transport-agnostic: it either keeps using its
 * injected `complete(CompletionRequest)` host method, or is handed a ModelProvider
 * via the one-line adapters below. The two produce the identical ModelTurn.
 */
import type { ChatMessage, CompletionRequest, ModelTurn } from './types.js'

/** Everything the loop asks for on a single turn, minus the message list. */
export type GenerateOptions = Omit<CompletionRequest, 'messages'>

export interface ModelProvider {
  generate(messages: ChatMessage[], options: GenerateOptions): Promise<ModelTurn>
}

/** Adapt a provider to the loop's existing `complete(CompletionRequest)` host method. */
export function providerToComplete(provider: ModelProvider): (req: CompletionRequest) => Promise<ModelTurn> {
  return (req) => provider.generate(req.messages, restOf(req))
}

/** Adapt the loop's `complete(CompletionRequest)` host method to a ModelProvider. */
export function completeToProvider(complete: (req: CompletionRequest) => Promise<ModelTurn>): ModelProvider {
  return { generate: (messages, options) => complete({ messages, ...options }) }
}

function restOf({ messages: _messages, ...options }: CompletionRequest): GenerateOptions {
  return options
}
