/**
 * Installers are unsigned unless the signing secrets in docs/RELEASE.md are set.
 * macOS disk images are separate arm64 and x64 builds, not one universal image:
 * a universal app would make every download carry both architectures.
 * Windows is a per-user NSIS installer and does not ask for an administrator.
 *
 * The filename must be electron-builder.cjs. electron-builder only auto-loads
 * electron-builder.{yml,yaml,json,json5,toml,js,cjs,ts}. The dist scripts also
 * pass --config so a package.json "build" key is not required.
 *
 * productName is the display name (Synap.surf). executableName has no dot,
 * because a Windows binary named Synap.surf.exe is treated as a .surf file.
 */
const signing = Boolean(process.env.CSC_LINK)

const config = {
  appId: 'ai.surf.desktop',
  productName: 'Synap.surf',
  executableName: 'SynapSurf',
  artifactName: 'Synap.surf-${version}-${arch}.${ext}',
  directories: { buildResources: 'build', output: 'dist' },
  files: ['out/**', 'package.json', '!**/*.map', '!**/*.mp4', '!animation/**'],
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
    'node_modules/web-tree-sitter/**/*.wasm',
  ],
  extraResources: [
    { from: 'resources/bin/${platform}-${arch}', to: 'bin' },
    { from: 'resources/whisper/${platform}-${arch}', to: 'whisper' },
    { from: 'resources/tree-sitter', to: 'tree-sitter' },
    { from: 'resources/models.registry.json', to: 'models.registry.json' },
    { from: 'resources/tessdata', to: 'tessdata' },
    { from: 'resources/pack-keys.json', to: 'pack-keys.json' },
    { from: 'resources/licence-public.json', to: 'licence-public.json' },
    { from: 'resources/release-mode.json', to: 'release-mode.json' },
    { from: 'resources/code/system.md', to: 'code/system.md' },
    { from: 'resources/geo', to: 'geo' },
  ],
  npmRebuild: false,
  mac: {
    // Keep the checked-in icns. A png conversion is unnecessary on macOS.
    icon: 'build/icon.icns',
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
    extendInfo: {
      NSMicrophoneUsageDescription: 'Synap.surf uses the microphone so you can dictate a message. The recording stays on this computer.',
    },
    notarize: signing && Boolean(process.env.APPLE_ID),
  },
  win: {
    // build/icon.ico is not used: the checked-in ico was 32px and electron-builder rejects that.
    // The png is 1024 and is converted during the Windows build.
    icon: 'build/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    // Reads the installer file name (-2b, -4b, -9b, -offline-2b) and writes setup-model.json.
    include: 'build/installer.nsh',
  },
  linux: { target: ['AppImage'], category: 'Utility' },
  protocols: [{ name: 'Synap setup', schemes: ['synap'] }],
  publish: {
    provider: 'github',
    owner: 'kslji',
    repo: 'synap.ai',
    releaseType: process.env.SURF_RELEASE_TYPE === 'prerelease' ? 'prerelease' : 'release',
  },
}

if (!signing) config.afterPack = 'scripts/after-pack.cjs'

// Offline 2B installer: the GGUF is an extra resource, outside the asar, so the
// bundle stays a normal file. GitHub's per-asset limit is 2 GiB. The file itself
// is 1,280,835,840 bytes. The release job rejects an installer that reaches 2 GiB.
if (process.env.SURF_BUNDLE_MODEL === '1') {
  const modelDir = process.env.SURF_BUNDLE_MODEL_DIR
  const marker = process.env.SURF_SETUP_MARKER
  if (!modelDir || !marker) throw new Error('SURF_BUNDLE_MODEL needs SURF_BUNDLE_MODEL_DIR and SURF_SETUP_MARKER')
  config.extraResources.push(
    { from: marker, to: 'setup-model.json' },
    { from: modelDir, to: 'bundled-model' },
  )
  config.artifactName = 'Synap.surf-${version}-${arch}-offline-2b.${ext}'
  // The zip is only for in-place updates. The offline build is a separate download.
  config.mac.target = [{ target: 'dmg', arch: ['arm64', 'x64'] }]
}

module.exports = config
