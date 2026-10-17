import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { go, launch } from './launch.mjs'

test('licence lock shows the activation screen when dev mode is off', async () => {
  const { app, page, dir } = await launch({ SYNAP_DEV_MODE: '0' })
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="activate"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Buy a licence' })).toHaveCount(0)
    await expect(page.locator('[data-screen="chat"]')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat, settings, usage, and cache open without a model', async () => {
  const { app, page, dir } = await launch({}, { animateMascot: true })
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="chat"]')).toBeVisible()
    await expect(page.locator('[data-screen="activate"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Buy a licence' })).toHaveCount(0)
    await expect(page.locator('[data-model-setup="yes"]')).toContainText('Download a model to start')
    await expect(page.locator('[data-model-option="qwen3.5-2b-q4_k_m"]')).toContainText('Download Qwen 2B')
    await expect(page.locator('[data-model-size="qwen3.5-2b-q4_k_m"]')).toHaveText('1.28 GB')
    await expect(page.locator('[data-model-ram="qwen3.5-2b-q4_k_m"]')).toHaveText('needs 4 GB RAM')
    await expect(page.locator('[data-model-option="qwen3.5-4b-q4_k_m"]')).toContainText('Download Qwen 4B')
    await expect(page.locator('[data-model-size="qwen3.5-4b-q4_k_m"]')).toHaveText('2.74 GB')
    await expect(page.locator('[data-model-ram="qwen3.5-4b-q4_k_m"]')).toHaveText('needs 8 GB RAM')
    await expect(page.locator('[data-model-option="qwen3.5-9b-q4_k_m"]')).toContainText('Download Qwen 9B')
    await expect(page.locator('[data-model-size="qwen3.5-9b-q4_k_m"]')).toHaveText('5.68 GB')
    await expect(page.locator('[data-model-ram="qwen3.5-9b-q4_k_m"]')).toHaveText('needs 16 GB RAM')
    await expect(page.locator('[data-download-model="qwen3.5-2b-q4_k_m"]')).toBeEnabled()
    await expect(page.locator('[data-download-model="qwen3.5-4b-q4_k_m"]')).toBeEnabled()
    await expect(page.locator('[data-download-model="qwen3.5-9b-q4_k_m"]')).toBeEnabled()
    await expect(page.locator('[data-import-gguf="yes"]')).toBeEnabled()
    const clip = page.locator('[data-mascot-idle="clip"] video').first()
    await expect(clip).toBeVisible()
    const sample = await clip.evaluate(async (video) => {
      const el = /** @type {HTMLVideoElement} */ (video)
      if (el.readyState < 2) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('idle clip did not load')), 8000)
          el.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(null) }, { once: true })
        })
      }
      const canvas = document.createElement('canvas')
      const w = el.videoWidth || 32
      const h = el.videoHeight || 32
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return { alpha: -1, muted: el.muted }
      ctx.drawImage(el, 0, 0, w, h)
      return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], muted: el.muted }
    })
    expect(sample.muted).toBe(true)
    expect(sample.alpha).toBe(0)
    await go(page, 'chat')
    await expect(page.locator('[data-screen="chat"]')).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible()
    await go(page, 'settings')
    await expect(page.locator('[data-screen="settings"]')).toBeVisible()
    await expect(page.locator('[data-dev-mode="yes"]')).toBeVisible()
    await expect(page.locator('[data-app-version="yes"]')).toContainText('0.2.0')
    await expect(page.locator('[data-machine="yes"]')).toBeVisible()
    await expect(page.locator('[data-storage-page="yes"]')).toBeVisible()
    await go(page, 'usage')
    await expect(page.locator('[data-screen="usage"]')).toBeVisible()
    await expect(page.locator('[data-usage-view="yes"]')).toBeVisible()
    await expect(page.locator('[data-usage-page="yes"]')).toBeVisible()
    await expect(page.locator('[data-storage-page="yes"]').last()).toBeVisible()
    await expect(page.locator('[data-cache-plot]')).toBeVisible()
    await expect(page.locator('[data-offline-toggle]')).toHaveCount(0)
    await expect(page.locator('[data-sync-chip="yes"]')).toBeVisible()
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-network-mode', 'offline')
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-label', 'Dev mode, sync off')
    await expect(page.locator('body')).not.toContainText('api.synap.surf')
    await expect(page.locator('body')).not.toContainText('https://synap.surf')
    await expect(page.locator('[data-sign-in="yes"]')).toHaveCount(0)
    await expect(page.locator('[data-toast]')).toHaveCount(0)
    await go(page, 'settings')
    await expect(page.locator('[data-network-settings="yes"] [data-network-mode="offline"]')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('[data-sync-detail="yes"]')).toContainText('Last sync: not yet')
    await page.locator('[data-network-settings="yes"] [data-network-mode="auto"]').click()
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-network-mode', 'auto')
    await expect(page.locator('[data-toast]')).toHaveCount(0)
    await page.locator('[data-network-settings="yes"] [data-network-mode="online"]').click()
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-network-mode', 'online')
    await expect(page.locator('[data-sync-chip="yes"]')).not.toHaveAttribute('data-sync-label', 'Offline')
    await page.locator('[data-network-settings="yes"] [data-network-mode="offline"]').click()
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-state', 'offline')
    await go(page, 'chat')
    await expect(page.locator('[data-offline-toggle]')).toHaveCount(0)
    await page.evaluate(() => window.__surfDemo && window.__surfDemo('versions'))
    await expect(page.locator('[data-reply-versions="yes"]')).toContainText('2/2')
    await page.getByRole('button', { name: 'Previous version' }).click()
    await expect(page.locator('[data-reply-versions="yes"]')).toContainText('1/2')
    await expect(page.locator('[data-model-error="no"]').last()).toContainText('First answer')
    await page.getByRole('button', { name: 'Next version' }).click()
    await expect(page.locator('[data-reply-versions="yes"]')).toContainText('2/2')
    await page.locator('[data-reply-regenerate="yes"]').click()
    await expect(page.locator('[data-model-error="yes"]')).toBeVisible()
    await expect(page.locator('[data-user-message="yes"]')).toHaveCount(1)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
