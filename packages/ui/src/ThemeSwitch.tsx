import { useEffect, useRef } from 'react'
import type { ThemeChoice } from './theme'

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
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

  useEffect(() => {
    const root = document.documentElement
    const id = window.setTimeout(() => root.classList.add('theme-ready'), 40)
    return () => window.clearTimeout(id)
  }, [])

  function move(from: number, dir: 1 | -1) {
    const next = OPTIONS[(from + dir + OPTIONS.length) % OPTIONS.length]
    onChange(next.id)
    queueMicrotask(() => refs.current[OPTIONS.findIndex((o) => o.id === next.id)]?.focus())
  }

  return (
    <div role="radiogroup" aria-label="Color theme" className={`theme-switch${compact ? ' is-compact' : ''}`}>
      {OPTIONS.map((opt, i) => (
        <button
          key={opt.id}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          aria-label={opt.label}
          data-theme-choice={opt.id}
          tabIndex={value === opt.id ? 0 : -1}
          onClick={() => onChange(opt.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1) }
          }}
        >
          <ThemeIcon id={opt.id} />
          {!compact && <span>{opt.label}</span>}
        </button>
      ))}
    </div>
  )
}

function ThemeIcon({ id }: { id: ThemeChoice }) {
  if (id === 'light') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M8 1.2 V3.2 M8 12.8 V14.8 M1.2 8 H3.2 M12.8 8 H14.8 M3.2 3.2 L4.6 4.6 M11.4 11.4 L12.8 12.8 M12.8 3.2 L11.4 4.6 M4.6 11.4 L3.2 12.8" />
        </g>
      </svg>
    )
  }
  if (id === 'dark') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M9.2 1.6a5.8 5.8 0 1 0 5.2 8.4 4.7 4.7 0 0 1-5.2-8.4z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 13.5 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
