import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // ★ selfDestroying: true — 기존 서비스워커를 강제 삭제
      // 서비스워커 캐시가 구버전 JS를 계속 제공하는 문제를 영구 해결
      // 브라우저가 새 SW를 받으면 즉시 자신을 unregister하고 캐시를 삭제함
      // → 이후 모든 방문은 Vercel에서 직접 최신 파일을 받음
      registerType: 'autoUpdate',
      selfDestroying: true,
      manifest: {
        name: 'Sales Trainer Pro',
        short_name: '세일즈 트레이너',
        description: 'AI와 함께 세일즈 실력을 한 단계 끌어올리세요',
        theme_color: '#1e293b',
        background_color: '#1e293b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        lang: 'ko',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
