/**
 * Incremental index work runs one path at a time.
 * A search asked while that is going is handled before the next path.
 */

export class BackgroundIndex {
  private queue: string[] = []
  private urgent: Array<() => Promise<void>> = []
  private waiters: Array<() => void> = []
  private pumping = false

  constructor(
    private readonly indexOne: (path: string) => Promise<void>,
    private readonly onIdle?: () => void,
    private readonly onError?: (error: unknown) => void,
  ) {}

  enqueue(paths: readonly string[]): void {
    for (const path of paths) {
      if (path && !this.queue.includes(path)) this.queue.push(path)
    }
    this.kick()
  }

  /** Run `fn` before any path that has not started yet. */
  prioritize<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.pumping && this.queue.length === 0 && this.urgent.length === 0) return fn()
    return new Promise<T>((resolve, reject) => {
      this.urgent.push(async () => {
        try { resolve(await fn()) } catch (error) { reject(error) }
      })
      this.kick()
    })
  }

  whenIdle(): Promise<void> {
    if (!this.pumping && this.queue.length === 0 && this.urgent.length === 0) return Promise.resolve()
    return new Promise((resolve) => { this.waiters.push(resolve) })
  }

  private kick(): void {
    if (this.pumping) return
    this.pumping = true
    void this.pump()
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const job = this.urgent.shift()
        if (job) {
          await job()
          continue
        }
        const next = this.queue.shift()
        if (!next) return
        try {
          await this.indexOne(next)
        } catch (error) {
          this.onError?.(error)
        }
      }
    } finally {
      this.pumping = false
      if (this.queue.length || this.urgent.length) {
        this.kick()
        return
      }
      const waiters = this.waiters.splice(0)
      for (const waiter of waiters) waiter()
      this.onIdle?.()
    }
  }
}
