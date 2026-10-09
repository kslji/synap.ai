/**
 * Offline-only mode: the main process must not call the network.
 * Chat search, page fetch, device registration, and the health probe all call this first.
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
