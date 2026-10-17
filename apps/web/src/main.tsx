import { StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import { MascotColorProvider, useMascotColor, useMascotColorSetter } from '@surf/ui'
import { App } from './App'
import './styles.css'

const PIP_KEY = 'synap-site-pip'

function SitePipColor({ children }: { children: ReactNode }) {
  const color = useMascotColor()
  const setColor = useMascotColorSetter()
  useEffect(() => {
    const saved = localStorage.getItem(PIP_KEY)
    if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) setColor(saved)
  }, [setColor])
  useEffect(() => {
    localStorage.setItem(PIP_KEY, color)
  }, [color])
  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MascotColorProvider>
      <SitePipColor>
        <App />
      </SitePipColor>
    </MascotColorProvider>
  </StrictMode>,
)
