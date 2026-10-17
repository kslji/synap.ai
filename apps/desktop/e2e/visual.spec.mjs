import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { go, launch } from './launch.mjs'

async function freezeMeasured(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-machine="yes"], [data-storage-page="yes"], [data-cache-plot]')) {
      el.style.height = '96px'
      el.style.overflow = 'hidden'
    }
  })
}

test('activation screen snapshot', async () => {
  const { app, page, dir } = await launch({})
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="activate"]')).toBeVisible()
    await expect(page).toHaveScreenshot('activate.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat, settings, and usage snapshots', async () => {
  const { app, page, dir } = await launch({ SYNAP_LICENCE_DEV: '1' })
  try {
    await go(page, 'chat')
    await expect(page.locator('[data-screen="chat"]')).toBeVisible()
    await expect(page).toHaveScreenshot('chat.png')
    await go(page, 'settings')
    await expect(page.locator('[data-dev-mode="yes"]')).toBeVisible()
    await freezeMeasured(page)
    await expect(page).toHaveScreenshot('settings.png', { mask: [page.locator('[data-machine="yes"]'), page.locator('[data-storage-page="yes"]')] })
    await go(page, 'usage')
    await expect(page.locator('[data-screen="usage"]')).toBeVisible()
    await expect(page.locator('[data-usage-view="yes"]')).toBeVisible()
    await freezeMeasured(page)
    await expect(page).toHaveScreenshot('usage.png', {
      mask: [page.locator('[data-storage-page="yes"]'), page.locator('[data-cache-plot]')],
    })
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
