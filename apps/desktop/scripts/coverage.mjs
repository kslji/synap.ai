/**
 * Unit tests with a coverage floor on the Step 11 modules.
 * Node refuses these flags inside NODE_OPTIONS, so they are passed on the command.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const files = pkg.scripts['test:unit'].split(/\s+/).filter((part) => part.endsWith('.ts') || part.endsWith('.mjs'))
const args = [
  '--experimental-test-coverage',
  '--test-coverage-include=**/appearance.ts',
  '--test-coverage-include=**/benchmark-store.ts',
  '--test-coverage-include=**/metrics.ts',
  '--test-coverage-include=**/mascot.ts',
  '--test-coverage-lines=80',
  '--test-coverage-functions=75',
  '--test-coverage-branches=70',
  '--import', 'tsx',
  '--test',
  ...files,
]
const run = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })
process.exit(run.status ?? 1)
