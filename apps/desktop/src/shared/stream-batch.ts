/**
 * Coalesce token and check-output updates so the UI paints in small batches.
 * The schedule is injected so tests do not need a browser frame.
 */

export function createTextBatch(limit = 48) {
  let pending = ''
  return {
    push(chunk: string): string | null {
      pending += chunk
      if (pending.length >= limit || chunk.includes('\n')) {
        const out = pending
        pending = ''
        return out
      }
      return null
    },
    flush(): string | null {
      if (!pending) return null
      const out = pending
      pending = ''
      return out
    },
  }
}

/** True when a check-output chunk is large enough to repaint the step. */
export function takeOutputUpdate(pending: string, chunk: string, limit = 80): { pending: string; emit: boolean } {
  const next = pending + chunk
  if (next.length >= limit || chunk.includes('\n')) return { pending: '', emit: true }
  return { pending: next, emit: false }
}

export interface FrameBatcher<T> {
  push(item: T): void
  flush(): void
  cancel(): void
}

export function createFrameBatcher<T>(
  apply: (items: T[]) => void,
  schedule: (fn: () => void) => number,
  cancelScheduled: (id: number) => void,
  immediate?: (item: T) => boolean,
): FrameBatcher<T> {
  let queue: T[] = []
  let id: number | null = null
  function flush(): void {
    if (id != null) {
      cancelScheduled(id)
      id = null
    }
    if (!queue.length) return
    const batch = queue
    queue = []
    apply(batch)
  }
  return {
    push(item: T) {
      queue.push(item)
      if (immediate?.(item)) {
        flush()
        return
      }
      if (id != null) return
      id = schedule(() => {
        id = null
        flush()
      })
    },
    flush,
    cancel() {
      queue = []
      if (id != null) cancelScheduled(id)
      id = null
    },
  }
}
