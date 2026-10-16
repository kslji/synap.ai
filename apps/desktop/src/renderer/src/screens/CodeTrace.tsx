/** createElement keeps this renderable from the node unit test without a JSX transform. */
import { createElement, useState, type ReactNode } from 'react'
import type { CodeDiffView, CodePlanView, CodeStepView } from '../../../shared/ipc-contract'

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
  plan,
  onDecide,
  onRevise,
  onUndo,
}: {
  messageId: string
  steps: CodeStepView[]
  diffs: CodeDiffView[]
  plan?: CodePlanView | null
  onDecide?: (messageId: string, id: string, allow: boolean, remember?: boolean) => void
  onRevise?: (messageId: string, order: string[]) => void
  onUndo?: (messageId: string, stepId: string) => void
}) {
  const [draft, setDraft] = useState<string[]>(() => plan?.steps.map((step) => step.id) ?? [])
  const [removed, setRemoved] = useState<string[]>([])
  const [restored, setRestored] = useState<string[]>([])
  if (!steps.length && !diffs.length && !plan?.steps.length) return null
  const blocks: ReactNode[] = []
  if (plan?.steps.length) {
    const reviewing = plan.status === 'review'
    const visible = reviewing
      ? draft.filter((id) => !removed.includes(id)).map((id) => plan.steps.find((step) => step.id === id)).filter((step): step is CodePlanView['steps'][number] => Boolean(step))
      : plan.steps
    blocks.push(createElement('section', { key: 'plan', className: 'card px-3 py-2', 'data-code-plan': plan.status }, [
      createElement('div', { key: 'label', className: 'text-xs text-[var(--muted)]' }, reviewing ? 'Checklist — reorder or remove steps, then run' : 'Checklist'),
      createElement('ol', { key: 'items', className: 'mt-1 flex flex-col gap-1' }, visible.map((step, index) => (
        createElement('li', { key: step.id, className: 'flex flex-wrap items-center gap-2 text-sm', 'data-code-plan-step': step.id }, [
          createElement('span', { key: 'goal', className: 'min-w-0 flex-1' }, [
            createElement('span', { key: 'n', className: 'text-[var(--muted)]' }, `${index + 1}. `),
            step.goal,
            createElement('span', { key: 'meta', className: 'mt-0.5 block text-xs text-[var(--muted)]' }, [
              step.files.join(', ') || 'new file',
              step.symbols.length ? ` · ${step.symbols.join(', ')}` : '',
              step.dependsOn.length ? ` · after ${step.dependsOn.join(', ')}` : '',
              ` · ${step.check}`,
            ].join('')),
          ]),
          reviewing && onRevise
            ? createElement('span', { key: 'move', className: 'flex shrink-0 gap-1' }, [
              createElement('button', { key: 'up', type: 'button', className: 'btn btn-ghost', 'data-code-plan-up': step.id, onClick: () => moveDraft(step.id, -1, draft, removed, setDraft) }, 'Up'),
              createElement('button', { key: 'down', type: 'button', className: 'btn btn-ghost', 'data-code-plan-down': step.id, onClick: () => moveDraft(step.id, 1, draft, removed, setDraft) }, 'Down'),
              createElement('button', { key: 'remove', type: 'button', className: 'btn btn-ghost', 'data-code-plan-remove': step.id, onClick: () => setRemoved((prev) => prev.includes(step.id) ? prev : [...prev, step.id]) }, 'Remove'),
            ])
            : null,
          !reviewing && plan.undos?.some((undo) => undo.stepId === step.id) && onUndo
            ? createElement('button', {
              key: 'undo',
              type: 'button',
              className: 'btn btn-ghost',
              'data-code-undo': step.id,
              onClick: () => { setRestored((prev) => prev.includes(step.id) ? prev : [...prev, step.id]); onUndo(messageId, step.id) },
            }, restored.includes(step.id) ? 'Restored' : 'Undo')
            : null,
        ])
      ))),
      reviewing && onRevise
        ? createElement('button', {
          key: 'run',
          type: 'button',
          className: 'btn btn-primary mt-2',
          'data-code-plan-run': 'yes',
          onClick: () => onRevise(messageId, draft.filter((id) => !removed.includes(id))),
        }, 'Run')
        : null,
    ]))
  }
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

function moveDraft(id: string, dir: -1 | 1, draft: string[], removed: string[], setDraft: (order: string[]) => void): void {
  const next = draft.filter((item) => !removed.includes(item))
  const index = next.indexOf(id)
  const swap = index + dir
  if (index < 0 || swap < 0 || swap >= next.length) return
  const copy = [...next]
  const current = copy[index]
  const other = copy[swap]
  if (current === undefined || other === undefined) return
  copy[index] = other
  copy[swap] = current
  setDraft(copy)
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-[var(--accent-soft)]'
  if (line.startsWith('-') && !line.startsWith('---')) return 'opacity-70'
  return ''
}
