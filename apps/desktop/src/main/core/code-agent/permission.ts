/**
 * Ask mode is the default. Commands need a yes unless this exact command was allowed before.
 * Edits are diffs until the user applies them.
 *
 * Auto mode is a later step. currentPermissionMode() stays on ask.
 * The loop already skips the wait when the mode is auto.
 */

export type PermissionMode = 'ask' | 'auto'

export interface PermissionRequest {
  kind: 'command' | 'edit'
  command?: string
}

/** Later step: return 'auto' when the user has turned Auto mode on. */
export function currentPermissionMode(): PermissionMode {
  return 'ask'
}

export function exactCommand(command: string): string {
  return command.trim()
}

export function permissionNeeded(mode: PermissionMode, allowed: ReadonlySet<string>, request: PermissionRequest): boolean {
  if (mode === 'auto') return false
  if (request.kind === 'edit') return true
  return !allowed.has(exactCommand(request.command ?? ''))
}
