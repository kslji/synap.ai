/**
 * GitHub remote/URL helpers, kept vscode-free so they can be unit-tested in
 * plain node. The GitHub command module imports these.
 */

/**
 * Parse an `owner/repo` slug from a git remote URL — SSH (`git@host:owner/repo.git`)
 * or HTTPS (`https://host/owner/repo.git`). Nested group paths keep only the last
 * two segments. Returns null when the URL has no recognisable owner/repo path.
 */
export function parseRepoSlug(remoteUrl: string): { owner: string; repo: string } | null {
  const url = (remoteUrl || '').trim();
  if (!url) {
    return null;
  }
  const cleaned = url.replace(/\.git$/i, '');
  if (!/[:/]/.test(cleaned)) {
    return null;
  }
  const parts = cleaned.split(/[:/]+/).filter(Boolean);
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  if (!owner || !repo || parts.length < 2) {
    return null;
  }
  return { owner, repo };
}

/** The GitHub "open a pull request" compare URL for a head branch against a base. */
export function compareUrl(slug: { owner: string; repo: string }, head: string, base: string): string {
  return `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}
