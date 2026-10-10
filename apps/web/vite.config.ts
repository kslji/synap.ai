import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/',
  envPrefix: ['VITE_', 'SITE_'],
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: [resolve('../..')] } },
  resolve: {
    alias: [
      { find: '@surf/ui/tokens.css', replacement: resolve('../../packages/ui/src/tokens.css') },
      { find: '@surf/ui/components.css', replacement: resolve('../../packages/ui/src/components.css') },
      { find: '@surf/ui', replacement: resolve('../../packages/ui/src/index.ts') },
    ],
  },
})
