import { useEffect } from 'react'

export type SurfMood = 'idle' | 'thinking' | 'answering' | 'offline' | 'error'

const CSS = `
.surf-dots { display: block; overflow: visible; }
.surf-dots .bob { transform-box: fill-box; transform-origin: center; }
.surf-dots .eyes { transform-box: fill-box; transform-origin: center; animation: surf-blink 5.2s infinite; }
.surf-dots .shut { display: none; }
.surf-dots .anchor { display: none; }
.surf-dots.is-idle .b1 { animation: surf-bob 2.8s ease-in-out infinite; }
.surf-dots.is-idle .b2 { animation: surf-bob 2.8s ease-in-out infinite; animation-delay: -0.7s; }
.surf-dots.is-idle .b3 { animation: surf-bob 2.8s ease-in-out infinite; animation-delay: -1.5s; }
.surf-dots.is-idle .wave { animation: surf-wave 2.8s ease-in-out infinite; }
.surf-dots.is-thinking .b1 { animation: surf-ripple 1.15s ease-in-out infinite; }
.surf-dots.is-thinking .b2 { animation: surf-ripple 1.15s ease-in-out infinite; animation-delay: 0.16s; }
.surf-dots.is-thinking .b3 { animation: surf-ripple 1.15s ease-in-out infinite; animation-delay: 0.32s; }
.surf-dots.is-answering .b1 { animation: surf-type 0.52s ease-in-out infinite; }
.surf-dots.is-answering .b2 { animation: surf-type 0.52s ease-in-out infinite; animation-delay: 0.1s; }
.surf-dots.is-answering .b3 { animation: surf-type 0.52s ease-in-out infinite; animation-delay: 0.2s; }
.surf-dots.is-offline .anchor { display: block; }
.surf-dots.is-offline .open { display: none; }
.surf-dots.is-offline .shut { display: block; }
.surf-dots.is-offline .eyes { animation: none; }
.surf-dots.is-error .cluster { animation: surf-wobble 0.42s ease-in-out infinite; transform-origin: 110px 78px; }
@keyframes surf-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes surf-ripple { 0%,100% { transform: translateY(0) scale(1); } 45% { transform: translateY(-11px) scale(1.07); } }
@keyframes surf-type { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes surf-blink { 0%, 46%, 50%, 100% { transform: scaleY(1); } 48% { transform: scaleY(0.12); } }
@keyframes surf-wave { 0%,100% { transform: translateX(0); } 50% { transform: translateX(5px); } }
@keyframes surf-wobble { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-5deg); } 70% { transform: rotate(5deg); } }
@media (prefers-reduced-motion: reduce) {
  .surf-dots .bob, .surf-dots .eyes, .surf-dots .cluster, .surf-dots .wave { animation: none !important; }
}
`

function useSurfCss(): void {
  useEffect(() => {
    if (document.getElementById('surf-dots-css')) return
    const el = document.createElement('style')
    el.id = 'surf-dots-css'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

function Eyes({ cx, cy, r, light }: { cx: number; cy: number; r: number; light: boolean }) {
  const fill = light ? '#ffffff' : '#141414'
  const dx = r * 0.28
  const erx = r * 0.11
  const ery = r * 0.15
  return (
    <g className="eyes">
      <g className="open">
        <ellipse cx={cx - dx} cy={cy - r * 0.02} rx={erx} ry={ery} fill={fill} />
        <ellipse cx={cx + dx} cy={cy - r * 0.02} rx={erx} ry={ery} fill={fill} />
      </g>
      <g className="shut" stroke={fill} strokeWidth={Math.max(1.6, r * 0.08)} fill="none" strokeLinecap="round">
        <path d={`M ${cx - dx - erx} ${cy} q ${erx} ${ery} ${erx * 2} 0`} />
        <path d={`M ${cx + dx - erx} ${cy} q ${erx} ${ery} ${erx * 2} 0`} />
      </g>
    </g>
  )
}

export function SurfDots({
  mood = 'idle',
  size = 148,
  label,
  className,
}: {
  mood?: SurfMood
  size?: number
  label?: string
  className?: string
}) {
  useSurfCss()
  const title = label ?? `Surf dots, ${mood}`
  return (
    <svg
      className={`surf-dots is-${mood}${className ? ` ${className}` : ''}`}
      width={size}
      height={Math.round(size * 0.72)}
      viewBox="0 0 220 158"
      role="img"
      aria-label={title}
    >
      <ellipse cx="110" cy="146" rx="62" ry="6" fill="currentColor" opacity="0.12" />
      <path className="wave" d="M28 132 Q 70 118 110 132 T 192 132" fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />
      <g className="cluster">
        <g className="bob b1">
          <circle cx="52" cy="92" r="24" fill="#141414" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="42" cy="82" r="6" fill="#ffffff" opacity="0.22" />
          <Eyes cx={52} cy={90} r={24} light />
        </g>
        <g className="bob b2">
          <circle cx="112" cy="70" r="36" fill="#F97316" stroke="#141414" strokeWidth="2.5" />
          <circle cx="96" cy="56" r="8" fill="#ffffff" opacity="0.35" />
          <Eyes cx={112} cy={68} r={36} light={false} />
          <g className="anchor" transform="translate(112 22)" fill="none" stroke="#F97316" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="0" cy="0" r="4.2" />
            <path d="M0 4.2 V16" />
            <path d="M-9 12 q 9 8 18 0" />
          </g>
        </g>
        <g className="bob b3">
          <circle cx="172" cy="98" r="18" fill="#ffffff" stroke="#141414" strokeWidth="2.5" />
          <circle cx="165" cy="91" r="4" fill="#F97316" opacity="0.9" />
          <Eyes cx={172} cy={96} r={18} light={false} />
        </g>
      </g>
    </svg>
  )
}

export function SurfMark({ size = 32 }: { size?: number }) {
  return <SurfDots mood="idle" size={size} label="Surf AI" />
}
