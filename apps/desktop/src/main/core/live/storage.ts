/**
 * Disk totals for the Storage page, and a delete that refuses anything outside the app data directory.
 */
import { lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type StorageCategoryId = 'models' | 'packs' | 'indexes' | 'chats' | 'logs' | 'shots'

export interface StorageItem {
  id: string
  label: string
  bytes: number
  version?: string
}

export interface StorageCategory {
  id: StorageCategoryId
  label: string
  bytes: number
  items: StorageItem[]
}

export interface StorageReport {
  categories: StorageCategory[]
  totalBytes: number
  freeBytes: number
  diskBytes: number
}

/**
 * The cache lists the app screenshots folder only when that folder already has files.
 * A Save dialog writes to the path the user picked and is not copied here.
 */
export function includeScreenshotCache(fileCount: number): boolean {
  return fileCount > 0
}

/** True only for a file that already sits inside the app screenshots folder. */
export function screenshotBelongsInCache(savedPath: string, appDataDir: string): boolean {
  const rel = relative(resolve(appDataDir), resolve(savedPath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  const parts = rel.split(/[/\\]/).filter(Boolean)
  if (sep === '\\' && parts[0]?.includes(':')) return false
  return parts[0] === 'screenshots' && parts.length > 1
}

/** Models and chats are not cache. Clear must not delete them. */
export function storageClearAllowed(category: StorageCategoryId): boolean {
  return category !== 'models' && category !== 'chats'
}

export function sumBytes(items: readonly { bytes: number }[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.bytes), 0)
}

export function buildStorageReport(input: {
  categories: readonly StorageCategory[]
  freeBytes: number
  diskBytes: number
}): StorageReport {
  const categories = input.categories.map((category) => ({
    ...category,
    bytes: sumBytes(category.items),
    items: [...category.items],
  }))
  return {
    categories,
    totalBytes: sumBytes(categories),
    freeBytes: Math.max(0, input.freeBytes),
    diskBytes: Math.max(0, input.diskBytes),
  }
}

/**
 * Resolved path of `target` when it stays strictly inside `appDataDir`.
 * The app data directory itself is refused. Symlinks are resolved before the check.
 */
export function assertInsideAppData(appDataDir: string, target: string): string {
  const root = realpathSync(resolve(appDataDir))
  const abs = resolve(root, target)
  let real = abs
  try {
    real = realpathSync(abs)
  } catch {
    const parent = dirname(abs)
    try {
      real = join(realpathSync(parent), basename(abs))
    } catch {
      real = abs
    }
  }
  const rel = relative(root, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
    throw new Error('refusing to delete outside app data')
  }
  return real
}

/** Delete a file or folder only after `assertInsideAppData` accepts it. */
export function removeInside(appDataDir: string, target: string): void {
  const abs = assertInsideAppData(appDataDir, target)
  rmSync(abs, { recursive: true, force: true })
}

/** Byte size of a tree. Symlinks are counted as the link itself, not the outside target. */
export function treeBytes(root: string): number {
  let total = 0
  const walk = (dir: string): void => {
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      const path = join(dir, name)
      let st: ReturnType<typeof lstatSync>
      try { st = lstatSync(path) } catch { continue }
      if (st.isSymbolicLink()) {
        total += st.size
        continue
      }
      if (st.isDirectory()) walk(path)
      else total += st.size
    }
  }
  try {
    const st = lstatSync(root)
    if (!st.isDirectory()) return st.isSymbolicLink() ? st.size : st.size
  } catch {
    return 0
  }
  walk(root)
  return total
}

export function fileBytes(path: string): number {
  let total = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += statSync(path + suffix).size } catch { /* missing sidecar */ }
  }
  return total
}
