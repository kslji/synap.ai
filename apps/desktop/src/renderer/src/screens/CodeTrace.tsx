/** createElement keeps this renderable from the node unit test without a JSX transform. */
import { createElement, type ReactNode } from 'react'
import type { CodeDiffView, CodeStepView } from '../../../shared/ipc-contract'

const STEP_LABEL: Record<CodeStepView['status'], string> = {
  running: 'Running',
  ok: 'Done',
  error: 'Error',
  waiting: 'Needs approval',
  rejected: 'Rejected',
  applied: 'Applied',
}

export function CodeTrace({
  messageId,
  steps,
  diffs,
  onDecide,
}: {
  messageId: string
  steps: CodeStepView[]
  diffs: CodeDiffView[]
  onDecide?: (messageId: string, id: string, allow: boolean, remember?: boolean) => void
}) {
  if (!steps.length && !diffs.length) return null
  const blocks: ReactNode[] = []
  if (steps.length) {
    blocks.push(createElement('ol', { key: 'steps', className: 'flex flex-col gap-1', 'data-code-steps': 'yes' }, steps.map((step) => (
      createElement('li', {
        key: step.id,
        className: 'flex flex-wrap items-center gap-2 text-sm',
        'data-code-step': step.status,
        'data-code-tool': step.tool,
      }, [
        createElement('span', { key: 'title', className: 'min-w-0 flex-1' }, [
          createElement('span', { key: 'n', className: 'text-[var(--muted)]' }, `${step.index}. `),
          step.title,
          step.detail ? createElement('span', { key: 'detail', className: 'mt-0.5 block text-xs text-[var(--muted)]' }, step.detail) : null,
        ]),
        createElement('span', { key: 'status', className: 'pill shrink-0' }, STEP_LABEL[step.status]),
        step.status === 'waiting' && step.tool === 'run_command' && onDecide
          ? createElement('span', { key: 'ask', className: 'flex flex-wrap gap-1' }, [
            createElement('button', { key: 'allow', type: 'button', className: 'btn btn-primary', 'data-code-allow': 'yes', onClick: () => onDecide(messageId, step.id, true) }, 'Allow'),
            createElement('button', { key: 'always', type: 'button', className: 'btn btn-ghost', 'data-code-always': 'yes', onClick: () => onDecide(messageId, step.id, true, true) }, 'Always allow'),
            createElement('button', { key: 'deny', type: 'button', className: 'btn btn-ghost', 'data-code-deny': 'yes', onClick: () => onDecide(messageId, step.id, false) }, 'Deny'),
          ])
          : null,
      ])
    ))))
  }
  for (const diff of diffs) {
    blocks.push(createElement('article', { key: diff.id, className: 'card overflow-hidden', 'data-code-diff': diff.status }, [
      createElement('div', { key: 'head', className: 'flex items-center justify-between gap-2 px-3 py-2' }, [
        createElement('div', { key: 'path', className: 'min-w-0 truncate text-sm font-semibold' }, diff.path),
        diff.status === 'pending' && onDecide
          ? createElement('div', { key: 'actions', className: 'flex shrink-0 gap-1' }, [
            createElement('button', { key: 'apply', type: 'button', className: 'btn btn-primary', 'data-code-apply': 'yes', onClick: () => onDecide(messageId, diff.id, true) }, 'Apply'),
            createElement('button', { key: 'reject', type: 'button', className: 'btn btn-ghost', 'data-code-reject': 'yes', onClick: () => onDecide(messageId, diff.id, false) }, 'Reject'),
          ])
          : createElement('span', { key: 'state', className: 'pill shrink-0' }, diff.status),
      ]),
      createElement('pre', { key: 'body', className: 'max-h-64 overflow-auto px-3 py-2 text-xs leading-5' }, diff.diff.split('\n').map((line, i) => (
        createElement('div', { key: i, className: diffLineClass(line) }, line || ' ')
      ))),
    ]))
  }
  return createElement('div', { className: 'mt-3 flex flex-col gap-2', 'data-code-trace': 'yes' }, blocks)
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-[var(--accent-soft)]'
  if (line.startsWith('-') && !line.startsWith('---')) return 'opacity-70'
  return ''
}
