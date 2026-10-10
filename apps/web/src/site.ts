import { product } from '@surf/shared'

/** The only contact address. Set SITE_CONTACT_EMAIL when building the site. */
export function contactEmail(value = import.meta.env.SITE_CONTACT_EMAIL): string {
  const trimmed = (value ?? '').trim()
  return trimmed || 'contact@example.com'
}

/** Web3Forms access key. Empty means the contribute page uses mailto. */
export function formKey(value = import.meta.env.SITE_FORM_KEY): string {
  return (value ?? '').trim()
}

export const footerLinks = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/security', label: 'Security' },
  { href: '/contribute', label: 'Contribute' },
  { href: '/terms', label: 'Terms' },
  { href: product.repo, label: 'GitHub' },
] as const

export const formRoles = ['code', 'testing', 'design', 'docs', 'niche pack', 'join the team'] as const

export interface ReleaseAsset {
  name: string
  url: string
}

export interface ReleaseListItem {
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{ name?: string; browser_download_url?: string }>
}

/** Direct installer URLs for the current beta. Used when the releases API is down or rate-limited. */
export const BUNDLED_ASSETS: ReleaseAsset[] = [
  { name: 'Synap.surf-0.1.0-arm64.dmg', url: 'https://github.com/kslji/synap.ai/releases/download/v0.1.0-beta/Synap.surf-0.1.0-arm64.dmg' },
  { name: 'Synap.surf-0.1.0-x64.dmg', url: 'https://github.com/kslji/synap.ai/releases/download/v0.1.0-beta/Synap.surf-0.1.0-x64.dmg' },
  { name: 'Synap.surf-0.1.0-x64.exe', url: 'https://github.com/kslji/synap.ai/releases/download/v0.1.0-beta/Synap.surf-0.1.0-x64.exe' },
]

/** The only link that opens the releases index. Download buttons never use it. */
export const ALL_DOWNLOADS_URL = 'https://github.com/kslji/synap.ai/releases'

/** First non-draft release, including prereleases. GitHub's /releases/latest skips those. */
export function newestPublishableRelease(releases: ReleaseListItem[]): ReleaseListItem | null {
  for (const release of releases) {
    if (!release || release.draft) continue
    return release
  }
  return null
}

export function releaseAssets(release: ReleaseListItem | null | undefined): ReleaseAsset[] {
  return (release?.assets ?? [])
    .filter((asset) => asset.name && asset.browser_download_url)
    .map((asset) => ({ name: asset.name as string, url: asset.browser_download_url as string }))
}

export function detectClient(input: { ua: string; architecture?: string; renderer?: string }): { os: 'mac' | 'windows' | 'other'; arch: 'arm64' | 'x64' } {
  const ua = input.ua
  if (/Windows/i.test(ua)) return { os: 'windows', arch: 'x64' }
  if (/Mac|Macintosh/i.test(ua)) {
    const hint = `${input.architecture ?? ''} ${input.renderer ?? ''}`
    if (/arm|aarch64|Apple\s*M\d|Apple GPU/i.test(hint)) return { os: 'mac', arch: 'arm64' }
    if (/\b(x86_64|amd64|x64)\b/i.test(input.architecture ?? '') || /Intel/i.test(input.renderer ?? '')) return { os: 'mac', arch: 'x64' }
    return { os: 'mac', arch: 'arm64' }
  }
  return { os: 'other', arch: 'x64' }
}

export function downloadHrefs(assets: ReleaseAsset[], os: 'mac' | 'windows' | 'other', arch: 'arm64' | 'x64'): { mac: string; win: string; intel: string } {
  const pool = assets.length ? assets : BUNDLED_ASSETS
  const macArch = os === 'mac' ? arch : 'arm64'
  const mac = pickDownload(pool, 'mac', macArch)?.url ?? pickDownload(BUNDLED_ASSETS, 'mac', macArch)?.url ?? ''
  const win = pickDownload(pool, 'windows', 'x64')?.url ?? pickDownload(BUNDLED_ASSETS, 'windows', 'x64')?.url ?? ''
  const intel = pickDownload(pool, 'mac', 'x64')?.url ?? pickDownload(BUNDLED_ASSETS, 'mac', 'x64')?.url ?? ''
  return { mac, win, intel }
}

export function pickDownload(assets: ReleaseAsset[], os: 'mac' | 'windows' | 'other', arch: 'arm64' | 'x64'): ReleaseAsset | null {
  if (os === 'other') return null
  const ext = os === 'mac' ? '.dmg' : '.exe'
  const token = os === 'windows' ? 'x64' : arch
  return assets.find((asset) => asset.name.endsWith(ext) && asset.name.includes(token) && !asset.name.endsWith('.blockmap')) ?? null
}

export function allowSubmit(now: number, last: number | null, minGapMs = 30_000): boolean {
  if (last == null) return true
  return now - last >= minGapMs
}

export const DRAFT = 'Draft — not legal advice.'
