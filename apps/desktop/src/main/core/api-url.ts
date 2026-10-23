/**
 * Where the desktop sends platform API calls.
 *
 * The resolution rule is unchanged from the deleted dev web tooling: an explicit
 * SYNAP_API_URL wins, then the legacy base variables, then a loopback API for an
 * unpackaged development run, then the saved setting. Packaged builds never fall
 * back to localhost.
 */
export const DEV_API_PORT = 8000
export const DEV_API_URL = `http://127.0.0.1:${DEV_API_PORT}`

export type EnvLike = Record<string, string | undefined>

function cleanUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = cleanUrl(value)
  return /^https?:\/\/\S+$/.test(cleaned) ? cleaned : undefined
}

export function resolveSynapApiUrl(input: { packaged: boolean; settingsUrl: string; env?: EnvLike }): string {
  const env = input.env ?? process.env
  const explicit = httpUrl(env['SYNAP_API_URL'])
  const legacy = httpUrl(env['SURF_API_BASE'] || env['HARBOR_API_BASE'])
  const settings = cleanUrl(input.settingsUrl)
  if (input.packaged) return explicit || legacy || settings
  if (explicit) return explicit
  if (legacy) return legacy
  if (env['NODE_ENV'] === 'development') return DEV_API_URL
  return settings
}
