import { watch, type FSWatcher } from 'node:fs'
import { relative, sep } from 'node:path'

/** Coalesce file-watcher noise so a save does not re-index once per event. */
export function watchProject(root: string, onChange: (rels: string[]) => void, debounceMs = 400): { close(): void } {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const raw = String(filename)
      const rel = raw.startsWith(root) ? relative(root, raw) : raw
      const posix = rel.split(sep).join('/')
      if (!posix || posix.startsWith('..') || posix.includes('/.git/') || posix.startsWith('.git/')) return
      pending.add(posix)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const batch = [...pending]
        pending.clear()
        timer = null
        if (batch.length) onChange(batch)
      }, debounceMs)
    })
  } catch {
    return { close() { if (timer) clearTimeout(timer) } }
  }
  return {
    close() {
      if (timer) clearTimeout(timer)
      watcher.close()
    },
  }
}
