/** Reddit and X stay out of search. They are not scraped and not official connectors. */

const BLOCKED = [
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)t\.co$/i,
]

export function blockedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return BLOCKED.some((re) => re.test(host))
  } catch {
    return true
  }
}

export function dropBlocked<T extends { url: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.url.startsWith('http') && !blockedHost(row.url))
}
