import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the browser talks only to Vite (same origin), which forwards /api to the Go server.
    // This avoids CORS entirely, so the backend needs no cross-origin settings.
    // API_PROXY_TARGET lets the end-to-end tests point Vite at their own API without touching the dev one.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8080' } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
