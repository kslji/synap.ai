export interface CodeShot {
  id: string
  name: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  base64: string
}

export function CodeShots({
  shots,
  onRemove,
  onSave,
}: {
  shots: CodeShot[]
  onRemove: (id: string) => void
  onSave: (id: string) => void
}) {
  if (!shots.length) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-code-shots="yes">
      {shots.map((shot) => (
        <li key={shot.id} className="flex items-center gap-2 rounded-full bg-[var(--bg)] px-3 py-1 text-xs" data-code-shot={shot.id}>
          <img alt="" className="h-8 w-8 rounded object-cover" src={`data:${shot.mime};base64,${shot.base64}`} />
          <span className="max-w-[10rem] truncate">{shot.name}</span>
          <button type="button" className="btn btn-ghost" data-shot-save={shot.id} onClick={() => onSave(shot.id)}>Save</button>
          <button type="button" className="btn btn-ghost" data-shot-remove={shot.id} onClick={() => onRemove(shot.id)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}

function shotMime(type: string): CodeShot['mime'] | null {
  if (type === 'image/jpg' || type === 'image/jpeg') return 'image/jpeg'
  if (type === 'image/png' || type === 'image/webp') return type
  return null
}

export function readShotFile(file: File): Promise<Omit<CodeShot, 'id'> | null> {
  const mime = shotMime(file.type)
  if (!mime) return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => {
      const raw = String(reader.result ?? '')
      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : ''
      if (!base64) resolve(null)
      else resolve({ mime, base64, name: file.name || 'Screenshot' })
    }
    reader.readAsDataURL(file)
  })
}
