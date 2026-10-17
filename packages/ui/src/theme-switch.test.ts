import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeSwitch } from './ThemeSwitch.tsx'
import { themeSwitchChoice, type ThemeChoice } from './theme.ts'

test('the painted theme wins over a stale switch value', () => {
  assert.equal(themeSwitchChoice('light', 'dark'), 'light')
  assert.equal(themeSwitchChoice('dark', 'light'), 'dark')
  assert.equal(themeSwitchChoice(undefined, 'dark'), 'dark')
  assert.equal(themeSwitchChoice(null, 'light'), 'light')
  assert.equal(themeSwitchChoice('system', 'light'), 'light')
})

test('the toggle highlights the theme on the document', () => {
  const previous = globalThis.document
  const theme = { current: 'light' }
  globalThis.document = {
    documentElement: {
      getAttribute(name: string) {
        return name === 'data-theme' ? theme.current : null
      },
    },
  } as unknown as Document
  try {
    const stale = renderToStaticMarkup(createElement(ThemeSwitch, { value: 'dark' as ThemeChoice, onChange: () => undefined }))
    assert.equal(checkedChoice(stale), 'light')
    theme.current = 'dark'
    const matched = renderToStaticMarkup(createElement(ThemeSwitch, { value: 'light' as ThemeChoice, onChange: () => undefined }))
    assert.equal(checkedChoice(matched), 'dark')
  } finally {
    if (previous === undefined) delete (globalThis as { document?: Document }).document
    else globalThis.document = previous
  }
})

function checkedChoice(html: string): string {
  const button = html.split('<button').find((part) => part.includes('aria-checked="true"'))
  assert.ok(button, html)
  const id = /data-theme-choice="(light|dark)"/.exec(button)?.[1]
  assert.ok(id, button)
  return id
}
