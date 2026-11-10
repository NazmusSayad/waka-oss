import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const alias = { '@': fileURLToPath(new URL('src', import.meta.url)) }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  server: {
    allowedHosts: ['.sayad.cc'],
    proxy: { '/api': 'http://localhost:3000' },
  },
})
