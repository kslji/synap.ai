// The IDE extension ships to a GitHub Release, so its gateway default must be the
// production URL, never a dev box. baseUrl() prefers SURF_GATEWAY_BASE_URL, then the
// user's `surf.gatewayBaseUrl` setting, then the code fallback; the settings default
// lives in package.json. Both defaults must agree and must not be localhost, or a
// fresh install silently points users at an unreachable dev server.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../surf-ide/code-oss/extensions/surf-ai')
const PROD = 'https://api.synap.surf'

test('extension gateway default is the production API, in code and in settings', () => {
  const client = readFileSync(join(EXT, 'src/gateway-client.ts'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8'))

  // Code fallback in baseUrl().
  assert.match(client, new RegExp(`\\|\\| '${PROD}'`), 'gateway-client.ts fallback should be the prod URL')
  assert.doesNotMatch(client, /localhost:8000|127\.0\.0\.1:8000/, 'gateway-client.ts must not default to localhost')

  // Settings default in the extension manifest, and the two must agree.
  const setting = pkg.contributes?.configuration?.properties?.['surf.gatewayBaseUrl']
  assert.equal(setting?.default, PROD, 'surf.gatewayBaseUrl default should be the prod URL')
  assert.doesNotMatch(JSON.stringify(setting), /localhost/, 'surf.gatewayBaseUrl must not default to localhost')
})
