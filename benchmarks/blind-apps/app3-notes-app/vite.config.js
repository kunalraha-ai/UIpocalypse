import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app must serve on port 5174.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: true,
  },
})
