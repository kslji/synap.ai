import { useEffect, useRef } from 'react'
import star from './assets/star-surf-256.webp'
import './star-surf.css'

export type StarSurfState = 'idle' | 'arrive' | 'searching' | 'guiding' | 'notification' | 'success' | 'error'

const LABELS: Record<StarSurfState, string> = {
  idle: 'Star Surf floating',
  arrive: 'Star Surf swimming into view',
  searching: 'Star Surf searching',
  guiding: 'Star Surf pointing the way',
  notification: 'Star Surf with a notice',
  success: 'Star Surf hopping',
  error: 'Star Surf shaking',
}

export function starStateFor(kind: string): StarSurfState {
  if (kind === 'error') return 'error'
  if (kind === 'guiding') return 'guiding'
  if (kind === 'notification') return 'notification'
  if (kind === 'success') return 'success'
  if (kind === 'arrive') return 'arrive'
  if (kind === 'thinking' || kind === 'searching' || kind === 'working' || kind === 'answering') return 'searching'
  return 'idle'
}

export function StarSurf({
  state = 'idle',
  size = 128,
  followCursor = false,
  label,
}: {
  state?: StarSurfState
  size?: number
  followCursor?: boolean
  label?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!followCursor || !el || state === 'error') return
    const fine = window.matchMedia('(pointer: fine)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || reduced.matches) return
    function onMove(event: PointerEvent) {
      if (!el) return
      const box = el.getBoundingClientRect()
      const dx = (event.clientX - (box.left + box.width / 2)) / Math.max(window.innerWidth, 1)
      const dy = (event.clientY - (box.top + box.height / 2)) / Math.max(window.innerHeight, 1)
      el.style.setProperty('--lean-x', String(Math.max(-1, Math.min(1, dx)) * 10))
      el.style.setProperty('--lean-y', String(Math.max(-1, Math.min(1, dy)) * 8))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [followCursor, state])

  return (
    <span
      ref={ref}
      className={`star-surf is-${state}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? LABELS[state]}
      data-star-surf={state}
    >
      <span className="star-surf-bob">
        <img src={star} alt="" width={size} height={size} draggable={false} />
      </span>
      {state === 'arrive' && (
        <span className="star-bubbles" aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
      {state === 'searching' && (
        <span className="star-sparkles" aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
    </span>
  )
}
