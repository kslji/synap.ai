/**
 * Dev mode skips the licence screen, pack sync, and licence refresh.
 *
 * It is on until a release flag is set. Turn the licence gate back on with either:
 * - `SYNAP_DEV_MODE=0` for one launch, or
 * - `"release": true` in `resources/release-mode.json` (installers read this file), or
 * - `SYNAP_RELEASE=1` for one launch.
 *
 * `SYNAP_DEV_MODE=1` forces dev mode even when the release flag is set.
 * The licence checks in `licence.ts` stay in place. This flag only decides whether they run.
 */

export function readReleaseFlag(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  return (raw as { release?: unknown }).release === true
}

export function releaseFlagFromJson(text: string): boolean {
  try {
    return readReleaseFlag(JSON.parse(text) as unknown)
  } catch {
    return false
  }
}

/** True when this build should require a licence. */
export function releaseBuild(input: { fileFlag: boolean; envRelease: string | undefined }): boolean {
  return input.fileFlag || input.envRelease === '1'
}

/**
 * Default is on. `SYNAP_DEV_MODE=0` turns it off. `SYNAP_DEV_MODE=1` turns it on
 * even after the release flag is set.
 */
export function devModeEnabled(input: { envDev: string | undefined; release: boolean }): boolean {
  if (input.envDev === '0') return false
  if (input.envDev === '1') return true
  return input.release === false
}

/**
 * Dev mode blocks account calls that would reach synap.surf.
 * A loopback fixture, such as the eval harness, stays allowed.
 */
export function accountsBlocked(input: { devMode: boolean; apiBase: string }): boolean {
  return input.devMode && isSynapUrl(input.apiBase)
}

/** synap.surf and api.synap.surf. Other hosts, including GitHub, stay allowed. */
export function isSynapUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'synap.surf' || host.endsWith('.synap.surf')
  } catch {
    return false
  }
}

/** The public site home, where a model file is downloaded. Not the API, and not /buy. */
export function isModelSiteUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.hostname.toLowerCase() !== 'synap.surf') return false
    if (parsed.pathname !== '/' && parsed.pathname !== '') return false
    if (parsed.search) return false
    return parsed.hash === '' || parsed.hash === '#download'
  } catch {
    return false
  }
}
