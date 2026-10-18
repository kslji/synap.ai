/** Virtual file-system — in-memory Map of path → content */
export interface VFile {
  path: string
  content: string
  originalContent: string   // content at last GitHub fetch
  language: string
  dirty: boolean
  sha?: string              // GitHub blob SHA (needed for updates)
}

export class VirtualFS {
  private files = new Map<string, VFile>()

  set(path: string, content: string, sha?: string): void {
    const existing = this.files.get(path)
    this.files.set(path, {
      path,
      content,
      originalContent: existing?.originalContent ?? content,
      language: langFromPath(path),
      dirty: existing ? existing.originalContent !== content : false,
      sha,
    })
  }

  get(path: string): VFile | undefined {
    return this.files.get(path)
  }

  edit(path: string, content: string): void {
    const f = this.files.get(path)
    if (!f) return
    f.content = content
    f.dirty = content !== f.originalContent
  }

  /** Mark saved — resets dirty flag + originalContent */
  markSaved(path: string): void {
    const f = this.files.get(path)
    if (!f) return
    f.originalContent = f.content
    f.dirty = false
  }

  dirtyFiles(): VFile[] {
    return [...this.files.values()].filter(f => f.dirty)
  }

  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  tree(): TreeNode[] {
    return buildTree(this.paths())
  }

  clear(): void {
    this.files.clear()
  }
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      let child = node.children!.find(c => c.name === part)
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          type: isLast ? 'file' : 'dir',
          children: isLast ? undefined : [],
        }
        node.children!.push(child)
      }
      node = child
    }
  }
  return root.children ?? []
}

function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    cpp: 'cpp', c: 'c', cs: 'csharp', rb: 'ruby', php: 'php',
    html: 'html', css: 'css', scss: 'scss', json: 'json',
    md: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', graphql: 'graphql',
    txt: 'plaintext',
  }
  return map[ext] ?? 'plaintext'
}
