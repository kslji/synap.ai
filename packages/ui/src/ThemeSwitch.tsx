/** createElement keeps this renderable from the node unit test without a JSX transform. */
import { createElement, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { themeSwitchChoice, type ThemeChoice } from './theme'

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export function ThemeSwitch({
  value,
  onChange,
  compact = false,
}: {
  value: ThemeChoice
  onChange: (next: ThemeChoice) => void
  compact?: boolean
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const [applied, setApplied] = useState<string | null | undefined>(readAppliedTheme)
  const shown = themeSwitchChoice(applied, value)

  useEffect(() => {
    const root = document.documentElement
    const read = () => setApplied(root.getAttribute('data-theme'))
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    read()
    const id = window.setTimeout(() => root.classList.add('theme-ready'), 40)
    return () => {
      window.clearTimeout(id)
      observer.disconnect()
    }
  }, [])

  function move(from: number, dir: 1 | -1) {
    const next = OPTIONS[(from + dir + OPTIONS.length) % OPTIONS.length]
    onChange(next.id)
    queueMicrotask(() => refs.current[OPTIONS.findIndex((o) => o.id === next.id)]?.focus())
  }

  return createElement(
    'div',
    { role: 'radiogroup', 'aria-label': 'Color theme', className: `theme-switch${compact ? ' is-compact' : ''}` },
    OPTIONS.map((opt, i) => createElement(
      'button',
      {
        key: opt.id,
        ref: (el: HTMLButtonElement | null) => { refs.current[i] = el },
        type: 'button',
        role: 'radio',
        'aria-checked': shown === opt.id,
        'aria-label': opt.label,
        'data-theme-choice': opt.id,
        tabIndex: shown === opt.id ? 0 : -1,
        onClick: () => onChange(opt.id),
        onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1) }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1) }
        },
      },
      createElement(ThemeIcon, { id: opt.id }),
      !compact ? createElement('span', null, opt.label) : null,
    )),
  )
}

function readAppliedTheme(): string | null | undefined {
  if (typeof document === 'undefined') return undefined
  return document.documentElement?.getAttribute('data-theme')
}

function ThemeIcon({ id }: { id: ThemeChoice }): ReactNode {
  if (id === 'light') {
    return createElement(
      'svg',
      { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': true },
      createElement('circle', { cx: '8', cy: '8', r: '3', fill: 'currentColor' }),
      createElement(
        'g',
        { stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' },
        createElement('path', { d: 'M8 1.2 V3.2 M8 12.8 V14.8 M1.2 8 H3.2 M12.8 8 H14.8 M3.2 3.2 L4.6 4.6 M11.4 11.4 L12.8 12.8 M12.8 3.2 L11.4 4.6 M4.6 11.4 L3.2 12.8' }),
      ),
    )
  }
  return createElement(
    'svg',
    { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': true },
    createElement('path', { fill: 'currentColor', d: 'M9.2 1.6a5.8 5.8 0 1 0 5.2 8.4 4.7 4.7 0 0 1-5.2-8.4z' }),
  )
}
