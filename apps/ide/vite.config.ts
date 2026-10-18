import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { fs: { allow: [resolve('../..')] } },
  resolve: {
    alias: [
      { find: '@surf/ui/tokens.css', replacement: resolve('../../packages/ui/src/tokens.css') },
      { find: '@surf/ui/components.css', replacement: resolve('../../packages/ui/src/components.css') },
      { find: '@surf/ui', replacement: resolve('../../packages/ui/src/index.ts') },
    ],
  },
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.worker'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor'],
        },
      },
    },
  },
})
