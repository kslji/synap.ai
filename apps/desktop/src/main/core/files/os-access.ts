/**
 * Plain explanations when the operating system refuses a folder.
 * macOS: Files and Folders (TCC) for Desktop, Documents, and Downloads, plus optional Full Disk Access.
 * Windows: ACLs and Controlled folder access.
 * The deep links open System Settings. They do not grant anything by themselves.
 */

export type OsDenialKind = 'macos-files-and-folders' | 'macos-full-disk' | 'windows-acl' | 'windows-controlled-folder'

export interface OsDenial {
  kind: OsDenialKind
  message: string
  settingsUrl: string
  settingsLabel: string
}

const MAC_FILES = 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders'
const MAC_DISK = 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles'
const WIN_DEFENDER = 'ms-settings:windowsdefender'

export function isMacProtectedFolder(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase()
  return /\/(desktop|documents|downloads)(\/|$)/.test(norm)
}

export function classifyAccessError(error: unknown, filePath: string, platform: string): OsDenial | null {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()
  const denied = code === 'EPERM' || code === 'EACCES' || lower.includes('operation not permitted') || lower.includes('permission denied') || lower.includes('access is denied')
  if (!denied && !lower.includes('controlled folder')) return null
  if (platform === 'win32') {
    if (lower.includes('controlled folder') || lower.includes('ransomware')) {
      return {
        kind: 'windows-controlled-folder',
        message: 'Windows Controlled folder access blocked Synap.surf. Allow the app under Windows Security, Virus & threat protection, Manage ransomware protection. Your files were not changed.',
        settingsUrl: WIN_DEFENDER,
        settingsLabel: 'Open Windows Security',
      }
    }
    return {
      kind: 'windows-acl',
      message: 'Windows denied access to this folder. Check the folder Security permissions. If Controlled folder access is on, allow Synap.surf under Windows Security, Virus & threat protection, Ransomware protection. Nothing was changed.',
      settingsUrl: WIN_DEFENDER,
      settingsLabel: 'Open Windows Security',
    }
  }
  if (platform === 'darwin') {
    if (isMacProtectedFolder(filePath)) {
      return {
        kind: 'macos-files-and-folders',
        message: 'macOS blocked Synap.surf from this folder. Open System Settings, Privacy & Security, Files and Folders, and allow Synap.surf for Desktop, Documents, or Downloads. Nothing was read.',
        settingsUrl: MAC_FILES,
        settingsLabel: 'Open Files and Folders',
      }
    }
    return {
      kind: 'macos-full-disk',
      message: 'macOS blocked this location. Desktop, Documents, and Downloads use Files and Folders. Other protected locations can need Full Disk Access under Privacy & Security. Ordinary folders do not need Full Disk Access. Nothing was read.',
      settingsUrl: MAC_DISK,
      settingsLabel: 'Open Full Disk Access',
    }
  }
  if (denied) {
    return {
      kind: 'windows-acl',
      message: 'The operating system denied access to this folder. Nothing was read.',
      settingsUrl: platform === 'win32' ? WIN_DEFENDER : MAC_FILES,
      settingsLabel: 'Open system settings',
    }
  }
  return null
}

export function denialFromMessage(message: string): OsDenial | null {
  if (message.includes('Files and Folders')) return classifyAccessError(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }), '/Users/me/Documents', 'darwin')
  if (message.includes('Full Disk Access')) return classifyAccessError(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }), '/Users/me/secret', 'darwin')
  if (message.includes('Controlled folder access')) return classifyAccessError(new Error('Controlled folder access blocked the folder'), 'C:\\Users\\me\\Documents', 'win32')
  if (message.includes('Windows denied')) return classifyAccessError(Object.assign(new Error('access is denied'), { code: 'EACCES' }), 'C:\\Users\\me\\Documents', 'win32')
  return null
}

export function settingsLink(kind: OsDenialKind): string {
  if (kind === 'macos-files-and-folders') return MAC_FILES
  if (kind === 'macos-full-disk') return MAC_DISK
  return WIN_DEFENDER
}
