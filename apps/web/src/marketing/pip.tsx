import { useEffect, useState } from 'react'
import { BLOB_SWATCHES, BlobMascot, useMascotColor, useMascotColorSetter } from '@surf/ui'

const MOODS = [
  { state: 'idle', label: 'Idle' },
  { state: 'searching', label: 'Searching' },
  { state: 'thinking', label: 'Thinking' },
  { state: 'happy', label: 'Done' },
  { state: 'offline', label: 'Offline' },
] as const

export function PipPicker() {
  const color = useMascotColor()
  const setColor = useMascotColorSetter()
  const [custom, setCustom] = useState(color)
  useEffect(() => { setCustom(color) }, [color])
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Pip colour">
        {BLOB_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            className="swatch"
            style={{ background: swatch.hex }}
            aria-checked={color.toLowerCase() === swatch.hex}
            aria-label={swatch.label}
            onClick={() => setColor(swatch.hex)}
          />
        ))}
        <label className="ml-2 text-sm text-[var(--muted)]">
          Custom
          <input
            className="ml-2 align-middle"
            type="color"
            aria-label="Custom Pip colour"
            value={/^#[0-9a-fA-F]{6}$/.test(custom) ? custom : '#f2740f'}
            onChange={(event) => { setCustom(event.target.value); setColor(event.target.value) }}
          />
        </label>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
        This colour is for Pip on this website. The installed app icon stays orange.
      </p>
    </div>
  )
}

export function PipMoods() {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {MOODS.map((mood) => (
        <article key={mood.state} className="card flex flex-col items-center px-4 py-5">
          <BlobMascot state={mood.state} size={96} label={`Pip, ${mood.label}`} />
          <h3 className="mt-3 text-sm font-semibold">{mood.label}</h3>
        </article>
      ))}
    </div>
  )
}
