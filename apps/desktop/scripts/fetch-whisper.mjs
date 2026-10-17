#!/usr/bin/env node
// Downloads the pinned whisper.cpp release for THIS platform into
// resources/whisper/<platform>-<arch>/ (electron-builder copies that folder).
// macOS has no official whisper-cli archive, so that platform builds the same tag.
// Usage: node scripts/fetch-whisper.mjs [--platform=darwin] [--arch=arm64]
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractArchive } from './fetch-sidecars.mjs'
import { fetchDownload, httpFailure, withDownloadRetry } from './http-download.mjs'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

/** Pinned whisper.cpp build. Linux and Windows use the release archives. macOS builds this tag. */
export const WHISPER_TAG = 'b5454'

/**
 * Official ggml-org/whisper.cpp release assets. There is no macOS CLI archive;
 * darwin returns null and the caller builds whisper-cli from this tag.
 */
export function whisperAsset(platform, arch) {
  const table = {
    'linux-x64': 'whisper-bin-ubuntu-x64.tar.gz',
    'linux-arm64': 'whisper-bin-ubuntu-arm64.tar.gz',
    'win32-x64': 'whisper-bin-x64.zip',
    'win32-arm64': 'whisper-bin-win-cpu-arm64.zip',
  }
  return table[`${platform}-${arch}`] ?? null
}

export function whisperUrl(asset, tag = WHISPER_TAG) {
  return `https://github.com/ggml-org/whisper.cpp/releases/download/${tag}/${asset}`
}

const EXE = (platform) => (platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

function stageBinary(root, platform, dest) {
  const exeName = EXE(platform)
  const files = walk(root)
  const exe = files.find((path) => path.endsWith(`/${exeName}`) || path.endsWith(`\\${exeName}`))
  if (!exe) throw new Error(`whisper-cli was not in the ${platform} package`)
  const folder = dirname(exe)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(folder)) {
    const from = join(folder, name)
    const info = lstatSync(from)
    if (info.isSymbolicLink()) {
      const targetName = basename(readlinkSync(from))
      if (platform === 'win32') {
        const resolved = join(folder, targetName)
        if (existsSync(resolved)) cpSync(resolved, join(dest, name))
        continue
      }
      // Keep the soname link beside the binary. $ORIGIN does not follow a link
      // that still points at the download folder.
      symlinkSync(targetName, join(dest, name))
      continue
    }
    if (!info.isFile()) continue
    const needed = name === exeName || name.startsWith('lib') || name === 'LICENSE'
    if (!needed) continue
    cpSync(from, join(dest, name))
  }
  const staged = join(dest, exeName)
  if (platform !== 'win32') chmodSync(staged, 0o755)
  return staged
}

async function fetchArchive(platform, arch) {
  const asset = whisperAsset(platform, arch)
  if (!asset) throw new Error(`no whisper.cpp archive for ${platform}-${arch}`)
  const url = whisperUrl(asset)
  const tmp = resolve('resources', 'whisper', '.tmp')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  console.log('downloading', url)
  const buf = await withDownloadRetry(async () => {
    const res = await fetchDownload(url)
    if (!res.ok) throw httpFailure(url, res.status)
    return Buffer.from(await res.arrayBuffer())
  })
  const sha256 = createHash('sha256').update(buf).digest('hex')
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`sha256 was not computed for ${asset}`)
  const archive = resolve(tmp, asset)
  writeFileSync(archive, buf)
  await extractArchive(archive, buf, tmp)
  const dest = resolve('resources', 'whisper', `${platform}-${arch}`)
  stageBinary(tmp, platform, dest)
  rmSync(tmp, { recursive: true, force: true })
  writeFileSync(resolve(dest, 'WHISPER.json'), JSON.stringify({
    tag: WHISPER_TAG, asset, url, sha256, fetched: new Date().toISOString(),
  }, null, 2))
  return { dest, sha256, asset, url }
}

function buildFromSource(platform, arch) {
  if (platform !== 'darwin' || process.platform !== 'darwin') {
    throw new Error(`whisper-cli for ${platform}-${arch} is built on macOS`)
  }
  const src = resolve('resources', 'whisper', '.src')
  const build = resolve(src, `build-${arch}`)
  if (!existsSync(join(src, '.git'))) {
    rmSync(src, { recursive: true, force: true })
    mkdirSync(dirname(src), { recursive: true })
    execFileSync('git', [
      'clone', '--depth', '1', '--branch', WHISPER_TAG,
      'https://github.com/ggml-org/whisper.cpp.git', src,
    ], { stdio: 'inherit' })
  }
  const cmake = spawnSync('cmake', ['--version'], { encoding: 'utf8' })
  if (cmake.status !== 0) throw new Error('cmake is required to build whisper-cli on macOS')
  const osxArch = arch === 'arm64' ? 'arm64' : 'x86_64'
  execFileSync('cmake', [
    '-S', src, '-B', build,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_OSX_ARCHITECTURES=${osxArch}`,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DWHISPER_SDL2=OFF',
    '-DWHISPER_COREML=OFF',
  ], { stdio: 'inherit' })
  execFileSync('cmake', ['--build', build, '--target', 'whisper-cli', '--config', 'Release', '-j'], { stdio: 'inherit' })
  const dest = resolve('resources', 'whisper', `${platform}-${arch}`)
  stageBinary(build, platform, dest)
  const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const url = `https://github.com/ggml-org/whisper.cpp/tree/${WHISPER_TAG}`
  writeFileSync(resolve(dest, 'WHISPER.json'), JSON.stringify({
    tag: WHISPER_TAG, asset: 'source', url, commit, fetched: new Date().toISOString(),
  }, null, 2))
  return { dest, sha256: commit, asset: 'source', url }
}

async function main() {
  const platform = arg('platform') ?? process.platform
  const arch = arg('arch') ?? process.arch
  const asset = whisperAsset(platform, arch)
  const ready = asset ? await fetchArchive(platform, arch) : buildFromSource(platform, arch)
  const exe = resolve(ready.dest, EXE(platform))
  if (platform === process.platform && arch === process.arch) {
    const version = spawnSync(exe, ['--help'], { encoding: 'utf8' })
    if (version.status !== 0 && version.status !== 1) {
      throw new Error(`whisper-cli --help failed (${version.status ?? 'no status'})`)
    }
    console.log((version.stdout || version.stderr).split('\n').slice(0, 4).join('\n'))
  } else {
    console.log(`fetched ${platform}-${arch}; not executed on ${process.platform}-${process.arch}`)
  }
  console.log(`whisper-cli ready in ${ready.dest} (${ready.asset} ${ready.sha256})`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) await main()
