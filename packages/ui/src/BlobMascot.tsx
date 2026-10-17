import { useEffect, useId, useRef } from 'react'
import { advance, blobStateFor, createSim, paletteFor, SPARK_PATH, type BlobMood, type BlobVariant, type Sim } from './blob'
import { useMascotColor } from './mascot-color'
import './blob.css'

const NS = 'http://www.w3.org/2000/svg'

const LABEL: Record<BlobMood, string> = {
  idle: 'looking around',
  thinking: 'thinking',
  working: 'working',
  happy: 'done',
  oops: 'something went wrong',
  searching: 'searching',
  reading: 'reading',
  writing: 'writing',
  permission: 'waiting',
  typing: 'watching the message',
  offline: 'offline',
  sleepy: 'resting',
  benchmark: 'measuring',
  wink: 'winking',
  guiding: 'here',
  notification: 'notice',
  dizzy: 'dizzy',
  listening: 'listening',
}

export interface BlobMascotProps {
  state?: string
  size?: number
  variant?: BlobVariant
  /** Overrides the saved colour. The installed icon stays the default orange. */
  color?: string
  animate?: boolean
  clickable?: boolean
  followCursor?: boolean
  label?: string
  wink?: boolean
  /** 0..1, where the streaming caret is along the line. */
  caret?: number | null
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function BlobMascot({
  state = 'idle',
  size = 72,
  variant = 'full',
  color,
  animate = true,
  clickable = false,
  followCursor = false,
  label,
  wink = false,
  caret = null,
}: BlobMascotProps) {
  const saved = useMascotColor()
  const ink = color ?? saved
  const uid = useId().replace(/:/g, '')
  const svg = useRef<SVGSVGElement>(null)
  const body = useRef<SVGPathElement>(null)
  const hi = useRef<SVGPathElement>(null)
  const group = useRef<SVGGElement>(null)
  const face = useRef<SVGGElement>(null)
  const eyeL = useRef<SVGGElement>(null)
  const eyeR = useRef<SVGGElement>(null)
  const eyeFillL = useRef<SVGRectElement>(null)
  const eyeFillR = useRef<SVGRectElement>(null)
  const shadow = useRef<SVGEllipseElement>(null)
  const glow = useRef<SVGEllipseElement>(null)
  const glint = useRef<SVGGElement>(null)
  const fx = useRef<SVGGElement>(null)
  const top = useRef<SVGStopElement>(null)
  const bottom = useRef<SVGStopElement>(null)
  const sim = useRef<Sim>(createSim())
  const last = useRef(0)
  const props = useRef({ state, variant, animate, followCursor, wink, caret, ink, clickable })
  props.current = { state, variant, animate, followCursor, wink, caret, ink, clickable }
  const reduced = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const hover = useRef(false)
  const poke = useRef(false)
  const winkEdge = useRef(false)
  const paintRef = useRef<(snap: boolean) => void>(() => undefined)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => { reduced.current = media.matches }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onMove = (ev: PointerEvent) => {
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return
      const inside = ev.clientX >= box.left && ev.clientX <= box.right && ev.clientY >= box.top && ev.clientY <= box.bottom
      hover.current = inside
      if (!inside && !props.current.followCursor) return
      pointer.current = {
        x: clamp((ev.clientX - (box.left + box.width / 2)) / (box.width * 0.7), -1, 1),
        y: clamp((ev.clientY - (box.top + box.height / 2)) / (box.height * 0.7), -1, 1),
      }
    }
    const onLeave = () => { hover.current = false }
    window.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  useEffect(() => {
    let frame = 0
    let alive = true
    const paint = (ms: number, snap = false) => {
      const p = props.current
      const dt = last.current ? Math.min(0.05, (ms - last.current) / 1000) : 0.016
      last.current = ms
      const t = ms / 1000
      const pal = paletteFor(p.ink, blobStateFor(p.state) === 'offline')
      const draw = advance(sim.current, snap ? 0.35 : t, snap ? 0 : dt, {
        state: p.state,
        reduced: reduced.current,
        variant: p.variant,
        poke: poke.current,
        wink: winkEdge.current,
        caret: p.caret,
        pointer: pointer.current,
        hover: hover.current || p.followCursor,
        snap,
        glance: p.variant === 'mark' ? { x: 0.18, y: -0.12 } : undefined,
      }, pal.sparks)
      poke.current = false
      winkEdge.current = false
      body.current?.setAttribute('d', draw.d)
      hi.current?.setAttribute('d', draw.d)
      hi.current?.setAttribute('opacity', draw.showHighlight ? '1' : '0')
      group.current?.setAttribute('transform', draw.group)
      face.current?.setAttribute('transform', draw.face)
      eyeL.current?.setAttribute('transform', draw.eyeL)
      eyeR.current?.setAttribute('transform', draw.eyeR)
      eyeFillL.current?.setAttribute('fill', pal.eye)
      eyeFillR.current?.setAttribute('fill', pal.eye)
      shadow.current?.setAttribute('rx', String(draw.shadowRx))
      shadow.current?.setAttribute('opacity', draw.showShadow ? String(draw.shadowOp) : '0')
      glow.current?.setAttribute('fill', pal.glow)
      glow.current?.setAttribute('opacity', draw.showGlow ? (blobStateFor(p.state) === 'offline' ? '0.08' : '0.22') : '0')
      glint.current?.setAttribute('opacity', String(draw.glint))
      top.current?.setAttribute('stop-color', pal.top)
      bottom.current?.setAttribute('stop-color', pal.bottom)
      const host = fx.current
      if (host) {
        const sparks = draw.showSpark ? sim.current.sparks : []
        if (!draw.showSpark) sim.current.sparks.length = 0
        while (host.childNodes.length > sparks.length) host.lastChild?.remove()
        while (host.childNodes.length < sparks.length) {
          const node = document.createElementNS(NS, 'path')
          node.setAttribute('d', SPARK_PATH)
          host.appendChild(node)
        }
        sparks.forEach((spark, index) => {
          const node = host.childNodes[index] as SVGPathElement
          const scale = spark.sc * Math.min(1, spark.life * 2)
          node.setAttribute('fill', spark.color)
          node.setAttribute('transform', `translate(${spark.x},${spark.y}) rotate(${spark.r + t * 200}) scale(${scale})`)
        })
      }
    }
    paintRef.current = (snap: boolean) => paint(performance.now(), snap)
    const loop = (ms: number) => {
      if (!alive) return
      paint(ms)
      frame = window.requestAnimationFrame(loop)
    }
    const stop = () => {
      alive = false
      window.cancelAnimationFrame(frame)
    }
    const start = () => {
      if (alive) return
      alive = true
      last.current = 0
      frame = window.requestAnimationFrame(loop)
    }
    const onVis = () => {
      if (document.hidden) stop()
      else if (props.current.animate && props.current.variant !== 'mark') start()
    }
    document.addEventListener('visibilitychange', onVis)
    const frozen = variant === 'mark' || !animate
    paint(performance.now(), frozen)
    if (!frozen && !document.hidden) frame = window.requestAnimationFrame(loop)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [animate, variant])

  useEffect(() => {
    if (!animate || variant === 'mark') paintRef.current(true)
  }, [animate, variant, state, ink, caret])

  useEffect(() => {
    if (wink) winkEdge.current = true
  }, [wink])

  const mood = blobStateFor(state)
  const name = label?.trim() || 'Surf Bot'
  const svgNode = (
    <svg ref={svg} viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <linearGradient id={`gb-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop ref={top} offset="0" stopColor="#ffc27a" />
          <stop ref={bottom} offset="1" stopColor="#f2740f" />
        </linearGradient>
        <radialGradient id={`gh-${uid}`} cx="0.3" cy="0.22" r="0.55">
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse ref={glow} cx="200" cy="220" rx="130" ry="108" fill="#f2740f" opacity="0" />
      <ellipse ref={shadow} cx="200" cy="374" rx="90" ry="11" fill="#000" opacity="0.18" />
      <g ref={group}>
        <path ref={body} fill={`url(#gb-${uid})`} />
        <path ref={hi} fill={`url(#gh-${uid})`} />
        <g ref={face}>
          <g ref={eyeL}><rect ref={eyeFillL} x="-9" y="-23" width="18" height="46" rx="9" fill="#2b1204" /></g>
          <g ref={eyeR}><rect ref={eyeFillR} x="-9" y="-23" width="18" height="46" rx="9" fill="#2b1204" /></g>
          <g ref={glint} opacity="0" transform="translate(62,-34)">
            <circle cx="0" cy="0" r="7" fill="none" stroke="#fff8ea" strokeWidth="2.2" />
            <circle cx="-2.2" cy="-2.2" r="1.7" fill="#fff8ea" />
            <line x1="5" y1="5" x2="12" y2="12" stroke="#fff8ea" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        </g>
      </g>
      <g ref={fx} />
    </svg>
  )
  return (
    <div
      className={`blob-mascot${clickable ? ' is-clickable' : ''} is-${mood}`}
      style={{ ['--blob-size' as string]: `${size}px` }}
      data-blob-mascot="yes"
      data-blob-state={mood}
      data-blob-variant={variant}
      role={clickable ? 'button' : 'img'}
      tabIndex={clickable ? 0 : undefined}
      aria-label={`${name}, ${LABEL[mood]}`}
      onClick={clickable ? () => { poke.current = true } : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          poke.current = true
        }
      } : undefined}
    >
      {svgNode}
    </div>
  )
}
