import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowSubmit, contactEmail, detectClient, footerLinks, formKey, pickDownload } from './site.ts'

test('contact email falls back to the placeholder', () => {
  assert.equal(contactEmail(''), 'contact@example.com')
  assert.equal(contactEmail('  founder@example.com '), 'founder@example.com')
  assert.equal(formKey(''), '')
  assert.equal(formKey('abc'), 'abc')
})

test('footer links privacy, security, contribute, and GitHub', () => {
  const hrefs = footerLinks.map((link) => link.href)
  assert.deepEqual(hrefs.slice(0, 3), ['/privacy', '/security', '/contribute'])
  assert.match(hrefs[3], /github\.com\/kslji\/synap\.ai/)
})

test('the download picker follows the computer', () => {
  const assets = [
    { name: 'SurfAI-0.2.0-arm64.dmg', url: 'https://example.invalid/arm.dmg' },
    { name: 'SurfAI-0.2.0-x64.dmg', url: 'https://example.invalid/x64.dmg' },
    { name: 'SurfAI-0.2.0-x64.exe', url: 'https://example.invalid/win.exe' },
    { name: 'SurfAI-0.2.0-x64.exe.blockmap', url: 'https://example.invalid/map' },
  ]
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Macintosh)', architecture: 'arm' }).arch, 'arm64')
  assert.equal(detectClient({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }).os, 'windows')
  assert.equal(pickDownload(assets, 'mac', 'arm64')?.url, 'https://example.invalid/arm.dmg')
  assert.equal(pickDownload(assets, 'mac', 'x64')?.url, 'https://example.invalid/x64.dmg')
  assert.equal(pickDownload(assets, 'windows', 'x64')?.url, 'https://example.invalid/win.exe')
  assert.equal(allowSubmit(1_000, null), true)
  assert.equal(allowSubmit(10_000, 0), false)
  assert.equal(allowSubmit(40_000, 0), true)
})
