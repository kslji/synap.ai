import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { resolveBlobState, type BlobMood } from '@surf/ui'

/** Quiet this long, with no pointer or key, and Surf Bot rests. */
export const LONG_IDLE_MS = 3 * 60 * 1000

interface Activity {
  state: BlobMood
  caret: number | null
  setTask: (task: string | null) => void
  setTyping: (on: boolean) => void
  setPermission: (on: boolean) => void
  setBenchmark: (on: boolean) => void
  setOffline: (on: boolean) => void
  setCaret: (n: number | null) => void
}

const NOOP: Activity = {
  state: 'idle',
  caret: null,
  setTask: () => undefined,
  setTyping: () => undefined,
  setPermission: () => undefined,
  setBenchmark: () => undefined,
  setOffline: () => undefined,
  setCaret: () => undefined,
}

const Ctx = createContext<Activity>(NOOP)

export function MascotActivityProvider({ children }: { children: ReactNode }) {
  const [task, setTask] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [permission, setPermission] = useState(false)
  const [benchmark, setBenchmark] = useState(false)
  const [offline, setOffline] = useState(false)
  const [sleepy, setSleepy] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  const last = useRef(Date.now())

  const note = useCallback(() => {
    last.current = Date.now()
    setSleepy(false)
  }, [])

  useEffect(() => {
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
    for (const name of events) window.addEventListener(name, note, { passive: true })
    const id = window.setInterval(() => {
      if (Date.now() - last.current >= LONG_IDLE_MS) setSleepy(true)
    }, 5000)
    return () => {
      for (const name of events) window.removeEventListener(name, note)
      window.clearInterval(id)
    }
  }, [note])

  const state = resolveBlobState({ task, permission, benchmark, typing, offline, sleepy })
  const value = useMemo<Activity>(() => ({
    state,
    caret,
    setTask,
    setTyping,
    setPermission,
    setBenchmark,
    setOffline,
    setCaret,
  }), [state, caret])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMascotActivity(): Activity {
  return useContext(Ctx)
}
