import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './launch.mjs'

test('launch opens chat, then the cached Qwen 2B streams a reply', async () => {
  test.skip(!process.env.SURF_MODELS_DIR, 'Qwen 2B weights are not cached')
  test.setTimeout(360_000)
  const gguf = join(process.env.SURF_MODELS_DIR, 'Qwen3.5-2B-Q4_K_M.gguf')
  const { app, page, dir } = await launch({})
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="chat"]')).toBeVisible()
    await expect(page.locator('[data-screen="activate"]')).toHaveCount(0)
    await expect(page.locator('[data-model-option="qwen3.5-2b-q4_k_m"]')).toContainText('Download Qwen 2B')
    await expect(page.locator('[data-model-size="qwen3.5-2b-q4_k_m"]')).toHaveText('1.28 GB')
    await expect(page.locator('[data-download-model="qwen3.5-4b-q4_k_m"]')).toBeEnabled()
    await expect(page.locator('[data-download-model="qwen3.5-9b-q4_k_m"]')).toBeEnabled()
    await expect(page.locator('textarea')).toBeDisabled()
    const imported = await page.evaluate(async (path) => window.surf.models.importLocal(path), gguf)
    expect(imported && imported.id).toBe('qwen3.5-2b-q4_k_m')
    await expect(page.locator('[data-model-setup="yes"]')).toHaveCount(0, { timeout: 20_000 })
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
