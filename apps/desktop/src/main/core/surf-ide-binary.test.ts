import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSurfIdeBinary, surfIdeAppName } from './surf-ide-binary.js'

// A fake fs that reports the given paths as present, so both platforms resolve
// without touching a real disk.
function existsSet(present: string[]): (p: string) => boolean {
  const set = new Set(present)
  return (p: string) => set.has(p)
}

test('app name falls back to Surf IDE unless product.json sets one', () => {
  assert.equal(surfIdeAppName(undefined), 'Surf IDE')
  assert.equal(surfIdeAppName('   '), 'Surf IDE')
  assert.equal(surfIdeAppName('Surf Studio'), 'Surf Studio')
})

test('macOS prefers resourcesPath, then the fork .build, then /Applications', () => {
  const forkRoot = '/Users/dev/surf.ai/surf-ide/code-oss'
  // resourcesPath bundle wins when it exists.
  const rp = '/App.app/Contents/Resources/Surf IDE.app/Contents/MacOS/Surf IDE'
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'darwin',
      env: {},
      resourcesPath: '/App.app/Contents/Resources',
      exists: existsSet([rp, `${forkRoot}/.build/darwin/Surf IDE.app/Contents/MacOS/Surf IDE`]),
    }),
    rp,
  )
  // Without resourcesPath (dev), the .build/darwin bundle is next.
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'darwin',
      env: {},
      exists: existsSet([`${forkRoot}/.build/darwin/Surf IDE.app/Contents/MacOS/Surf IDE`]),
    }),
    `${forkRoot}/.build/darwin/Surf IDE.app/Contents/MacOS/Surf IDE`,
  )
  // arm64-specific build is a valid fallback too.
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'darwin',
      env: {},
      exists: existsSet([`${forkRoot}/.build/darwin-arm64/Surf IDE.app/Contents/MacOS/Surf IDE`]),
    }),
    `${forkRoot}/.build/darwin-arm64/Surf IDE.app/Contents/MacOS/Surf IDE`,
  )
  // Installed copy is reached when nothing nearer exists.
  assert.equal(
    resolveSurfIdeBinary({ forkRoot, platform: 'darwin', env: {}, exists: existsSet(['/Applications/Surf IDE.app/Contents/MacOS/Surf IDE']) }),
    '/Applications/Surf IDE.app/Contents/MacOS/Surf IDE',
  )
})

test('windows resolves resourcesPath, .build win32-x64, then LOCALAPPDATA', () => {
  const forkRoot = 'C:\\dev\\surf.ai\\surf-ide\\code-oss'
  const rp = 'C:\\Packaged\\resources\\Surf IDE\\Surf IDE.exe'
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'win32',
      env: {},
      resourcesPath: 'C:\\Packaged\\resources',
      exists: existsSet([rp]),
    }),
    rp,
  )
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'win32',
      env: {},
      exists: existsSet([`${forkRoot}\\.build\\win32-x64\\Surf IDE\\Surf IDE.exe`]),
    }),
    `${forkRoot}\\.build\\win32-x64\\Surf IDE\\Surf IDE.exe`,
  )
  assert.equal(
    resolveSurfIdeBinary({
      forkRoot,
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
      exists: existsSet(['C:\\Users\\dev\\AppData\\Local\\Programs\\Surf IDE\\Surf IDE.exe']),
    }),
    'C:\\Users\\dev\\AppData\\Local\\Programs\\Surf IDE\\Surf IDE.exe',
  )
})

test('unsupported platforms and missing binaries resolve to null (dev launcher)', () => {
  assert.equal(
    resolveSurfIdeBinary({ forkRoot: '/ws', platform: 'linux', env: {}, exists: () => true }),
    null,
  )
  assert.equal(
    resolveSurfIdeBinary({ forkRoot: '/ws', platform: 'darwin', env: {}, exists: () => false }),
    null,
  )
  assert.equal(
    resolveSurfIdeBinary({ forkRoot: 'C:\\ws', platform: 'win32', env: {}, exists: () => false }),
    null,
  )
})
