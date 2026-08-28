import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    ViteImageOptimizer({
      // public/ 디렉터리 이미지까지 빌드 시 함께 압축
      includePublic: true,
      png: { quality: 80 },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { lossless: false, quality: 80 },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
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
      '/prints': { target: 'http://localhost:8080', changeOrigin: true },
    }
  }
})