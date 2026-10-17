import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DownloadButtons } from './download-buttons.tsx'
import { allowSubmit, ALL_DOWNLOADS_URL, BUNDLED_ASSETS, contactEmail, detectClient, downloadHrefs, footerLinks, formKey, newestPublishableRelease, pickDownload, releaseAssets, SETUP_MODELS, setupOpenLink } from './site.ts'

test('contact email falls back to the placeholder', () => {
  assert.equal(contactEmail(''), 'contact@example.com')
  assert.equal(contactEmail('  founder@example.com '), 'founder@example.com')
  assert.equal(formKey(''), '')
  assert.equal(formKey('abc'), 'abc')
})

test('footer links privacy, security, contribute, and GitHub', () => {
  const hrefs = footerLinks.map((link) => link.href)
  assert.deepEqual(hrefs.slice(0, 4), ['/privacy', '/security', '/contribute', '/terms'])
  assert.match(hrefs[4], /github\.com\/kslji\/synap\.ai/)
})

test('the download picker follows the computer', () => {
  const assets = [
    { name: 'SurfAI-0.2.0-arm64.dmg', url: 'https://example.invalid/arm.dmg' },
    { name: 'SurfAI-0.2.0-x64.dmg', url: 'https://example.invalid/x64.dmg' },
    { name: 'SurfAI-0.2.0-x64.exe', url: 'https://example.invalid/win.exe' },
    { name: 'SurfAI-0.2.0-x64.exe.blockmap', url: 'https://example.invalid/map' },
  ]
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh)', architecture: 'arm' }).arch, 'arm64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }).arch, 'arm64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh)', architecture: 'x86_64' }).arch, 'x64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh)', renderer: 'Intel(R) Iris' }).arch, 'x64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh)', renderer: 'Apple M2' }).arch, 'arm64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }).os, 'windows')
  assert.equal(pickDownload(assets, 'mac', 'arm64')?.url, 'https://example.invalid/arm.dmg')
  assert.equal(pickDownload(assets, 'mac', 'x64')?.url, 'https://example.invalid/x64.dmg')
  assert.equal(pickDownload(assets, 'windows', 'x64')?.url, 'https://example.invalid/win.exe')
  assert.equal(allowSubmit(1_000, null), true)
  assert.equal(allowSubmit(10_000, 0), false)
  assert.equal(allowSubmit(40_000, 0), true)
})

test('prereleases are downloadable and buttons point at an installer', () => {
  const releases = [
    { draft: true, assets: [{ name: 'Draft.dmg', browser_download_url: 'https://example.invalid/draft.dmg' }] },
    {
      draft: false,
      prerelease: true,
      assets: [
        { name: 'Synap.surf-0.1.0-arm64.dmg', browser_download_url: 'https://example.invalid/Synap.surf-0.1.0-arm64.dmg' },
        { name: 'Synap.surf-0.1.0-x64.dmg', browser_download_url: 'https://example.invalid/Synap.surf-0.1.0-x64.dmg' },
        { name: 'Synap.surf-0.1.0-x64.exe', browser_download_url: 'https://example.invalid/Synap.surf-0.1.0-x64.exe' },
      ],
    },
  ]
  const chosen = newestPublishableRelease(releases)
  assert.equal(chosen?.prerelease, true)
  const hrefs = downloadHrefs(releaseAssets(chosen), 'mac', 'arm64')
  assert.match(hrefs.mac, /\.dmg$/)
  assert.match(hrefs.win, /\.exe$/)
  assert.match(hrefs.intel, /x64\.dmg$/)
  assert.equal(hrefs.mac.includes('/releases/latest'), false)
  const baked = downloadHrefs(BUNDLED_ASSETS, 'windows', 'x64')
  assert.match(baked.mac, /arm64\.dmg$/)
  assert.match(baked.win, /\.exe$/)
  assert.match(ALL_DOWNLOADS_URL, /\/releases$/)
  const html = renderToStaticMarkup(React.createElement(DownloadButtons, {
    mac: hrefs.mac,
    win: hrefs.win,
    macLabel: 'Download for Mac',
    winLabel: 'Download for Windows',
    macSuggested: true,
    winSuggested: false,
  }))
  for (const kind of ['mac', 'windows'] as const) {
    const tag = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((anchor) => anchor.includes(`data-download="${kind}"`))
    assert.ok(tag, kind)
    const href = /href="([^"]+)"/.exec(tag ?? '')?.[1] ?? ''
    assert.match(href, kind === 'mac' ? /\.dmg$/ : /\.exe$/)
  }
})

test('the setup link names a registry model and does not change the installer', () => {
  assert.equal(setupOpenLink('qwen3.5-4b-q4_k_m'), 'synap://setup?model=qwen3.5-4b-q4_k_m')
  assert.equal(setupOpenLink('nope'), 'synap://setup?model=qwen3.5-2b-q4_k_m')
})

test('each model card downloads the registry file', () => {
  const registry = JSON.parse(readFileSync(new URL('../../desktop/resources/models.registry.json', import.meta.url), 'utf8')) as {
    models: { id: string; url: string; sha256: string; file: string; size_bytes: number }[]
  }
  for (const model of SETUP_MODELS) {
    const row = registry.models.find((item) => item.id === model.id)
    assert.ok(row, model.id)
    assert.equal(model.url, row?.url)
    assert.equal(model.sha256, row?.sha256)
    assert.equal(model.file, row?.file)
    assert.equal(model.sizeBytes, row?.size_bytes)
  }
  const page = readFileSync(new URL('./pages.tsx', import.meta.url), 'utf8')
  assert.match(page, /data-model-picker="yes"/)
  assert.match(page, /href=\{model\.url\}/)
  assert.match(page, /download=\{model\.file\}/)
  assert.match(page, /data-model-size=\{model\.id\}/)
  assert.match(page, /data-model-ram=\{model\.id\}/)
  assert.doesNotMatch(page, /Open Synap and start/)
  assert.doesNotMatch(page, /synap:\/\/setup/)
  assert.doesNotMatch(page, /Q4_K_M|GGUF|>3\.5</)
})
