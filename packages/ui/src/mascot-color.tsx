import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_BLOB_COLOR } from './blob'

const ColorCtx = createContext<{ color: string; setColor: (next: string) => void }>({
  color: DEFAULT_BLOB_COLOR,
  setColor: () => undefined,
})

export function MascotColorProvider({ children }: { children: ReactNode }) {
  const [color, setColor] = useState(DEFAULT_BLOB_COLOR)
  const value = useMemo(() => ({ color, setColor }), [color])
  return <ColorCtx.Provider value={value}>{children}</ColorCtx.Provider>
}

export function useMascotColor(): string {
  return useContext(ColorCtx).color
}

export function useMascotColorSetter(): (next: string) => void {
  return useContext(ColorCtx).setColor
}
