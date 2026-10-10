#!/usr/bin/env node
// Downloads the pinned llama.cpp release for THIS platform into resources/bin/<platform>-<arch>/
// (electron-builder copies that folder to <resources>/bin via extraResources).
// Usage: node scripts/fetch-sidecars.mjs [--gpu=vulkan] [--platform=darwin] [--arch=arm64]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

async function main() {
  const TAG = 'b11514' // pinned; EmbeddingGemma 2 needs >= b11452
  const gpu = arg('gpu')
  const platform = arg('platform') ?? process.platform
  const arch = arg('arch') ?? process.arch
  const key = `${platform}-${arch}`
  const ASSETS = {
    'darwin-arm64': `llama-${TAG}-bin-macos-arm64.tar.gz`, // Metal built in
    'darwin-x64': `llama-${TAG}-bin-macos-x64.tar.gz`,
    'win32-x64': gpu === 'vulkan' ? `llama-${TAG}-bin-win-vulkan-x64.zip` : `llama-${TAG}-bin-win-cpu-x64.zip`,
    'win32-arm64': `llama-${TAG}-bin-win-cpu-arm64.zip`,
    'linux-x64': gpu === 'vulkan' ? `llama-${TAG}-bin-ubuntu-vulkan-x64.tar.gz` : `llama-${TAG}-bin-ubuntu-x64.tar.gz`
  }
  const asset = ASSETS[key]
  if (!asset) throw new Error(`no llama.cpp asset mapped for ${key}`)
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${asset}`
  const out = resolve('resources', 'bin', key)
  const tmp = resolve('resources', 'bin', '.tmp')
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })

  console.log('downloading', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const archive = resolve(tmp, asset)
  writeFileSync(archive, buf)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`sha256 was not computed for ${asset}`)
  await extractArchive(archive, buf, tmp)
  // archives contain either a top-level folder (llama-bXXXX/) or loose files
  const entries = readdirSync(tmp).filter((e) => e !== asset)
  const src = entries.length === 1 && !entries[0].includes('.') ? resolve(tmp, entries[0]) : tmp
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
  cpSync(src, out, { recursive: true, verbatimSymlinks: true, filter: (p) => !p.endsWith(asset) })
  rmSync(tmp, { recursive: true, force: true })
  writeFileSync(resolve(out, 'SIDECAR.json'), JSON.stringify({ tag: TAG, asset, url, sha256: sha, fetched: new Date().toISOString() }, null, 2))
  const exe = platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  if (platform === process.platform && arch === process.arch) {
    console.log(execFileSync(resolve(out, exe), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || 'ok')
  } else {
    console.log(`fetched ${key}; not executed on ${process.platform}-${process.arch}`)
  }
  console.log(`sidecars ready in ${out} (sha256 ${sha}); record this hash in the release notes`)
}

/**
 * tar.gz stays with tar. Zip uses JSZip so Git Bash's GNU tar is never asked to read a zip.
 * sha256 of the downloaded bytes is checked by the caller before this runs.
 */
export async function extractArchive(archive, buf, cwd) {
  if (archive.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buf)
    const names = Object.keys(zip.files)
    if (!names.length) throw new Error(`empty zip ${archive}`)
    const root = resolve(cwd)
    for (const name of names) {
      const entry = zip.files[name]
      const dest = zipDest(root, name)
      if (entry.dir) {
        mkdirSync(dest, { recursive: true })
        continue
      }
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, await entry.async('nodebuffer'))
    }
    return
  }
  execFileSync('tar', ['-xf', archive], { cwd, stdio: 'inherit' })
}

function zipDest(root, name) {
  if (isAbsolute(name)) throw new Error(`zip entry escapes the folder: ${name}`)
  const parts = name.split(/[/\\]/).filter((part) => part !== '' && part !== '.')
  if (!parts.length || parts.some((part) => part === '..')) {
    throw new Error(`zip entry escapes the folder: ${name}`)
  }
  const dest = resolve(root, ...parts)
  const diff = relative(root, dest)
  if (!diff || diff.startsWith('..') || isAbsolute(diff)) {
    throw new Error(`zip entry escapes the folder: ${name}`)
  }
  return dest
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) await main()
