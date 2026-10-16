/** The eval harness sets this so the beacon fixture still uses the local API. Production chat does not. */

export function searchFixtureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SURF_SEARCH_FIXTURE === '1'
}
