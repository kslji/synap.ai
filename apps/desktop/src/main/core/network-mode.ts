/** Offline, Online, or Auto. Auto follows the operating system. Offline blocks every network call. */

export type NetworkMode = 'offline' | 'online' | 'auto'

export const REFRESH_WARN_MS = 7 * 24 * 60 * 60 * 1000

export const LOCAL_ONLY_NOTE =
  'This answer uses only sources on this computer. The network is off, so this reply did not search the web or refresh packs.'

/** An explicit mode wins. A settings file from before this choice maps offlineOnly true to Offline, and everything else to Auto. */
export function cleanNetworkMode(raw: unknown, legacyOfflineOnly?: boolean): NetworkMode {
  if (raw === 'offline' || raw === 'online' || raw === 'auto') return raw
  if (legacyOfflineOnly === true) return 'offline'
  return 'auto'
}

export function resolveNetworkMode(current: NetworkMode, patch: { networkMode?: NetworkMode; offlineOnly?: boolean }): NetworkMode {
  if (patch.networkMode === 'offline' || patch.networkMode === 'online' || patch.networkMode === 'auto') return patch.networkMode
  if (patch.offlineOnly === true) return 'offline'
  if (patch.offlineOnly === false && current === 'offline') return 'auto'
  return current
}

/** Offline always blocks. Online allows attempts. Auto blocks only while the operating system is offline. */
export function blocksNetwork(mode: NetworkMode, osOnline: boolean): boolean {
  if (mode === 'offline') return true
  if (mode === 'online') return false
  return osOnline === false
}

/** The refusal template already says the answer is from this computer. Leave that sentence unchanged. */
const ALREADY_LOCAL = /sources on this computer|Turn on web search when you are online/

export function withLocalOnlyNote(text: string, blocked: boolean): string {
  if (!blocked || !text || text.includes(LOCAL_ONLY_NOTE) || ALREADY_LOCAL.test(text)) return text
  return `${text}\n\n${LOCAL_ONLY_NOTE}`
}

/** Shown in Settings and the chip tooltip while the setting is Offline and the licence refresh date is near or past. */
export function licenceRefreshWarning(input: { mode: NetworkMode; refreshBy: string | null; now: number }): string | null {
  if (input.mode !== 'offline' || !input.refreshBy) return null
  const at = Date.parse(input.refreshBy)
  if (!Number.isFinite(at)) return null
  if (input.now > at) return 'This licence needs an online refresh. The refresh date has passed. Switch to Online or Auto in Settings when you can.'
  if (at - input.now <= REFRESH_WARN_MS) return 'This licence needs an online refresh soon. Switch to Online or Auto in Settings before the refresh date.'
  return null
}

export interface SyncChipInput {
  mode: NetworkMode
  osOnline: boolean
  syncing: boolean
  failed: boolean
  packVersion: string | null
  syncingVersion: string | null
  lastSyncAt: number | null
  refreshBy: string | null
  now: number
  /** Dev mode does not sync packs or refresh a licence. */
  devMode?: boolean
}

export interface SyncChipView {
  label: string
  state: 'uptodate' | 'syncing' | 'failed' | 'offline'
  mode: NetworkMode
  modeLabel: 'Offline' | 'Online' | 'Auto'
  packVersion: string | null
  lastSyncAt: number | null
  tooltip: string
  detail: string
  refreshWarning: string | null
  /** False in dev mode so the chip does not append Offline, Online, or Auto. */
  showMode: boolean
}

export function syncChip(input: SyncChipInput): SyncChipView {
  const modeLabel = input.mode === 'offline' ? 'Offline' : input.mode === 'online' ? 'Online' : 'Auto'
  if (input.devMode) {
    return {
      label: 'Dev mode, sync off',
      state: 'offline',
      mode: input.mode,
      modeLabel,
      packVersion: null,
      lastSyncAt: null,
      tooltip: 'Dev mode, sync off. Pack sync and licence refresh stay off until dev mode is turned off.',
      detail: 'Dev mode, sync off. Last sync: not yet',
      refreshWarning: null,
      showMode: false,
    }
  }
  const blocked = input.mode === 'offline' || (input.mode === 'auto' && input.osOnline === false)
  const version = input.syncing && input.syncingVersion ? input.syncingVersion : input.packVersion
  let label = 'Up to date'
  let state: SyncChipView['state'] = 'uptodate'
  if (blocked) {
    label = 'Offline'
    state = 'offline'
  } else if (input.syncing) {
    label = version ? `Syncing pack v${version}` : 'Syncing pack'
    state = 'syncing'
  } else if (input.failed) {
    label = 'Sync failed, will retry'
    state = 'failed'
  }
  const warning = licenceRefreshWarning({ mode: input.mode, refreshBy: input.refreshBy, now: input.now })
  const versionLine = version ? `Pack v${version}` : 'No pack installed'
  const when = input.lastSyncAt == null ? 'Last sync: not yet' : `Last sync: ${new Date(input.lastSyncAt).toISOString()}`
  const tooltip = [versionLine, when, warning].filter((line): line is string => Boolean(line)).join('\n')
  const detail = `${modeLabel}. ${label}. ${version ? `Pack v${version}.` : 'No pack installed.'} ${when}.`
  return {
    label,
    state,
    mode: input.mode,
    modeLabel,
    packVersion: version,
    lastSyncAt: input.lastSyncAt,
    tooltip,
    detail,
    refreshWarning: warning,
    showMode: true,
  }
}
