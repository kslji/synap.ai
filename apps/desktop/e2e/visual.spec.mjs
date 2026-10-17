import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { go, launch } from './launch.mjs'

async function expectSwitchBesideLabel(page) {
  const row = page.locator('[data-theme-row="yes"]')
  await expect(row.locator('.theme-label')).toHaveText('Dark mode')
  const boxes = await row.evaluate((el) => {
    const label = el.querySelector('.theme-label')
    const toggle = el.querySelector('button.toggle')
    const knob = toggle?.querySelector('span')
    if (!label || !toggle || !knob) return null
    const l = label.getBoundingClientRect()
    const t = toggle.getBoundingClientRect()
    const k = knob.getBoundingClientRect()
    return {
      labelRight: l.right,
      toggleLeft: t.left,
      toggleWidth: t.width,
      toggleRight: t.right,
      knobLeft: k.left,
      knobRight: k.right,
    }
  })
  expect(boxes).not.toBeNull()
  expect(boxes.toggleLeft).toBeGreaterThanOrEqual(boxes.labelRight - 1)
  expect(boxes.toggleWidth).toBeGreaterThanOrEqual(40)
  expect(boxes.toggleWidth).toBeLessThanOrEqual(46)
  expect(boxes.knobLeft).toBeGreaterThanOrEqual(boxes.toggleLeft - 1)
  expect(boxes.knobRight).toBeLessThanOrEqual(boxes.toggleRight + 1)
  expect(boxes.knobRight).toBeGreaterThan(boxes.labelRight)
}

async function freezeMeasured(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-machine="yes"], [data-storage-page="yes"], [data-cache-plot]')) {
      el.style.height = '96px'
      el.style.overflow = 'hidden'
    }
  })
}

test('activation screen snapshot', async () => {
  const { app, page, dir } = await launch({ SYNAP_DEV_MODE: '0' })
  try {
    await expect(page.locator('[data-ready="yes"][data-screen="activate"]')).toBeVisible()
    await expect(page).toHaveScreenshot('activate.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat, settings, and usage snapshots', async () => {
  const { app, page, dir } = await launch({})
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
    await expect(page).toHaveScreenshot('usage.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('theme switch sits to the right of Dark mode in light and dark', async () => {
  const { app, page, dir } = await launch({})
  try {
    await page.locator('[data-account-menu="yes"]').click()
    await expect(page.locator('[data-account-panel="yes"]')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expectSwitchBesideLabel(page)
    await expect(page.locator('[data-theme-row="yes"]')).toHaveScreenshot('theme-row-light.png')
    await page.locator('[data-theme-row="yes"] button.toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute('data-on', 'yes')
    await expectSwitchBesideLabel(page)
    await expect(page.locator('[data-theme-row="yes"]')).toHaveScreenshot('theme-row-dark.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat header is the agent chip and title, and device control is refused', async () => {
  const { app, page, dir } = await launch({})
  try {
    await expect(page.locator('header')).not.toContainText('Which model should I pick?')
    await page.locator('textarea').fill('take control of my Mac and open files')
    await page.getByRole('button', { name: 'Send' }).click()
    const reply = page.locator('[data-assistant-message="yes"]')
    await expect(reply).toContainText("isn't available yet", { timeout: 20_000 })
    await expect(reply).not.toContainText('I opened')
    await expect(page.locator('[data-chat-title="yes"]')).toHaveText('take control of my Mac and open files')
    await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
    await expect(page.locator('header')).not.toContainText('Which model should I pick?')
    await expect(reply).toHaveScreenshot('device-control-reply.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
