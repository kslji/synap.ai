/**
 * Which transport one code turn runs on: the local sidecar, or the gateway.
 *
 * The offline path is the default and the fallback, and every condition here
 * narrows it away from the network rather than toward it: an offline chat must
 * make zero requests, so only an explicit online pick with a project open, plain
 * text, and Offline-only mode off ever reaches GatewayProvider.
 */

export interface CodeTurnInput {
  /** Which model the user picked for this turn. Absent means offline. */
  mode?: 'online' | 'offline'
  /** The active agent for this turn; the code agent owns the loop. */
  agentId?: string
  /** A folder is open, so the code agent has something to work on. */
  hasRoot: boolean
  /** Screenshots attached. Vision routing stays on the local sidecar for now. */
  images: number
  /** Offline-only mode is on: no turn may touch the network. */
  offlineOnly: boolean
  /** The turn reads or edits project files. */
  wantsProjectFiles: boolean
}

/** True when a code turn should run the shared loop through the gateway provider. */
export function onlineCodeAgentTurn(input: CodeTurnInput): boolean {
  return input.mode === 'online'
    && input.offlineOnly === false
    && (input.agentId ?? 'code') === 'code'
    && input.hasRoot
    && input.wantsProjectFiles
    && input.images === 0
}
