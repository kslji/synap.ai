/** One in-flight completion per editor. A new keystroke drops the previous wait and the model call. */

export const COMPLETION_DEBOUNCE_MS = 200

export interface TimerApi {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class LatestCall {
  private generation = 0
  private timer: unknown = null
  private abort: AbortController | null = null
  private settle: (() => void) | null = null

  constructor(private readonly waitMs: number, private readonly timers: TimerApi = realTimers) {}

  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    const generation = ++this.generation
    this.finishWaiting()
    const abort = new AbortController()
    this.abort = abort
    return new Promise((resolve, reject) => {
      this.settle = () => resolve(null)
      this.timer = this.timers.set(() => {
        this.timer = null
        this.settle = null
        task(abort.signal).then(
          (value) => {
            if (generation !== this.generation || abort.signal.aborted) resolve(null)
            else resolve(value)
          },
          (error: unknown) => {
            if (generation !== this.generation || abort.signal.aborted || isAbortError(error)) resolve(null)
            else reject(error)
          },
        )
      }, this.waitMs)
    })
  }

  cancel(): void {
    this.generation++
    this.finishWaiting()
  }

  private finishWaiting(): void {
    if (this.timer != null) {
      this.timers.clear(this.timer)
      this.timer = null
    }
    this.abort?.abort()
    this.abort = null
    const settle = this.settle
    this.settle = null
    settle?.()
  }
}
