import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ★ vite-plugin-pwa 제거 — 서비스워커 캐시가 구버전 JS를 계속 제공하는 문제 해결
// PWA/SW 없이 Vercel에서 직접 최신 파일을 받도록 변경
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
