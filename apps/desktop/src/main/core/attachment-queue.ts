/** One background indexing job at a time. Chat IPC returns before this finishes. */
import type { DB } from './db.js'
import { claimNext, hasQueued, requeueInterrupted } from './library-store.js'
import { publish, runClaimedJob, type IngestDeps } from './ingest.js'

export class AttachmentQueue {
  private busy = false

  constructor(private readonly deps: IngestDeps) {
    requeueInterrupted(deps.db)
  }

  get db(): DB {
    return this.deps.db
  }

  kick(): void {
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      for (;;) {
        const job = claimNext(this.deps.db)
        if (!job) return
        publish(this.deps, job.attachmentId)
        await runClaimedJob(this.deps, job)
      }
    } finally {
      this.busy = false
      if (hasQueued(this.deps.db)) this.kick()
    }
  }
}
