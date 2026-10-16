import { useEffect, useRef, useState } from 'react'
import star from './assets/star-surf-256.webp'
import { MOUTH_PATH, blinkDelayMs, pickClick, poseAt, shouldAnimate, stillPose, type MascotPose } from './mascot'
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

function readReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
  const root = useRef<HTMLSpanElement>(null)
  const body = useRef<HTMLSpanElement>(null)
  const eyeL = useRef<SVGEllipseElement>(null)
  const eyeR = useRef<SVGEllipseElement>(null)
  const pupilL = useRef<SVGCircleElement>(null)
  const pupilR = useRef<SVGCircleElement>(null)
  const mouth = useRef<SVGPathElement>(null)
  const burst = useRef<{ id: string; started: number; until: number } | null>(null)
  const lean = useRef({ x: 0, y: 0 })
  const [reduced, setReduced] = useState(readReduced)
  const [shown, setShown] = useState<string>(state)
  const motion = shouldAnimate(animate, reduced)

  function apply(pose: MascotPose) {
    const el = body.current
    if (!el) return
    const turn = pose.rotate + lean.current.x
    const shiftX = pose.x + lean.current.y * 0.3
    el.style.transform = `translate(${shiftX.toFixed(2)}px, ${pose.y.toFixed(2)}px) rotate(${turn.toFixed(2)}deg) scale(${pose.scaleX.toFixed(3)}, ${pose.scaleY.toFixed(3)})`
    const shut = pose.wink ? 0.08 : pose.eyeOpen
    eyeL.current?.setAttribute('ry', String((pose.wink ? shut : pose.eyeOpen) * 6.5))
    eyeR.current?.setAttribute('ry', String(pose.eyeOpen * 6.5))
    pupilL.current?.setAttribute('cx', String(38 + pose.pupilX * 3))
    pupilL.current?.setAttribute('cy', String(46 + pose.pupilY * 2.4))
    pupilR.current?.setAttribute('cx', String(62 + pose.pupilX * 3))
    pupilR.current?.setAttribute('cy', String(46 + pose.pupilY * 2.4))
    mouth.current?.setAttribute('d', MOUTH_PATH[pose.mouth])
    root.current?.setAttribute('data-mascot-mouth', pose.mouth)
  }

  function playClick() {
    if (!clickable || !motion) return
    const choice = pickClick(Math.random())
    const started = performance.now()
    burst.current = { id: choice.id, started, until: started + choice.durationMs }
    setShown(choice.id)
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const el = root.current
    if (!followCursor || !el || state === 'error' || reduced) return
    const fine = window.matchMedia('(pointer: fine)')
    if (!fine.matches) return
    function onMove(event: PointerEvent) {
      if (!el) return
      const box = el.getBoundingClientRect()
      const dx = (event.clientX - (box.left + box.width / 2)) / Math.max(window.innerWidth, 1)
      const dy = (event.clientY - (box.top + box.height / 2)) / Math.max(window.innerHeight, 1)
      lean.current = {
        x: Math.max(-1, Math.min(1, dx)) * 10,
        y: Math.max(-1, Math.min(1, dy)) * 8,
      }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [followCursor, state, reduced])

  useEffect(() => {
    if (!motion) {
      lean.current = { x: 0, y: 0 }
      burst.current = null
      apply(stillPose())
      return
    }
    let frame = 0
    let blink = false
    let blinkTimer = 0
    const armBlink = () => {
      blinkTimer = window.setTimeout(() => {
        blink = true
        window.setTimeout(() => {
          blink = false
          if (state === 'idle') armBlink()
        }, 130)
      }, blinkDelayMs(Math.random()))
    }
    if (state === 'idle') armBlink()
    const started = performance.now()
    const tick = (now: number) => {
      const tap = burst.current
      if (tap && now >= tap.until) {
        burst.current = null
        setShown(state)
      }
      const live = burst.current
      const id = live ? live.id : state
      apply(poseAt(id, now - (live ? live.started : started), blink))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(blinkTimer)
    }
  }, [motion, state])

  return (
    <span
      ref={root}
      className={`star-surf ${motion ? `is-${shown}` : 'is-still'}`}
      style={{ width: size, height: size }}
      role={clickable ? 'button' : 'img'}
      tabIndex={clickable ? 0 : undefined}
      aria-label={label ?? LABELS[state]}
      data-star-surf={shown}
      data-mascot-animate={animate ? 'yes' : 'no'}
      data-reduced-motion={reduced ? 'yes' : 'no'}
      data-mascot-mouth="smile"
      onClick={clickable ? playClick : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          playClick()
        }
      } : undefined}
    >
      <span className="star-surf-body" ref={body}>
        <img src={star} alt="" width={size} height={size} draggable={false} />
        <svg className="star-surf-face" viewBox="0 0 100 100" aria-hidden="true" data-mascot-face="yes">
          <ellipse ref={eyeL} cx="38" cy="46" rx="6.5" ry="6.5" fill="#fffaf3" />
          <ellipse ref={eyeR} cx="62" cy="46" rx="6.5" ry="6.5" fill="#fffaf3" />
          <circle ref={pupilL} cx="38" cy="46" r="2.6" fill="#24180f" />
          <circle ref={pupilR} cx="62" cy="46" r="2.6" fill="#24180f" />
          <path ref={mouth} d={MOUTH_PATH.smile} fill="none" stroke="#24180f" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  )
}
