import { expect, test } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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

async function replyShot(theme, scene, name) {
  const { app, page, dir } = await launch({}, { theme })
  try {
    await page.setViewportSize({ width: 1100, height: 980 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.evaluate((next) => window.__surfDemo && window.__surfDemo(next), scene)
    const reply = page.locator('[data-assistant-message="yes"]')
    await expect(reply).toBeVisible()
    const text = await reply.innerText()
    expect(text).not.toContain('```')
    expect(text).not.toContain('###')
    expect(text).not.toContain('**')
    expect(text).not.toContain('\uFFFD')
    if (scene === 'formatted') {
      await expect(reply.locator('h2')).toHaveText('Sorting a list')
      await expect(reply.locator('ul li')).toHaveCount(3)
      await expect(reply.locator('ol li')).toHaveCount(3)
      await expect(reply.locator('strong')).toHaveText('stable')
      await expect(reply.locator('[data-code-block="yes"]')).toBeVisible()
      await expect(reply.locator('[data-copy-code="yes"]')).toHaveText('Copy')
      await expect(reply.locator('[data-token="keyword"]').filter({ hasText: 'const' })).toBeVisible()
      await expect(reply.locator('[data-token="keyword"]').filter({ hasText: 'return' })).toBeVisible()
      await expect(reply.locator('table')).toContainText('Leaves the input alone')
      await expect(reply.locator('[data-latex="yes"]')).toContainText('mc')
      await expect(reply.locator('a[href="https://example.com/sort"]')).toBeVisible()
      await expect(reply.locator('[data-continue="yes"]')).toHaveCount(0)
    } else {
      await expect(reply).toContainText('finished sentence')
      await expect(reply).toContainText('unchanged.')
      await expect(reply.locator('[data-continue="yes"]')).toHaveText('Continue')
    }
    await expect(reply).toHaveScreenshot(name)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('formatted replies render in light and dark', async () => {
  await replyShot('light', 'formatted', 'formatted-reply-light.png')
  await replyShot('dark', 'formatted', 'formatted-reply-dark.png')
})

test('a length-limited reply ends on a sentence and offers Continue', async () => {
  await replyShot('light', 'continued', 'continue-reply-light.png')
  await replyShot('dark', 'continued', 'continue-reply-dark.png')
})

test('the Surf chip shows idle, syncing, synced, failed, and offline', async () => {
  test.setTimeout(180_000)
  for (const theme of ['light', 'dark']) {
    const { app, page, dir } = await launch({}, { theme, mascotName: 'Surf' })
    try {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Surf')
      const chip = page.locator('[data-sync-chip="yes"]')
      const scenes = [
        ['sync-idle', 'idle', 'Surf', `sync-idle-${theme}.png`, null],
        ['sync-syncing', 'syncing', 'Surf', `sync-syncing-${theme}.png`, 'rgb(242, 116, 15)'],
        ['sync-synced', 'synced', 'Surf · Synced', `sync-synced-${theme}.png`, 'rgb(21, 128, 61)'],
        ['sync-failed', 'failed', 'Sync failed', `sync-failed-${theme}.png`, theme === 'dark' ? 'rgb(63, 18, 18)' : 'rgb(254, 242, 242)'],
        ['sync-offline', 'offline', 'Offline', `sync-offline-${theme}.png`, null],
      ]
      for (const [scene, state, text, name, background] of scenes) {
        await page.evaluate((next) => window.__surfDemo && window.__surfDemo(next), scene)
        await expect(chip).toHaveAttribute('data-sync-state', state)
        await expect(chip).toHaveAttribute('data-sync-label', text)
        await expect(chip.locator('[data-sync-start="yes"]')).toHaveText(text)
        await expect(page.locator('.shell-side')).not.toContainText('Dev mode')
        await expect(page.locator('.shell-side')).not.toContainText('Surf Bot')
        if (background) {
          await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(background)
        }
        const ink = await chip.locator('[data-sync-start="yes"]').evaluate((el) => getComputedStyle(el).color)
        expect(ink).not.toBe(background)
        await expect(chip).toHaveScreenshot(name)
      }
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('chat header is the bot name and agent badge, and device control is refused', async () => {
  const { app, page, dir } = await launch({})
  try {
    await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Surf')
    await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
    await expect(page.locator('header')).not.toContainText('Which model should I pick?')
    await page.locator('textarea').fill('take control of my Mac and open files')
    await page.getByRole('button', { name: 'Send' }).click()
    const reply = page.locator('[data-assistant-message="yes"]')
    await expect(reply).toContainText("isn't available yet", { timeout: 20_000 })
    await expect(reply).not.toContainText('I opened')
    await expect(reply.locator('[data-assistant-name="yes"]')).toHaveText('Surf')
    await expect(page.locator('[data-user-message="yes"]')).toHaveText('take control of my Mac and open files')
    await expect(page.locator('[data-chat-row].is-on')).toContainText('take control')
    await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
    await expect(page.locator('header')).not.toContainText('take control')
    await expect(page.locator('header')).not.toContainText('Which model should I pick?')
    await expect(reply).toHaveScreenshot('device-control-reply.png')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the header bot name renames, persists, and falls back to Surf', async () => {
  test.setTimeout(120_000)
  for (const theme of ['light', 'dark']) {
    const { app, page, dir } = await launch({}, { theme, mascotName: 'Surf' })
    try {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const header = page.locator('header')
      const pill = page.locator('[data-chat-header="yes"]')
      await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Surf')
      await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
      await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Surf')
      await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Message Surf…')
      await expect(header).not.toContainText('what is 2+2')
      await expect(pill).toHaveScreenshot(`header-surf-${theme}.png`)

      await page.locator('[data-bot-name="yes"]').click()
      const editor = page.locator('[data-bot-name-edit="yes"]')
      await editor.fill('Harbor')
      await editor.press('End')
      await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
      await expect(pill).toHaveScreenshot(`header-edit-${theme}.png`)
      await editor.press('Enter')
      await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Harbor')
      await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
      await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Harbor')
      await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Message Harbor…')
      await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-label', 'Offline')
      await expect.poll(() => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).mascotName).toBe('Harbor')
      await expect(pill).toHaveScreenshot(`header-renamed-${theme}.png`)

      if (theme === 'light') {
        await page.locator('[data-bot-name="yes"]').click()
        await page.locator('[data-bot-name-edit="yes"]').fill('Tide')
        await page.locator('[data-bot-name-edit="yes"]').press('Escape')
        await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Harbor')
        await expect(page.locator('[data-bot-name-edit="yes"]')).toHaveCount(0)

        await page.locator('[data-bot-name="yes"]').click()
        await page.locator('[data-bot-name-edit="yes"]').fill('')
        await page.locator('[data-bot-name-edit="yes"]').press('Enter')
        await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Surf')
        await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Surf')
        await expect.poll(() => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).mascotName).toBe('Surf')

        await page.locator('[data-bot-name="yes"]').click()
        await page.locator('[data-bot-name-edit="yes"]').fill('x'.repeat(40))
        await expect(page.locator('[data-bot-name-edit="yes"]')).toHaveValue('x'.repeat(32))
        await page.locator('[data-bot-name-edit="yes"]').press('Enter')
        await expect(page.locator('[data-bot-name="yes"]')).toHaveText('x'.repeat(32))
        await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('x'.repeat(32))

        await go(page, 'settings')
        const field = page.locator('[data-bot-name-field="yes"]')
        await expect(field).toHaveValue('x'.repeat(32))
        await field.fill('   ')
        await field.blur()
        await expect(field).toHaveValue('Surf')
        await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Surf')
        await field.fill('Lumen')
        await field.blur()
        await expect(page.locator('[data-mascot-name="yes"]')).toHaveValue('Lumen')
        await expect.poll(() => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).mascotName).toBe('Lumen')
        await page.locator('[data-settings-nav="network"]').click()
        await page.locator('[data-network-settings="yes"] [data-network-mode="online"]').click()
        await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-state', 'idle')
        await expect(page.locator('[data-sync-chip="yes"]')).toHaveAttribute('data-sync-label', 'Lumen')
        await go(page, 'chat')
        await expect(page.locator('[data-bot-name="yes"]')).toHaveText('Lumen')
        await expect(page.locator('[data-agent-pill="yes"]')).toHaveText('Code')
        await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Message Lumen…')
      }
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
