import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function launch(env, settings = {}, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'surf-e2e-'))
  const downloads = join(dir, 'downloads')
  mkdirSync(downloads)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    onboardingComplete: true,
    theme: 'light',
    offlineOnly: true,
    animateMascot: false,
    mascotName: 'Surf',
    accent: 'orange',
    density: 'comfortable',
    ...settings,
  }))
  const app = await electron.launch({
    // Keep text rasterisation the same on macOS and on the Linux runner: greyscale
    // antialiasing with the font's own advances, so a snapshot taken on one machine
    // is not rejected by the other over subpixel fringes or hinted stems.
    args: [
      '.',
      '--no-sandbox',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      ...extraArgs,
    ],
    cwd: desktop,
    env: {
      ...process.env,
      TZ: 'UTC',
      LANG: 'C.UTF-8',
      SURF_DOWNLOADS_DIR: downloads,
      SURF_MODELS_DIR: '',
      HARBOR_MODELS_DIR: '',
      SURF_DEV_WEB: '',
      SURF_EVAL: '',
      SURF_SMOKE: '',
      SURF_SELFTEST: '',
      SURF_CAPTURE_DIR: '',
      SURF_E2E_DIR: dir,
      ...env,
    },
  })
  try {
    const page = await app.firstWindow({ timeout: 120_000 })
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.waitForSelector('[data-ready="yes"]', { timeout: 40_000 })
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important;font-family:'Liberation Sans',sans-serif !important}::-webkit-scrollbar{width:0 !important;height:0 !important}" })
    return { app, page, dir }
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

export async function go(page, view) {
  await page.evaluate((next) => {
    const nav = window.__surfNav
    if (nav) nav(next)
  }, view)
}
