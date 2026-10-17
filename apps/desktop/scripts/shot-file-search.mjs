/**
 * Light and dark screenshots of the folder-permission UI.
 * Uses the built desktop stylesheet so the shots match the app.
 */
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'e2e', 'snapshots', 'file-search')
mkdirSync(outDir, { recursive: true })

const cssFile = readdirSync(join(root, 'out', 'renderer', 'assets')).find((name) => name.endsWith('.css'))
if (!cssFile) throw new Error('Build the desktop app before taking screenshots.')
const css = readFileSync(join(root, 'out', 'renderer', 'assets', cssFile), 'utf8')

const bundle = join(tmpdir(), 'surf-file-gallery.js')
await build({
  entryPoints: [join(root, 'src', 'renderer', 'src', 'file-gallery.tsx')],
  bundle: true,
  format: 'iife',
  outfile: bundle,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
  absWorkingDir: root,
})

const html = `<!doctype html>
<html data-theme="light">
<head>
  <meta charset="utf-8" />
  <style>${css}</style>
  <style>body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font); }</style>
</head>
<body><div id="root"></div><script src="/gallery.js"></script></body>
</html>`

const server = createServer((req, res) => {
  if (req.url?.startsWith('/gallery.js')) {
    res.setHeader('content-type', 'text/javascript')
    res.end(readFileSync(bundle))
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const { chromium } = await import('@playwright/test')
const browser = await chromium.launch({ headless: true })
const scenes = ['card', 'permissions', 'progress', 'answer', 'home']
try {
  for (const theme of ['light', 'dark']) {
    for (const scene of scenes) {
      const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 2 })
      await page.goto(`http://127.0.0.1:${port}/?scene=${scene}&theme=${theme}`)
      await page.waitForSelector('[data-file-permission], [data-file-permissions], [data-file-progress], [data-file-answer]')
      await page.waitForTimeout(400)
      const file = join(outDir, `${scene}-${theme}.png`)
      await page.screenshot({ path: file, fullPage: true })
      await page.close()
      console.log(file)
    }
  }
} finally {
  await browser.close()
  server.close()
}
