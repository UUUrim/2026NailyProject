import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/users': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/chats': { target: 'http://localhost:8080', changeOrigin: true },
      '/designs': { target: 'http://localhost:8080', changeOrigin: true },
      '/scans': { target: 'http://localhost:8080', changeOrigin: true },
    }
  }
})