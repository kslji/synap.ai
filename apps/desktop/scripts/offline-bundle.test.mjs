import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assetFits, GITHUB_ASSET_LIMIT_BYTES } from './check-installer-size.mjs'

const require = createRequire(import.meta.url)
const registry = JSON.parse(readFileSync(fileURLToPath(new URL('../resources/models.registry.json', import.meta.url)), 'utf8'))
const model = registry.models.find((row) => row.id === 'qwen3.5-2b-q4_k_m')

test('the offline 2B file fits under GitHub’s 2 GiB asset limit', () => {
  assert.equal(model.size_bytes, 1_280_835_840)
  assert.equal(assetFits(model.size_bytes), true)
  assert.equal(assetFits(GITHUB_ASSET_LIMIT_BYTES), false)
  assert.equal(assetFits(GITHUB_ASSET_LIMIT_BYTES - 1), true)
  const headroom = GITHUB_ASSET_LIMIT_BYTES - model.size_bytes
  assert.ok(headroom > 500_000_000)
})

test('the offline build puts the model outside the asar', () => {
  process.env.SURF_BUNDLE_MODEL = '1'
  process.env.SURF_BUNDLE_MODEL_DIR = '/tmp/surf-bundle'
  process.env.SURF_SETUP_MARKER = '/tmp/surf-setup/setup-model.json'
  const configPath = fileURLToPath(new URL('../electron-builder.cjs', import.meta.url))
  delete require.cache[configPath]
  const config = require(configPath)
  const bundled = config.extraResources.find((item) => item.to === 'bundled-model')
  const marker = config.extraResources.find((item) => item.to === 'setup-model.json')
  assert.equal(bundled.from, '/tmp/surf-bundle')
  assert.equal(marker.to, 'setup-model.json')
  assert.match(config.artifactName, /offline-2b/)
  assert.equal(config.asar, true)
  assert.deepEqual(config.mac.target, [{ target: 'dmg', arch: ['arm64', 'x64'] }])
  assert.equal(JSON.stringify(config.files).includes('bundled-model'), false)
  delete process.env.SURF_BUNDLE_MODEL
  delete process.env.SURF_BUNDLE_MODEL_DIR
  delete process.env.SURF_SETUP_MARKER
  delete require.cache[configPath]
})

test('the Windows installer script names the three sizes and checks offline-2b first', () => {
  const script = readFileSync(fileURLToPath(new URL('../build/installer.nsh', import.meta.url)), 'utf8')
  const offline = script.indexOf('-offline-2b.exe')
  const two = script.indexOf('"-2b.exe"')
  assert.ok(offline > 0 && two > offline)
  assert.match(script, /qwen3\.5-2b-q4_k_m/)
  assert.match(script, /qwen3\.5-4b-q4_k_m/)
  assert.match(script, /qwen3\.5-9b-q4_k_m/)
  assert.match(script, /customInstall/)
  assert.doesNotMatch(script, /^\s*Function\b/m)
})
