import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'ocr-runner': resolve('src/main/core/ocr-runner.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: {
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer/src') },
        { find: '@surf/ui/tokens.css', replacement: resolve('../../packages/ui/src/tokens.css') },
        { find: '@surf/ui/components.css', replacement: resolve('../../packages/ui/src/components.css') },
        { find: '@surf/ui', replacement: resolve('../../packages/ui/src/index.ts') },
      ],
    },
    plugins: [react(), tailwindcss()],
  },
})
