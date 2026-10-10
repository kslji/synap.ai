/**
 * Installers are unsigned unless the signing secrets in docs/RELEASE.md are set.
 * macOS disk images are separate arm64 and x64 builds, not one universal image:
 * a universal app would make every download carry both architectures.
 * Windows is a per-user NSIS installer and does not ask for an administrator.
 */
const signing = Boolean(process.env.CSC_LINK)

const config = {
  appId: 'ai.surf.desktop',
  productName: 'Surf AI',
  executableName: 'SurfAI',
  artifactName: 'SurfAI-${version}-${arch}.${ext}',
  directories: { buildResources: 'build', output: 'dist' },
  files: ['out/**', 'package.json', '!**/*.map'],
  asar: true,
  asarUnpack: [
    '**/*.node',
    'node_modules/sqlite-vec/**',
    'node_modules/sqlite-vec-*/**',
    'node_modules/tesseract.js/**',
    'node_modules/tesseract.js-core/**',
    'node_modules/pdfjs-dist/**',
    'node_modules/@napi-rs/canvas*/**',
    'out/main/ocr-runner.js',
  ],
  extraResources: [
    { from: 'resources/bin/${platform}-${arch}', to: 'bin' },
    { from: 'resources/models.registry.json', to: 'models.registry.json' },
    { from: 'resources/tessdata', to: 'tessdata' },
    { from: 'resources/pack-keys.json', to: 'pack-keys.json' },
    { from: 'resources/release-mode.json', to: 'release-mode.json' },
  ],
  npmRebuild: false,
  mac: {
    category: 'public.app-category.productivity',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    // null skips the Developer ID search. after-pack.cjs applies an ad-hoc signature.
    identity: signing ? undefined : null,
    hardenedRuntime: signing,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: signing && Boolean(process.env.APPLE_ID),
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: { target: ['AppImage'], category: 'Utility' },
  publish: {
    provider: 'github',
    owner: 'kslji',
    repo: 'synap.ai',
    releaseType: process.env.SURF_RELEASE_TYPE === 'prerelease' ? 'prerelease' : 'release',
  },
}

if (!signing) config.afterPack = 'scripts/after-pack.cjs'

module.exports = config
