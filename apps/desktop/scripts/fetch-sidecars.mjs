#!/usr/bin/env node
// Downloads the pinned llama.cpp release for THIS platform into resources/bin/<platform>-<arch>/
// (electron-builder copies that folder to <resources>/bin via extraResources).
// Usage: node scripts/fetch-sidecars.mjs [--gpu=vulkan] [--platform=darwin] [--arch=arm64]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
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
const out = join('resources', 'bin', key)
const tmp = join('resources', 'bin', '.tmp')
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })

console.log('downloading', url)
const res = await fetch(url)
if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
const buf = Buffer.from(await res.arrayBuffer())
const archive = join(tmp, asset)
writeFileSync(archive, buf)
const sha = createHash('sha256').update(buf).digest('hex')
// bsdtar (macOS, Windows 10+) and GNU tar both extract .tar.gz; bsdtar also extracts .zip
execFileSync('tar', ['-xf', asset], { cwd: tmp, stdio: 'inherit' })
// archives contain either a top-level folder (llama-bXXXX/) or loose files
const entries = readdirSync(tmp).filter((e) => e !== asset)
const src = entries.length === 1 && !entries[0].includes('.') ? join(tmp, entries[0]) : tmp
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
cpSync(src, out, { recursive: true, verbatimSymlinks: true, filter: (p) => !p.endsWith(asset) })
rmSync(tmp, { recursive: true, force: true })
writeFileSync(join(out, 'SIDECAR.json'), JSON.stringify({ tag: TAG, asset, url, sha256: sha, fetched: new Date().toISOString() }, null, 2))
const exe = platform === 'win32' ? 'llama-server.exe' : 'llama-server'
if (platform === process.platform && arch === process.arch) {
  console.log(execFileSync(join(out, exe), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || 'ok')
} else {
  console.log(`fetched ${key}; not executed on ${process.platform}-${process.arch}`)
}
console.log(`sidecars ready in ${out} (sha256 ${sha}); record this hash in the release notes`)

