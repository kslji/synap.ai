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
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
