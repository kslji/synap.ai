/** Offline or Online. Offline blocks every network call. The old Auto mode (follow the connection) was removed. */

export type NetworkMode = 'offline' | 'online'

export const REFRESH_WARN_MS = 7 * 24 * 60 * 60 * 1000

export const LOCAL_ONLY_NOTE =
  'This answer uses only sources on this computer. The network is off, so this reply did not search the web or refresh packs.'

/** An explicit mode wins. A settings file from before this choice (including the removed Auto value) maps offlineOnly true to Offline, and everything else to Online. */
export function cleanNetworkMode(raw: unknown, legacyOfflineOnly?: boolean): NetworkMode {
  if (raw === 'offline' || raw === 'online') return raw
  if (legacyOfflineOnly === true) return 'offline'
  return 'online'
}

export function resolveNetworkMode(current: NetworkMode, patch: { networkMode?: NetworkMode; offlineOnly?: boolean }): NetworkMode {
  if (patch.networkMode === 'offline' || patch.networkMode === 'online') return patch.networkMode
  if (patch.offlineOnly === true) return 'offline'
  if (patch.offlineOnly === false && current === 'offline') return 'online'
  return current
}

/** Offline always blocks and makes zero network calls. Online allows attempts regardless of connection detection. */
export function blocksNetwork(mode: NetworkMode, osOnline: boolean): boolean {
  void osOnline
  return mode === 'offline'
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
  if (input.now > at) return 'This licence needs an online refresh. The refresh date has passed. Switch to Online in Settings when you can.'
  if (at - input.now <= REFRESH_WARN_MS) return 'This licence needs an online refresh soon. Switch to Online in Settings before the refresh date.'
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
  /** Dev mode still blocks pack sync and licence refresh. It does not replace the chip label. */
  devMode?: boolean
}

export interface SyncChipView {
  label: string
  state: 'uptodate' | 'syncing' | 'failed' | 'offline'
  mode: NetworkMode
  modeLabel: 'Offline' | 'Online'
  packVersion: string | null
  lastSyncAt: number | null
  tooltip: string
  detail: string
  refreshWarning: string | null
  /** The sidebar chip uses colour. Settings still reads the label and detail. */
  showMode: boolean
}

export function syncChip(input: SyncChipInput): SyncChipView {
  const modeLabel = input.mode === 'offline' ? 'Offline' : 'Online'
  const blocked = input.mode === 'offline'
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
  const warning = input.devMode ? null : licenceRefreshWarning({ mode: input.mode, refreshBy: input.refreshBy, now: input.now })
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
