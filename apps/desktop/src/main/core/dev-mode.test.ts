import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountsBlocked, devModeEnabled, isModelSiteUrl, isSynapUrl, readReleaseFlag, releaseBuild, releaseFlagFromJson } from './dev-mode.js'

test('dev mode stays on until the release flag, and SYNAP_DEV_MODE is the switch', () => {
  assert.equal(devModeEnabled({ envDev: undefined, release: false }), true)
  assert.equal(devModeEnabled({ envDev: '1', release: true }), true)
  assert.equal(devModeEnabled({ envDev: '0', release: false }), false)
  assert.equal(devModeEnabled({ envDev: undefined, release: true }), false)
  assert.equal(devModeEnabled({ envDev: '0', release: true }), false)
})

test('the release flag is the json field or SYNAP_RELEASE=1', () => {
  assert.equal(readReleaseFlag({ macSigned: false, release: false }), false)
  assert.equal(readReleaseFlag({ macSigned: false, release: true }), true)
  assert.equal(readReleaseFlag(null), false)
  assert.equal(releaseFlagFromJson('{ "release": true }'), true)
  assert.equal(releaseFlagFromJson('not json'), false)
  assert.equal(releaseBuild({ fileFlag: false, envRelease: undefined }), false)
  assert.equal(releaseBuild({ fileFlag: true, envRelease: undefined }), true)
  assert.equal(releaseBuild({ fileFlag: false, envRelease: '1' }), true)
})

test('dev mode blocks accounts only for synap.surf', () => {
  assert.equal(accountsBlocked({ devMode: true, apiBase: 'https://api.synap.surf' }), true)
  assert.equal(accountsBlocked({ devMode: true, apiBase: 'http://127.0.0.1:8765' }), false)
  assert.equal(accountsBlocked({ devMode: false, apiBase: 'https://api.synap.surf' }), false)
})

test('only synap.surf hosts count as site links', () => {
  assert.equal(isSynapUrl('https://synap.surf/buy'), true)
  assert.equal(isSynapUrl('https://api.synap.surf/v1/licences/refresh'), true)
  assert.equal(isSynapUrl('https://github.com/kslji/synap.ai'), false)
  assert.equal(isSynapUrl('https://synap.surf.example/buy'), false)
  assert.equal(isSynapUrl('not a url'), false)
})

test('dev mode can still open the model page on synap.surf', () => {
  assert.equal(isModelSiteUrl('https://synap.surf'), true)
  assert.equal(isModelSiteUrl('https://synap.surf/'), true)
  assert.equal(isModelSiteUrl('https://synap.surf/#download'), true)
  assert.equal(isModelSiteUrl('https://synap.surf/buy'), false)
  assert.equal(isModelSiteUrl('https://api.synap.surf/'), false)
  assert.equal(isModelSiteUrl('http://synap.surf/'), false)
})
