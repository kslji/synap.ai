import { useEffect, type RefObject } from 'react'

const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n))

export interface ParallaxOptions {
  /** Tilt in degrees at the edge of the surface. */
  maxTilt?: number
  /** Stops the effect, for example when the app turns mascot motion off. */
  disabled?: boolean
}

/**
 * Pointer-driven 3D parallax. The element receives `--px` and `--py` (-1..1) plus
 * `--rx` and `--ry` (degrees), so each `.parallax-layer` inside picks its own travel
 * with `--depth`. The pointer maths matches BlobMascot. When the reader asks for
 * reduced motion nothing is written and the layers stay flat.
 */
export function useParallax(
  ref: RefObject<HTMLElement | null>,
  { maxTilt = 7, disabled = false }: ParallaxOptions = {},
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const still = (): boolean => disabled || media.matches
    let frame = 0
    let x = 0
    let y = 0

    const clear = (): void => {
      el.style.removeProperty('--px')
      el.style.removeProperty('--py')
      el.style.removeProperty('--rx')
      el.style.removeProperty('--ry')
    }

    const paint = (): void => {
      frame = 0
      if (still()) {
        clear()
        return
      }
      el.style.setProperty('--px', x.toFixed(4))
      el.style.setProperty('--py', y.toFixed(4))
      el.style.setProperty('--rx', `${(-y * maxTilt).toFixed(3)}deg`)
      el.style.setProperty('--ry', `${(x * maxTilt).toFixed(3)}deg`)
    }

    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    const onMove = (ev: PointerEvent): void => {
      if (still()) return
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return
      x = clamp((ev.clientX - (box.left + box.width / 2)) / (box.width * 0.7), -1, 1)
      y = clamp((ev.clientY - (box.top + box.height / 2)) / (box.height * 0.7), -1, 1)
      schedule()
    }

    const rest = (): void => {
      x = 0
      y = 0
      schedule()
    }

    const sync = (): void => {
      if (!still()) return
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      clear()
    }

    sync()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('blur', rest)
    document.addEventListener('pointerleave', rest)
    media.addEventListener('change', sync)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', rest)
      document.removeEventListener('pointerleave', rest)
      media.removeEventListener('change', sync)
      clear()
    }
  }, [ref, maxTilt, disabled])
}
