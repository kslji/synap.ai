import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { go, launch } from './launch.mjs'

test('licence lock shows the activation screen', async () => {
  const { app, page, dir } = await launch({})
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="activate"]')).toBeVisible()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat, settings, usage, and cache open without a model', async () => {
  const { app, page, dir } = await launch({ SYNAP_LICENCE_DEV: '1' })
  try {
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
    await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-label', 'Offline')
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
