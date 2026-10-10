/**
 * Decide how an update is delivered.
 * Unsigned macOS cannot replace itself (Squirrel.Mac refuses an ad-hoc signature), so the app
 * hands the user a disk image. Unsigned Windows NSIS can install over the current app.
 * A tag that contains -beta is a prerelease. The stable channel ignores those.
 */

export type UpdateChannel = 'stable' | 'beta'
export type UpdateKind = 'nsis' | 'manual'

export interface ReleaseAsset {
  name: string
  url: string
}

export interface RemoteRelease {
  tag: string
  version: string
  prerelease: boolean
  notes: string
  assets: ReleaseAsset[]
}

export interface UpdateOffer {
  kind: UpdateKind
  version: string
  url: string
  notes: string
  steps: string[]
}

const MAC_STEPS = [
  'Download the new .dmg and open it.',
  'Drag Synap.surf to Applications. Replace the old app when asked.',
  'If macOS says the app is from an unidentified developer, open it once, then go to System Settings → Privacy & Security and click Open Anyway. You only need to do this once.',
]

export function parseReleaseTag(tag: string): { version: string; prerelease: boolean } | null {
  const match = /^v(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.]+))?$/.exec(tag.trim())
  if (!match) return null
  const prerelease = Boolean(match[2])
  return { version: prerelease ? `${match[1]}-${match[2]}` : match[1], prerelease }
}

/** Release builds sort above a prerelease of the same numbers. */
export function compareVersions(a: string, b: string): number {
  const weight = (v: string): number[] => {
    const [core, pre] = v.split('-')
    const nums = core.split('.').map((part) => Number(part) || 0)
    const preRank = pre ? (Number(pre.replace(/\D/g, '')) || 0) : 1_000_000
    return [...nums, preRank]
  }
  const left = weight(a)
  const right = weight(b)
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i++) {
    const d = (left[i] ?? 0) - (right[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function chooseRelease(releases: RemoteRelease[], channel: UpdateChannel, current: string): RemoteRelease | null {
  const eligible = releases.filter((release) => channel === 'beta' || !release.prerelease)
  for (const release of eligible) {
    if (compareVersions(release.version, current) > 0) return release
  }
  return null
}

export function pickAsset(assets: ReleaseAsset[], platform: 'darwin' | 'win32' | 'linux', arch: string): ReleaseAsset | null {
  const wantArch = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') {
    return assets.find((asset) => asset.name.endsWith('.dmg') && asset.name.includes(wantArch)) ?? null
  }
  if (platform === 'win32') {
    return assets.find((asset) => asset.name.endsWith('.exe') && asset.name.includes('x64') && !asset.name.endsWith('.blockmap')) ?? null
  }
  return null
}

export function planUpdate(opts: {
  releases: RemoteRelease[]
  channel: UpdateChannel
  current: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  /** True only when the Mac build was signed with a Developer ID. Ad-hoc is not enough. */
  macSigned: boolean
}): UpdateOffer | null {
  const release = chooseRelease(opts.releases, opts.channel, opts.current)
  if (!release) return null
  const asset = pickAsset(release.assets, opts.platform, opts.arch)
  if (!asset) return null
  if (opts.platform === 'win32') {
    return {
      kind: 'nsis',
      version: release.version,
      url: asset.url,
      notes: release.notes,
      steps: ['Surf downloads the installer and replaces this copy. Windows may show “Unknown publisher” once.'],
    }
  }
  if (opts.platform === 'darwin' && opts.macSigned) {
    return { kind: 'nsis', version: release.version, url: asset.url, notes: release.notes, steps: [] }
  }
  if (opts.platform === 'darwin') {
    return { kind: 'manual', version: release.version, url: asset.url, notes: release.notes, steps: MAC_STEPS }
  }
  return null
}
