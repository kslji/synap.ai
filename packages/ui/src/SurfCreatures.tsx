import { useEffect } from 'react'

export type SurfMood = 'idle' | 'thinking' | 'answering' | 'working' | 'searching' | 'offline' | 'error'

const CSS = `
.surf-crew { display: flex; align-items: flex-end; justify-content: center; gap: 2%; }
.surf-crew svg { overflow: visible; display: block; }
.surf-crew .eyes { transform-box: fill-box; transform-origin: center; animation: surf-blink 5.4s infinite; }
.surf-crew .shut { display: none; }
.surf-crew .anchor, .surf-crew .doze, .surf-crew .bubbles, .surf-crew .juggle, .surf-crew .scope { display: none; }
.surf-crew.is-idle .jelly { animation: surf-bob 2.8s ease-in-out infinite; }
.surf-crew.is-idle .tent { transform-box: fill-box; transform-origin: 50% 0%; animation: surf-sway 2.6s ease-in-out infinite; }
.surf-crew.is-idle .tent.t2 { animation-delay: -0.4s; }
.surf-crew.is-idle .tent.t3 { animation-delay: -0.9s; }
.surf-crew.is-idle .tent.t4 { animation-delay: -1.3s; }
.surf-crew.is-idle .horse { animation: surf-bob 3.1s ease-in-out infinite; }
.surf-crew.is-idle .tail { transform-box: fill-box; transform-origin: 70% 20%; animation: surf-curl 3s ease-in-out infinite; }
.surf-crew.is-idle .arm { transform-box: fill-box; transform-origin: 50% 0%; animation: surf-sway 2.7s ease-in-out infinite; }
.surf-crew.is-idle .arm.a2 { animation-delay: -0.3s; }
.surf-crew.is-idle .arm.a3 { animation-delay: -0.7s; }
.surf-crew.is-idle .arm.a4 { animation-delay: -1.1s; }
.surf-crew.is-idle .arm.a5 { animation-delay: -0.5s; }
.surf-crew.is-idle .arm.a6 { animation-delay: -1.4s; }
.surf-crew.is-idle .fish { animation: surf-bob 3.4s ease-in-out infinite; }
.surf-crew.is-thinking .jelly { animation: surf-pulse 1.05s ease-in-out infinite; }
.surf-crew.is-thinking .bubbles { display: block; }
.surf-crew.is-thinking .bubbles .bubble { transform-box: fill-box; transform-origin: center; animation: surf-rise 1.5s ease-in infinite; }
.surf-crew.is-thinking .bubbles .bubble:nth-child(2) { animation-delay: 0.35s; }
.surf-crew.is-thinking .bubbles .bubble:nth-child(3) { animation-delay: 0.7s; }
.surf-crew.is-answering .horse { animation: surf-type 0.48s ease-in-out infinite; }
.surf-crew.is-searching .scope { display: block; }
.surf-crew.is-searching .horse { animation: surf-look 1.6s ease-in-out infinite; }
.surf-crew.is-working .octo { animation: surf-pulse 0.9s ease-in-out infinite; }
.surf-crew.is-working .arm { transform-box: fill-box; transform-origin: 50% 0%; animation: surf-sway 0.7s ease-in-out infinite; }
.surf-crew.is-working .juggle { display: block; }
.surf-crew.is-working .juggle .ball { transform-box: fill-box; transform-origin: center; animation: surf-juggle 0.85s ease-in-out infinite; }
.surf-crew.is-working .juggle .ball:nth-child(2) { animation-delay: 0.16s; }
.surf-crew.is-working .juggle .ball:nth-child(3) { animation-delay: 0.32s; }
.surf-crew.is-offline { opacity: 0.62; }
.surf-crew.is-offline .jelly { animation: surf-drift 4.6s ease-in-out infinite; }
.surf-crew.is-offline .eyes { animation: none; }
.surf-crew.is-offline .open { display: none; }
.surf-crew.is-offline .shut { display: block; }
.surf-crew.is-offline .anchor { display: block; }
.surf-crew.is-offline .awake { display: none; }
.surf-crew.is-offline .doze { display: block; }
.surf-crew.is-error { animation: surf-wobble 0.42s ease-in-out infinite; transform-origin: center; }
@keyframes surf-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes surf-sway { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(6deg); } }
@keyframes surf-curl { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(8deg); } }
@keyframes surf-pulse { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-8px) scale(1.04); } }
@keyframes surf-type { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes surf-look { 0%,100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(2px, -4px) rotate(-3deg); } }
@keyframes surf-drift { 0%,100% { transform: translate(0, 0); } 50% { transform: translate(4px, 6px); } }
@keyframes surf-rise { 0% { transform: translateY(8px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateY(-28px); opacity: 0; } }
@keyframes surf-juggle { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-16px); } }
@keyframes surf-blink { 0%, 46%, 50%, 100% { transform: scaleY(1); } 48% { transform: scaleY(0.12); } }
@keyframes surf-wobble { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-4deg); } 70% { transform: rotate(4deg); } }
@media (prefers-reduced-motion: reduce) {
  .surf-crew, .surf-crew * { animation: none !important; }
}
`

function useCrewCss(): void {
  useEffect(() => {
    if (document.getElementById('surf-crew-css')) return
    const el = document.createElement('style')
    el.id = 'surf-crew-css'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

function Eyes({ cx, cy, r = 3.2 }: { cx: number; cy: number; r?: number }) {
  const gap = r * 2.6
  return (
    <g className="eyes">
      <g className="open">
        <circle cx={cx - gap} cy={cy} r={r} fill="#141414" />
        <circle cx={cx + gap} cy={cy} r={r} fill="#141414" />
      </g>
      <g className="shut" stroke="#141414" strokeWidth={Math.max(1.4, r * 0.55)} fill="none" strokeLinecap="round">
        <path d={`M ${cx - gap - r} ${cy} q ${r} ${r} ${r * 2} 0`} />
        <path d={`M ${cx + gap - r} ${cy} q ${r} ${r} ${r * 2} 0`} />
      </g>
    </g>
  )
}

export function Jellyfish({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 120 150" role="img" aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g className="jelly">
        <g className="bubbles" fill="none" stroke="#F97316" strokeWidth="2">
          <g className="bubble"><circle cx="28" cy="36" r="4" /></g>
          <g className="bubble"><circle cx="92" cy="28" r="3" /></g>
          <g className="bubble"><circle cx="18" cy="58" r="2.4" /></g>
        </g>
        <ellipse cx="60" cy="48" rx="34" ry="26" fill="#F97316" stroke="#141414" strokeWidth="2.5" />
        <ellipse cx="46" cy="38" rx="8" ry="5" fill="#ffffff" opacity="0.45" />
        <Eyes cx={60} cy={50} />
        <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path className="tent t1" d="M40 70 q -10 22 6 42" />
          <path className="tent t2" d="M54 74 q -2 24 2 44" />
          <path className="tent t3" d="M70 74 q 4 22 0 42" />
          <path className="tent t4" d="M84 70 q 12 20 -4 38" />
        </g>
      </g>
    </svg>
  )
}

export function Seahorse() {
  return (
    <svg viewBox="0 0 120 150" aria-hidden="true">
      <g className="horse">
        <g className="anchor" transform="translate(96 18)" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round">
          <circle cx="0" cy="0" r="3.2" />
          <path d="M0 3.2 V14" />
          <path d="M-7 10 q 7 6 14 0" />
        </g>
        <path className="tail" d="M62 108 C 48 124, 28 118, 34 102 C 38 92, 22 96, 28 112" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="64" cy="100" r="11" fill="#141414" stroke="#ffffff" strokeWidth="2" />
        <circle cx="70" cy="78" r="15" fill="#F97316" stroke="#141414" strokeWidth="2.5" />
        <circle cx="74" cy="50" r="18" fill="#F97316" stroke="#141414" strokeWidth="2.5" />
        <ellipse cx="98" cy="52" rx="11" ry="6" fill="#F97316" stroke="#141414" strokeWidth="2" />
        <path d="M56 46 q -16 6 -6 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <g className="scope" transform="translate(86 18)">
          <circle cx="16" cy="16" r="11" fill="#ffffff" stroke="#141414" strokeWidth="2" />
          <circle cx="16" cy="16" r="6" fill="none" stroke="#F97316" strokeWidth="2" />
          <circle cx="16" cy="16" r="2.2" fill="#141414" />
          <path d="M8 26 L2 38" stroke="#141414" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M24 26 L30 38" stroke="#141414" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g className="eyes">
          <g className="open">
            <circle cx="80" cy="46" r="5" fill="#ffffff" stroke="#141414" strokeWidth="1.4" />
            <circle cx="82" cy="46" r="2.2" fill="#141414" />
          </g>
          <path className="shut" d="M74 48 q 6 4 12 0" stroke="#141414" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  )
}

export function Octopus() {
  return (
    <svg viewBox="0 0 140 150" aria-hidden="true">
      <g className="octo">
        <g className="juggle">
          <g className="ball"><circle cx="24" cy="118" r="5" fill="#F97316" stroke="#141414" strokeWidth="1.4" /></g>
          <g className="ball"><circle cx="70" cy="128" r="4" fill="#ffffff" stroke="#141414" strokeWidth="1.4" /></g>
          <g className="ball"><circle cx="112" cy="116" r="5" fill="#141414" stroke="#ffffff" strokeWidth="1.4" /></g>
        </g>
        <g className="awake" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path className="arm a1" d="M40 78 Q 12 88 14 122" />
          <path className="arm a2" d="M50 84 Q 28 100 32 128" />
          <path className="arm a3" d="M62 88 Q 52 112 58 132" />
          <path className="arm a4" d="M78 88 Q 86 112 82 132" />
          <path className="arm a5" d="M90 84 Q 110 100 108 128" />
          <path className="arm a6" d="M100 78 Q 128 88 126 122" />
        </g>
        <g className="doze" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M48 80 q -8 10 2 16" />
          <path d="M58 86 q -4 8 4 12" />
          <path d="M68 88 q 0 8 2 12" />
          <path d="M78 88 q 2 8 0 12" />
          <path d="M88 86 q 6 8 -2 14" />
          <path d="M96 80 q 8 10 -2 16" />
        </g>
        <ellipse cx="70" cy="58" rx="36" ry="30" fill="#F97316" stroke="#141414" strokeWidth="2.5" />
        <ellipse cx="56" cy="46" rx="8" ry="5" fill="#ffffff" opacity="0.4" />
        <Eyes cx={70} cy={58} r={3.4} />
      </g>
    </svg>
  )
}

function Fish() {
  return (
    <svg viewBox="0 0 64 48" aria-hidden="true">
      <g className="fish">
        <path d="M8 24 L20 16 L20 32 Z" fill="currentColor" />
        <circle cx="36" cy="24" r="14" fill="#F97316" stroke="#141414" strokeWidth="2" />
        <circle cx="42" cy="22" r="2" fill="#141414" />
      </g>
    </svg>
  )
}

const LEAD: Record<SurfMood, string> = {
  idle: 'Jellyfish, seahorse, and octopus resting',
  thinking: 'Jellyfish thinking, bubbles rising',
  answering: 'Seahorse answering',
  searching: 'Seahorse looking through a telescope',
  working: 'Octopus juggling while a tool runs',
  offline: 'Jellyfish, seahorse, and octopus resting offline',
  error: 'The sea creatures wobble',
}

export function SurfCrew({
  mood = 'idle',
  size = 280,
  who = 'all',
  label,
}: {
  mood?: SurfMood
  size?: number
  who?: 'all' | 'jelly' | 'horse' | 'octo'
  label?: string
}) {
  useCrewCss()
  const title = label ?? LEAD[mood]
  const one = who !== 'all'
  return (
    <div
      className={`surf-crew is-${mood}`}
      style={{ width: size }}
      role="img"
      aria-label={title}
    >
      {(who === 'all' || who === 'jelly') && (
        <div style={{ width: one ? '100%' : '30%' }}><Jellyfish title={who === 'jelly' ? title : undefined} /></div>
      )}
      {who === 'all' && (
        <div style={{ width: '12%' }}><Fish /></div>
      )}
      {(who === 'all' || who === 'octo') && (
        <div style={{ width: one ? '100%' : '34%' }}><Octopus /></div>
      )}
      {(who === 'all' || who === 'horse') && (
        <div style={{ width: one ? '100%' : '28%' }}><Seahorse /></div>
      )}
    </div>
  )
}

export function castFor(mood: SurfMood): 'jelly' | 'horse' | 'octo' {
  if (mood === 'answering' || mood === 'searching') return 'horse'
  if (mood === 'working') return 'octo'
  return 'jelly'
}

export function SurfMark({ size = 32 }: { size?: number }) {
  useCrewCss()
  return (
    <div className="surf-crew is-idle" style={{ width: size }} role="img" aria-label="Surf AI">
      <Jellyfish title="Surf AI" />
    </div>
  )
}
