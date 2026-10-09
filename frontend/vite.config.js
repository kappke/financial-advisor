import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['kappke-windows', 'kappke-windows.walrus-ruffe.ts.net'],
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
