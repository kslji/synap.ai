import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { go, launch } from './launch.mjs'

test('cached Qwen 2B streams one chat reply', async () => {
  test.skip(!process.env.SURF_MODELS_DIR, 'Qwen 2B weights are not cached')
  test.setTimeout(360_000)
  const { app, page, dir } = await launch({
    SYNAP_LICENCE_DEV: '1',
    SURF_MODELS_DIR: process.env.SURF_MODELS_DIR,
  }, {
    chatModelId: 'qwen3.5-2b-q4_k_m',
    networkMode: 'offline',
    offlineOnly: true,
  })
  try {
    await go(page, 'chat')
    const box = page.locator('textarea')
    await expect(box).toBeEnabled({ timeout: 20_000 })
    await box.fill('Reply with the single word surf.')
    await page.getByRole('button', { name: 'Send' }).click()
    const reply = page.locator('[data-assistant-message="yes"]')
    await expect(reply).toBeVisible()
    await expect(reply).toHaveAttribute('data-streamed', 'yes', { timeout: 300_000 })
    await expect(page.locator('[data-reply-actions="yes"]')).toBeVisible({ timeout: 300_000 })
    await expect(reply.locator('[data-model-error="yes"]')).toHaveCount(0)
    expect((await reply.innerText()).trim().length).toBeGreaterThan(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
