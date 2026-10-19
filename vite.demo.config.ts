// Builds the browser-only demo (no server): the real UI with web/src/demo standing in for the API.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@hocuspocus/provider': path.resolve(__dirname, 'web/src/demo/fakeProvider.ts') },
  },
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'web/demo.html') },
  },
})
