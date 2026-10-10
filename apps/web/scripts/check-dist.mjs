/**
 * After `vite build`, every local asset the homepage references must exist,
 * and the client bundle must contain the privacy, security, and contribute routes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url)
const distPath = dist.pathname
const htmlPath = join(distPath, 'index.html')
if (!existsSync(htmlPath)) {
  console.error('missing', htmlPath)
  process.exit(1)
}
const html = readFileSync(htmlPath, 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
let missing = 0
for (const ref of refs) {
  if (/^(https?:|mailto:|#|data:)/.test(ref)) continue
  const rel = decodeURIComponent(ref.replace(/^\//, '').split('?')[0])
  const file = join(distPath, rel)
  if (!existsSync(file)) {
    console.error('broken link', ref)
    missing += 1
  }
}
const js = readdirSync(join(distPath, 'assets')).filter((name) => name.endsWith('.js'))
const bundle = js.map((name) => readFileSync(join(distPath, 'assets', name), 'utf8')).join('\n')
for (const route of ['/privacy', '/security', '/contribute']) {
  if (!bundle.includes(route)) {
    console.error('bundle missing route', route)
    missing += 1
  }
}
if (!bundle.includes('Draft — not legal advice')) {
  console.error('bundle missing the draft notice')
  missing += 1
}
if (missing) process.exit(1)
const bytes = statSync(htmlPath).size
console.log(`website link check ok (${refs.length} refs, ${bytes} byte index)`)
