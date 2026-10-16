/**
 * Ask is the default. A write or a command runs only after a yes,
 * unless that exact command was remembered for this project.
 *
 * Auto writes inside the project and runs allow-listed test, lint,
 * typecheck, and build commands. Install, network, and anything off
 * that list pause for a yes. Deletes outside this run's checkpoints
 * are refused. The model never decides the gate.
 */
import { AUTO_MODE_SUMMARY } from '../../../shared/ipc-contract.js'
import { splitCommand } from './workspace.js'

export { AUTO_MODE_SUMMARY }

export type PermissionMode = 'ask' | 'auto'

export type ApprovalAction = 'allow' | 'ask' | 'deny'

export interface PermissionRequest {
  kind: 'command' | 'edit' | 'delete'
  command?: string
  /** Relative paths a delete would remove. */
  paths?: readonly string[]
}

export interface ApprovalContext {
  /** Exact commands the user remembered for this project. */
  remembered: ReadonlySet<string>
  /** Test, lint, typecheck, and build commands Auto may run. */
  allowlist: ReadonlySet<string>
  /** Files this run already checkpointed. Deletes outside this set are refused. */
  checkpointPaths: ReadonlySet<string>
}

export interface ApprovalDecision {
  action: ApprovalAction
  reason: string
}

const EMPTY: ReadonlySet<string> = new Set()

const DELETE_BINS = new Set(['rm', 'rmdir', 'del', 'unlink', 'shred'])
const NETWORK_BINS = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'netcat', 'ping', 'dig', 'nslookup', 'telnet'])
const INSTALL_BINS = new Set(['pip', 'pip3', 'apt', 'apt-get', 'brew', 'choco', 'winget'])
const PM_BINS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const INSTALL_SUBS = new Set(['install', 'add', 'ci', 'update', 'upgrade', 'publish', 'uninstall', 'remove', 'i', 'exec', 'dlx', 'link'])

export type CommandRisk = 'plain' | 'install' | 'network' | 'destructive' | 'invalid'

/** Later callers pass the saved project mode. This stays ask when nothing is saved. */
export function currentPermissionMode(): PermissionMode {
  return 'ask'
}

export function exactCommand(command: string): string {
  return command.trim()
}

export function effectiveMode(project: PermissionMode | null, fallback: PermissionMode, autoConfirmed: boolean): PermissionMode {
  const chosen = project ?? fallback
  if (chosen !== 'ask' && chosen !== 'auto') return 'ask'
  if (chosen === 'auto' && !autoConfirmed) return 'ask'
  return chosen
}

export function decideApproval(mode: PermissionMode, request: PermissionRequest, ctx: ApprovalContext): ApprovalDecision {
  if (request.kind === 'delete') return decideDelete(mode, request.paths ?? [], ctx)
  if (request.kind === 'edit') {
    if (mode === 'ask') return { action: 'ask', reason: 'Ask mode shows each diff before writing.' }
    return { action: 'allow', reason: 'Auto mode writes inside the project.' }
  }
  return decideCommand(mode, request.command ?? '', ctx)
}

export function permissionNeeded(
  mode: PermissionMode,
  allowed: ReadonlySet<string>,
  request: PermissionRequest,
  allowlist: ReadonlySet<string> = EMPTY,
  checkpointPaths: ReadonlySet<string> = EMPTY,
): boolean {
  return decideApproval(mode, request, { remembered: allowed, allowlist, checkpointPaths }).action === 'ask'
}

export function commandRisk(command: string): CommandRisk {
  const split = splitCommand(command)
  if (!split.ok) return 'invalid'
  const bin = baseName(split.argv[0] ?? '')
  const sub = split.argv[1] ?? ''
  if (DELETE_BINS.has(bin)) return 'destructive'
  if (bin === 'git' && (sub === 'clean' || sub === 'reset')) return 'destructive'
  if (bin === 'git' && (sub === 'push' || sub === 'clone' || sub === 'fetch' || sub === 'pull')) return 'network'
  if (NETWORK_BINS.has(bin)) return 'network'
  if (INSTALL_BINS.has(bin)) return 'install'
  if (bin === 'npx' || bin === 'uvx') return 'install'
  if (PM_BINS.has(bin) && INSTALL_SUBS.has(sub)) return 'install'
  if (bin === 'uv' && (sub === 'pip' || sub === 'add' || sub === 'sync' || sub === 'lock')) return 'install'
  if (bin === 'cargo' && (sub === 'install' || sub === 'publish')) return 'install'
  if (bin === 'go' && (sub === 'get' || sub === 'install')) return 'install'
  if ((bin === 'python' || bin === 'python3') && sub === '-m' && (split.argv[2] === 'pip' || split.argv[2] === 'ensurepip')) return 'install'
  return 'plain'
}

/** Positional paths of a delete command. Flags are skipped. Empty when it is not a delete. */
export function deleteTargets(command: string): string[] {
  const split = splitCommand(command)
  if (!split.ok) return []
  const bin = baseName(split.argv[0] ?? '')
  if (!DELETE_BINS.has(bin)) return []
  const paths: string[] = []
  for (const arg of split.argv.slice(1)) {
    if (arg.startsWith('-')) continue
    const norm = arg.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (norm) paths.push(norm)
  }
  return paths
}

function decideCommand(mode: PermissionMode, command: string, ctx: ApprovalContext): ApprovalDecision {
  const risk = commandRisk(command)
  if (risk === 'invalid') return { action: 'deny', reason: 'That command is not allowed to run.' }
  if (risk === 'destructive') return decideDelete(mode, deleteTargets(command), ctx)
  if (risk === 'install' || risk === 'network') {
    return { action: 'ask', reason: 'Install and network commands wait for approval.' }
  }
  const exact = exactCommand(command)
  if (mode === 'ask') {
    if (ctx.remembered.has(exact)) return { action: 'allow', reason: 'Remembered for this project.' }
    return { action: 'ask', reason: 'Ask mode runs commands only after approval.' }
  }
  if (ctx.allowlist.has(exact) || ctx.remembered.has(exact)) {
    return { action: 'allow', reason: 'On the command allowlist.' }
  }
  return { action: 'ask', reason: 'This command is not on the allowlist.' }
}

function decideDelete(_mode: PermissionMode, paths: readonly string[], ctx: ApprovalContext): ApprovalDecision {
  if (paths.length === 0) {
    return { action: 'ask', reason: 'Destructive commands wait for approval.' }
  }
  const outside = paths.filter((path) => !ctx.checkpointPaths.has(path))
  if (outside.length) {
    return { action: 'deny', reason: 'Refusing to delete a file outside this run\'s undo checkpoints.' }
  }
  return { action: 'ask', reason: 'Destructive commands wait for approval.' }
}

function baseName(file: string): string {
  return file.split(/[/\\]/).pop() ?? file
}
