/**
 * Offline-only mode: the main process must not call the network.
 * TODO(Day 2): route every outbound fetch through this guard (web search lands Day 4).
 */
export class OfflineOnlyError extends Error {
  constructor() {
    super('Offline only is on, so Surf AI will not use the network.')
    this.name = 'OfflineOnlyError'
  }
}

export function assertNetworkAllowed(offlineOnly: boolean): void {
  if (offlineOnly) throw new OfflineOnlyError()
}
