export function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`
  return `${Math.max(1, Math.round(n / 1_000_000))} MB`
}

export function tierLabel(tier: number): string {
  if (tier <= 0) return 'Under 8 GB'
  if (tier === 1) return '8 GB class'
  if (tier === 2) return '16 GB class'
  return '32 GB class'
}
