import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEV_API_URL, resolveSynapApiUrl } from './api-url.js'

const PRODUCTION = { NODE_ENV: 'production' }
const DEVELOPMENT = { NODE_ENV: 'development' }

// Ported from the deleted dev web tooling: the API base rule outlives web search.
test('SYNAP_API_URL defaults to localhost in dev and stays unused in packaged builds', () => {
  const settings = 'https://api.synap.surf'
  assert.equal(resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: DEVELOPMENT }), DEV_API_URL)
  assert.equal(resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: DEVELOPMENT }), settings)
  assert.equal(resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: PRODUCTION }), settings)
  assert.equal(
    resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: { ...PRODUCTION, SYNAP_API_URL: 'http://127.0.0.1:9000/' } }),
    'http://127.0.0.1:9000',
  )
  assert.equal(
    resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: { ...DEVELOPMENT, SURF_API_BASE: 'http://127.0.0.1:9' } }),
    'http://127.0.0.1:9',
  )
  assert.equal(resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: PRODUCTION }), settings)
})

test('the web search flag no longer chooses the API base', () => {
  const settings = 'https://api.synap.surf'
  assert.equal(resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: { ...PRODUCTION, SYNAP_DEV_WEB: '1' } }), settings)
})
