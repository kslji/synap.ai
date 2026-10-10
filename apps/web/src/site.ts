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
  { href: product.repo, label: 'GitHub' },
] as const

export const formRoles = ['code', 'testing', 'design', 'docs', 'niche pack', 'join the team'] as const

export interface ReleaseAsset {
  name: string
  url: string
}

export function detectClient(input: { ua: string; architecture?: string }): { os: 'mac' | 'windows' | 'other'; arch: 'arm64' | 'x64' } {
  const ua = input.ua
  const arch = /arm|aarch64/i.test(input.architecture ?? '') ? 'arm64' : ''
  if (/Windows/i.test(ua)) return { os: 'windows', arch: 'x64' }
  if (/Mac/i.test(ua)) {
    if (arch === 'arm64' || /ARM|aarch64/i.test(ua)) return { os: 'mac', arch: 'arm64' }
    return { os: 'mac', arch: 'x64' }
  }
  return { os: 'other', arch: 'x64' }
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
