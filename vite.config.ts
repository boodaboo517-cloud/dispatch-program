/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// 화면에 보여 줄 앱 버전: 빌드 시각(한국) · 커밋
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? (() => { try { return execSync('git rev-parse HEAD').toString(); } catch { return ''; } })()).trim().slice(0, 7);
const built = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`${built}${commit ? ` · ${commit}` : ''}`) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: '경민물류 배차',
        short_name: '경민배차',
        description: '경민물류 일정표 · 배차 관리',
        lang: 'ko',
        theme_color: '#b91c1c',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        // KM logistic 로고 (maskable = 안드로이드 원형·둥근 사각 아이콘용 여백 포함)
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        // 업데이트 시 옛 캐시를 지우고 새 버전으로 바로 바꾼다
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
