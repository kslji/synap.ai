/**
 * Folder suggestions from names and metadata only.
 * Nothing here grants access, and nothing reads file contents.
 * macOS Desktop, Documents, and Downloads are not listed or stat'd:
 * opening them can raise a Files and Folders prompt. They are labelled
 * "needs permission" instead. The same is true for iCloud Drive and
 * external volumes, which can prompt for removable-volume access.
 */
import { readdirSync, statSync } from 'node:fs'
import { FILE_INDEX_TIME_NOTE, type FilePlaceKind, type FileSuggestFolder } from '../../../shared/ipc-contract.js'
import { isExcluded } from './exclusions.js'
import { joinPath, normalizePath, type PathStyle } from './paths.js'

export const INDEX_TIME_NOTE = FILE_INDEX_TIME_NOTE
export const MEASURE_CAP = 500
export const MEASURE_DEPTH = 2

const PROTECTED = new Set(['desktop', 'documents', 'downloads'])
const COMMON = /^(onedrive(?:\b.*)?|icloud drive|dropbox|google drive|projects|code|pictures|work)$/i
const BOOT_VOLUME = /^(macintosh hd|macintosh hd - data|recovery|com\.apple\.timemachine)/i
const ICLOUD = /^icloud drive$/i

export interface PlacesFs {
  list(dir: string): string[] | 'denied'
  stat(file: string): { isDirectory: boolean; size: number } | 'denied' | 'missing'
}

export interface SuggestPlacesInput {
  home: string
  style: PathStyle
  platform: string
  fs: PlacesFs
  measure?: boolean
}

type Place = Omit<FileSuggestFolder, 'granted'>

/** True when touching this path can raise a macOS protected-folder prompt. */
export function isPromptFolder(folder: string, home: string, style: PathStyle, platform: string): boolean {
  if (platform !== 'darwin') return false
  const norm = normalizePath(folder, style)
  const base = normalizePath(home, style)
  if (!base || (norm !== base && !norm.startsWith(`${base}/`))) return false
  if (norm === base) return false
  const first = norm.slice(base.length + 1).split('/')[0]?.toLowerCase() ?? ''
  return PROTECTED.has(first)
}

export function suggestPlaces(input: SuggestPlacesInput): Place[] {
  const { home, style, platform, fs } = input
  const measure = input.measure !== false
  const folders: Place[] = []
  const seen = new Set<string>()
  const homeNames = fs.list(home)

  const add = (place: Place) => {
    const key = normalizePath(place.path, style)
    if (!key || seen.has(key)) return
    seen.add(key)
    folders.push(place)
  }

  if (homeNames !== 'denied') {
    for (const name of homeNames) {
      if (!name || name.startsWith('.')) continue
      const full = joinPath(home, name, style)
      if (isExcluded(full, style)) continue
      const place = placeForChild(name, full, input, measure)
      if (place) add(place)
    }
  }

  if (platform === 'darwin') {
    for (const name of ['Desktop', 'Documents', 'Downloads']) {
      add(protectedPlace(name, joinPath(home, name, style)))
    }
    for (const name of listedOrEmpty(fs, '/Volumes')) {
      if (!name || name.startsWith('.') || BOOT_VOLUME.test(name)) continue
      const path = `/Volumes/${name}`
      add({
        id: `vol-${slug(name)}`,
        kind: 'drive',
        label: name,
        path,
        fileCount: null,
        byteSize: null,
        needsPermission: true,
        note: INDEX_TIME_NOTE,
      })
    }
  }

  if (style === 'win32') {
    const homeDrive = normalizePath(home, style).slice(0, 2)
    for (let code = 67; code <= 90; code += 1) {
      const letter = String.fromCharCode(code)
      if (`${letter.toLowerCase()}:` === homeDrive) continue
      const root = `${letter}:/`
      const info = fs.stat(root)
      if (info === 'missing') continue
      if (info === 'denied' || !info.isDirectory) {
        if (info === 'denied') {
          add({
            id: `drive-${letter.toLowerCase()}`,
            kind: 'drive',
            label: `${letter}:`,
            path: root,
            fileCount: null,
            byteSize: null,
            needsPermission: true,
            note: INDEX_TIME_NOTE,
          })
        }
        continue
      }
      const counted = measure ? measureFolder(root, input) : { fileCount: null, byteSize: null, needsPermission: false }
      add({
        id: `drive-${letter.toLowerCase()}`,
        kind: 'drive',
        label: `${letter}:`,
        path: root,
        fileCount: counted.fileCount,
        byteSize: counted.byteSize,
        needsPermission: counted.needsPermission,
        note: INDEX_TIME_NOTE,
      })
    }
  }

  const ranked = folders
    .filter((place) => place.kind !== 'drive')
    .sort((a, b) => (b.fileCount ?? -1) - (a.fileCount ?? -1) || (b.byteSize ?? -1) - (a.byteSize ?? -1) || a.label.localeCompare(b.label))
  const drives = folders.filter((place) => place.kind === 'drive')
  const homePlace: Place = {
    id: 'home',
    kind: 'home',
    label: 'Whole home folder',
    path: home,
    fileCount: null,
    byteSize: null,
    needsPermission: false,
    note: INDEX_TIME_NOTE,
  }
  return [...ranked, ...drives, homePlace]
}

export function livePlacesFs(home: string, style: PathStyle, platform: string): PlacesFs {
  return {
    list(dir) {
      if (isPromptFolder(dir, home, style, platform)) return 'denied'
      try { return readdirSync(dir) } catch { return 'denied' }
    },
    stat(file) {
      if (isPromptFolder(file, home, style, platform)) return 'denied'
      try {
        const info = statSync(file, { throwIfNoEntry: false })
        if (!info) return 'missing'
        return { isDirectory: info.isDirectory(), size: info.size }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'UNKNOWN') return 'missing'
        return 'denied'
      }
    },
  }
}

function placeForChild(name: string, full: string, input: SuggestPlacesInput, measure: boolean): Place | null {
  const guarded = isPromptFolder(full, input.home, input.style, input.platform) || (input.platform === 'darwin' && ICLOUD.test(name))
  if (guarded) return protectedPlace(name, full)
  const info = input.fs.stat(full)
  if (info === 'missing' || (info !== 'denied' && !info.isDirectory)) return null
  if (info === 'denied') {
    return {
      id: `folder-${slug(name)}`,
      kind: kindFor(name, false),
      label: `~/${name}`,
      path: full,
      fileCount: null,
      byteSize: null,
      needsPermission: true,
      note: null,
    }
  }
  const counted = measure ? measureFolder(full, input) : { fileCount: null, byteSize: null, needsPermission: false }
  return {
    id: `folder-${slug(name)}`,
    kind: kindFor(name, false),
    label: `~/${name}`,
    path: full,
    fileCount: counted.fileCount,
    byteSize: counted.byteSize,
    needsPermission: counted.needsPermission,
    note: null,
  }
}

function protectedPlace(name: string, full: string): Place {
  return {
    id: `protected-${slug(name)}`,
    kind: 'protected',
    label: `~/${name}`,
    path: full,
    fileCount: null,
    byteSize: null,
    needsPermission: true,
    note: null,
  }
}

function measureFolder(dir: string, input: SuggestPlacesInput): { fileCount: number | null; byteSize: number | null; needsPermission: boolean } {
  let fileCount = 0
  let byteSize = 0
  let seen = 0
  let denied = false
  const visit = (current: string, depth: number) => {
    if (seen >= MEASURE_CAP || depth > MEASURE_DEPTH) return
    if (isPromptFolder(current, input.home, input.style, input.platform)) {
      denied = true
      return
    }
    const names = input.fs.list(current)
    if (names === 'denied') {
      denied = true
      return
    }
    for (const name of names) {
      if (seen >= MEASURE_CAP) return
      if (!name || name.startsWith('.')) continue
      const full = joinPath(current, name, input.style)
      if (isExcluded(full, input.style) || isPromptFolder(full, input.home, input.style, input.platform)) continue
      seen += 1
      const info = input.fs.stat(full)
      if (info === 'missing') continue
      if (info === 'denied') {
        denied = true
        continue
      }
      if (info.isDirectory) {
        if (depth < MEASURE_DEPTH) visit(full, depth + 1)
        continue
      }
      fileCount += 1
      byteSize += Math.max(0, info.size)
    }
  }
  visit(dir, 0)
  if (denied && fileCount === 0) return { fileCount: null, byteSize: null, needsPermission: true }
  return { fileCount, byteSize, needsPermission: false }
}

function kindFor(name: string, guarded: boolean): FilePlaceKind {
  if (guarded) return 'protected'
  return COMMON.test(name) ? 'common' : 'folder'
}

function listedOrEmpty(fs: PlacesFs, dir: string): string[] {
  const names = fs.list(dir)
  return names === 'denied' ? [] : names
}

function slug(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return clean || 'folder'
}
