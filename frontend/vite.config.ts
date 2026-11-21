import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Standalone Vite config for the UIpocalypse frontend (derived from the
// Figma Make export; the Figma-only plugins and dev-server coupling are
// removed — this builds and runs anywhere).
export default defineConfig(({ mode }) => ({
  base: '/',
  build: {
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    proxy: {
      // dev-time: the UI talks to the local tool's web API
      '/api': 'http://127.0.0.1:4310',
    },
  },
}))
