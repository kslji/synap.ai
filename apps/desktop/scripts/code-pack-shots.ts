/**
 * Screenshots of Settings, Packs, and a chat citation.
 * The chat payload is a real pack-on answer written by the eval, not a demo scene.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { launch, go } from '../e2e/launch.mjs'

const out = process.env.SURF_SHOT_DIR ?? '/opt/cursor/artifacts/code-pack'
const shot = JSON.parse(readFileSync(process.env.SURF_CODE_PACK_SHOT ?? '/tmp/code-pack-shot.json', 'utf8')) as {
  question: string
  answer: string
  citation: string
  version: string
  url: string
  excerpt: string
  heading: string
}

async function shoot(theme: 'light' | 'dark'): Promise<void> {
  const { app, page } = await launch({}, { theme, onboardingComplete: true, offlineOnly: true })
  try {
    await page.setViewportSize({ width: 1100, height: 800 })
    await go(page, 'settings')
    await page.waitForSelector('[data-screen="settings"], [data-dev-mode="yes"]')
    await page.screenshot({ path: `${out}/settings-${theme}.png` })
    await go(page, 'packs')
    await page.waitForSelector('[data-pack-id="code"]')
    await page.waitForSelector('[data-pack-sources="yes"]')
    await page.screenshot({ path: `${out}/packs-${theme}.png`, fullPage: true })
    await page.evaluate((payload) => {
      const show = (window as unknown as { __surfShowCite?: (body: typeof payload) => void }).__surfShowCite
      show?.(payload)
    }, shot)
    await page.waitForSelector('[data-citation="yes"]')
    await page.screenshot({ path: `${out}/chat-${theme}.png` })
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true })
  await shoot('light')
  await shoot('dark')
  process.stdout.write(`wrote ${out}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`)
  process.exit(1)
})
