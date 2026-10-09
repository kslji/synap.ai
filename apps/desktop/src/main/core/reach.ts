/** Connectivity label for the status pill. The probe itself lives in app services. */

export interface ReachInput {
  osOnline: boolean
  apiReachable: boolean
  offlineOnly: boolean
  checking: boolean
}

export function describeReach(input: ReachInput): { online: boolean; reason: string } {
  if (input.offlineOnly) return { online: false, reason: 'Offline only is on' }
  if (!input.osOnline) return { online: false, reason: 'No network' }
  if (input.checking) return { online: false, reason: 'Checking the connection' }
  if (!input.apiReachable) return { online: false, reason: 'Search service unreachable' }
  return { online: true, reason: 'Search service reachable' }
}
