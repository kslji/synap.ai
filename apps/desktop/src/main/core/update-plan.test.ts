import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseRelease, compareVersions, parseReleaseTag, planUpdate, type RemoteRelease } from './update-plan.js'

const dmg = (arch: string): RemoteRelease['assets'][number] => ({
  name: `SurfAI-0.2.0-${arch}.dmg`,
  url: `https://github.com/kslji/synap.ai/releases/download/v0.2.0/SurfAI-0.2.0-${arch}.dmg`,
})
const exe: RemoteRelease['assets'][number] = {
  name: 'SurfAI-0.2.0-x64.exe',
  url: 'https://github.com/kslji/synap.ai/releases/download/v0.2.0/SurfAI-0.2.0-x64.exe',
}

function release(tag: string, assets: RemoteRelease['assets']): RemoteRelease {
  const parsed = parseReleaseTag(tag)
  if (!parsed) throw new Error(tag)
  return { tag, version: parsed.version, prerelease: parsed.prerelease, notes: 'notes', assets }
}

test('versions put a release above a beta of the same numbers', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0') > 0, true)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.1') > 0, true)
  assert.equal(compareVersions('0.2.0', '0.2.0-beta.9') > 0, true)
  assert.equal(parseReleaseTag('v0.2.0-beta')?.prerelease, true)
  assert.equal(parseReleaseTag('v0.2.0')?.prerelease, false)
})

test('stable ignores a beta tag and the beta channel can take it', () => {
  const releases = [release('v0.2.0-beta.1', [dmg('arm64'), exe])]
  assert.equal(chooseRelease(releases, 'stable', '0.1.0'), null)
  assert.equal(chooseRelease(releases, 'beta', '0.1.0')?.version, '0.2.0-beta.1')
})

test('unsigned mac offers a disk image and windows uses NSIS', () => {
  const releases = [release('v0.2.0', [dmg('arm64'), dmg('x64'), exe, { name: 'latest.yml', url: 'https://example.invalid/latest.yml' }])]
  const mac = planUpdate({ releases, channel: 'stable', current: '0.1.0', platform: 'darwin', arch: 'arm64', macSigned: false })
  assert.equal(mac?.kind, 'manual')
  assert.match(mac?.url ?? '', /arm64\.dmg$/)
  assert.match(mac?.steps.join(' ') ?? '', /Open Anyway/)
  assert.match(mac?.steps.join(' ') ?? '', /\.dmg/)
  const win = planUpdate({ releases, channel: 'stable', current: '0.1.0', platform: 'win32', arch: 'x64', macSigned: false })
  assert.equal(win?.kind, 'nsis')
  assert.match(win?.url ?? '', /\.exe$/)
  const same = planUpdate({ releases, channel: 'stable', current: '0.2.0', platform: 'win32', arch: 'x64', macSigned: false })
  assert.equal(same, null)
  const signed = planUpdate({ releases, channel: 'stable', current: '0.1.0', platform: 'darwin', arch: 'x64', macSigned: true })
  assert.equal(signed?.kind, 'nsis')
  assert.match(signed?.url ?? '', /x64\.dmg$/)
})
