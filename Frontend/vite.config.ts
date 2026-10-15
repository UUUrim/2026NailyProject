import path from 'node:path'
import { defaultClientConditions, defineConfig } from 'vite'
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
    // onnxruntime-web의 .wasm(27MB)과 로더는 nailSegmenter.worker.ts가 직접 asset으로
    // 가져와 앱 서버에서 내려준다 - 그것들을 따로 하나 더 붙여 넣는 번들 배포판 대신
    // 외부 파일을 쓰는 배포판을 쓴다.
    conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'],
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  // 손톱 분할 워커(nailSegmenter.worker.ts)가 onnxruntime-web을 ES 모듈로 불러온다.
  worker: {
    format: 'es',
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