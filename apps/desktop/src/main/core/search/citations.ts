/** Web-derived answers keep a source marker. Pack citations keep the pack version. */

export function ensureCitationMarkers(answer: string, sources: { title: string; suspicious?: boolean }[]): string {
  const usable = sources.filter((source) => !source.suspicious && source.title)
  if (!usable.length || /\[S\d+\]/.test(answer)) return answer
  const lines = usable.slice(0, 8).map((source, index) => `[S${index + 1}] ${source.title}`)
  return `${answer.trim()}\n${lines.join('\n')}`
}

export function packVersionLine(entries: { pack: string; version?: string }[]): string {
  const rows = entries.filter((entry) => entry.version)
  if (!rows.length) return ''
  const unique = [...new Map(rows.map((entry) => [`${entry.pack}@${entry.version}`, entry])).values()]
  const parts = unique.map((entry) => (entry.pack.includes(entry.version as string) ? entry.pack : `${entry.pack} ${entry.version}`))
  return `Packs: ${parts.join(', ')}.`
}

export function withPackVersions(answer: string, entries: { pack: string; version?: string }[]): string {
  const line = packVersionLine(entries)
  if (!line || answer.includes(line)) return answer
  return `${answer.trim()}\n${line}`
}

export function citationProblems(answer: string, sources: { url?: string; title?: string }[]): string[] {
  const problems: string[] = []
  if (!/\[S\d+\]/.test(answer)) problems.push('missing marker')
  if (!sources.length) problems.push('no sources')
  return problems
}
