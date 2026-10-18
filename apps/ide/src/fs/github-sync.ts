import { Octokit } from '@octokit/rest'
import type { VirtualFS } from './virtual-fs'

export interface GHRepo {
  owner: string
  name: string
  fullName: string
  description: string | null
  private: boolean
  language: string | null
  defaultBranch: string
  updatedAt: string | null
}

/** Fetch up to 100 repos for the authenticated user */
export async function fetchUserRepos(octokit: Octokit): Promise<GHRepo[]> {
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort: 'pushed',
    per_page: 100,
  })
  return data.map(r => ({
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description ?? null,
    private: r.private,
    language: r.language ?? null,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at ?? null,
  }))
}

/** Load entire repo tree (shallow — file list only, no content) */
export async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ path: string; sha: string }[]> {
  const { data } = await octokit.git.getTree({
    owner, repo,
    tree_sha: branch,
    recursive: '1',
  })
  return (data.tree ?? [])
    .filter(item => item.type === 'blob' && item.path && item.sha)
    .map(item => ({ path: item.path!, sha: item.sha! }))
}

/** Fetch a single file's content (base64 decoded) */
export async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<{ content: string; sha: string }> {
  const { data } = await octokit.repos.getContent({ owner, repo, path })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`${path} is not a file`)
  }
  const content = atob((data.content as string).replace(/\n/g, ''))
  return { content, sha: data.sha }
}

/** Load a repo into the virtual FS (fetches first 60 small text files eagerly) */
export async function loadRepoIntoFS(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  vfs: VirtualFS,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const TEXT_EXTS = new Set([
    'ts','tsx','js','jsx','py','rs','go','java','kt','c','cpp','cs','rb','php',
    'html','css','scss','json','md','yaml','yml','toml','sh','sql','graphql','txt','env',
  ])
  const MAX_EAGER = 60
  const items = await fetchRepoTree(octokit, owner, repo, branch)
  const textFiles = items.filter(item => {
    const ext = item.path.split('.').pop()?.toLowerCase() ?? ''
    return TEXT_EXTS.has(ext)
  })
  const eager = textFiles.slice(0, MAX_EAGER)
  let loaded = 0
  await Promise.all(
    eager.map(async item => {
      try {
        const { content, sha } = await fetchFileContent(octokit, owner, repo, item.path)
        vfs.set(item.path, content, sha)
      } catch {
        // Binary or too large — placeholder
        vfs.set(item.path, '', item.sha)
      } finally {
        loaded++
        onProgress?.(loaded, eager.length)
      }
    }),
  )
}

/** Commit all dirty files in the VFS to a new branch and open a PR */
export async function commitAndPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseBranch: string,
  newBranch: string,
  commitMessage: string,
  prTitle: string,
  prBody: string,
  vfs: VirtualFS,
): Promise<{ prUrl: string; branch: string }> {
  const dirty = vfs.dirtyFiles()
  if (!dirty.length) throw new Error('No changes to commit')

  // 1 — Get base commit SHA
  const { data: refData } = await octokit.git.getRef({
    owner, repo, ref: `heads/${baseBranch}`,
  })
  const baseSha = refData.object.sha

  // 2 — Get base tree SHA
  const { data: commitData } = await octokit.git.getCommit({
    owner, repo, commit_sha: baseSha,
  })
  const baseTreeSha = commitData.tree.sha

  // 3 — Create blobs
  const blobPromises = dirty.map(f =>
    octokit.git.createBlob({
      owner, repo,
      content: btoa(unescape(encodeURIComponent(f.content))),
      encoding: 'base64',
    }).then(r => ({ path: f.path, sha: r.data.sha })),
  )
  const blobs = await Promise.all(blobPromises)

  // 4 — Create tree
  const { data: newTree } = await octokit.git.createTree({
    owner, repo,
    base_tree: baseTreeSha,
    tree: blobs.map(b => ({
      path: b.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: b.sha,
    })),
  })

  // 5 — Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [baseSha],
  })

  // 6 — Create branch
  await octokit.git.createRef({
    owner, repo,
    ref: `refs/heads/${newBranch}`,
    sha: newCommit.sha,
  })

  // 7 — Open PR
  const { data: pr } = await octokit.pulls.create({
    owner, repo,
    title: prTitle,
    body: prBody,
    head: newBranch,
    base: baseBranch,
  })

  // 8 — Mark VFS files as saved
  for (const f of dirty) vfs.markSaved(f.path)

  return { prUrl: pr.html_url, branch: newBranch }
}
