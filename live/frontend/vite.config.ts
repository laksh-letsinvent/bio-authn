import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/enroll':  'http://localhost:8000',
      '/step-up': 'http://localhost:8000',
      '/users':   'http://localhost:8000',
      '/events':  'http://localhost:8000',
    },
  },
  resolve: {
    alias: {
      '@tokens': path.resolve(__dirname, '../../portal/styles/tokens.css'),
    },
  },
})
