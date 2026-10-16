import { useEffect, useRef, useState } from 'react'
import star from './assets/star-surf-256.webp'
import { pickClick, type MascotMotion } from './mascot'
import './star-surf.css'

export type StarSurfState = 'idle' | 'arrive' | 'searching' | 'thinking' | 'guiding' | 'notification' | 'success' | 'error'

const LABELS: Record<StarSurfState, string> = {
  idle: 'Surf Bot floating',
  arrive: 'Surf Bot arriving',
  searching: 'Surf Bot searching',
  thinking: 'Surf Bot thinking',
  guiding: 'Surf Bot pointing the way',
  notification: 'Surf Bot with a notice',
  success: 'Surf Bot hopping',
  error: 'Surf Bot shaking',
}

export function starStateFor(kind: string): StarSurfState {
  if (kind === 'error') return 'error'
  if (kind === 'guiding') return 'guiding'
  if (kind === 'notification') return 'notification'
  if (kind === 'success') return 'success'
  if (kind === 'arrive') return 'arrive'
  if (kind === 'thinking') return 'thinking'
  if (kind === 'searching' || kind === 'working' || kind === 'answering') return 'searching'
  return 'idle'
}

export function StarSurf({
  state = 'idle',
  size = 128,
  followCursor = false,
  label,
  animate = true,
  clickable = false,
}: {
  state?: StarSurfState
  size?: number
  followCursor?: boolean
  label?: string
  /** When false the star stays still. There is no sound either way. */
  animate?: boolean
  clickable?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [burst, setBurst] = useState<MascotMotion | null>(null)
  const timer = useRef<number>(0)

  function playClick() {
    if (!clickable || !animate) return
    const motion = pickClick(Math.random())
    setBurst(motion)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setBurst(null), motion.durationMs)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

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

  const shown = burst?.id ?? state
  const motionClass = animate ? (burst?.className ?? `is-${state}`) : 'is-still'
  return (
    <span
      ref={ref}
      className={`star-surf ${motionClass}`}
      style={{ width: size, height: size }}
      role={clickable ? 'button' : 'img'}
      tabIndex={clickable ? 0 : undefined}
      aria-label={label ?? LABELS[state]}
      data-star-surf={shown}
      data-mascot-animate={animate ? 'yes' : 'no'}
      onClick={clickable ? playClick : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          playClick()
        }
      } : undefined}
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
