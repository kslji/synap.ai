import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MascotColorProvider } from '@surf/ui'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import App from './App'
import { MascotActivityProvider } from './mascot-activity'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MascotColorProvider>
      <MascotActivityProvider>
        <App />
      </MascotActivityProvider>
    </MascotColorProvider>
  </StrictMode>,
)
