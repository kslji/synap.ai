/** Short hardware labels for the settings card. The numbers are the measured values. */

export function cleanCpuName(raw: string): string {
  const cleaned = raw
    .replace(/\(r\)|\(tm\)|®|™/gi, ' ')
    .replace(/\s+@\s*[\d.]+\s*ghz\b/gi, ' ')
    .replace(/\b(cpu|processor)\b/gi, ' ')
    .replace(/\s+with\s+radeon\s+graphics\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || raw.trim()
}

export function formatRamGb(gb: number): string {
  const rounded = Math.round(gb * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} GB`
}

export function formatContextTokens(tokens: number): string {
  if (tokens > 0 && tokens % 1024 === 0) return `${tokens / 1024}K tokens`
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(tokens)} tokens`
}

export function formatPromptCache(mib: number): string {
  if (mib <= 0) return 'Off'
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(mib)} MB in RAM`
}
