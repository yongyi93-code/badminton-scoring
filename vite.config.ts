// vitest 的 config 包装了 vite 的，这样才能在同一个文件里写 test 配置
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

/**
 * 构建版本号。CI 上直接用 GITHUB_SHA，本地退回读 git，
 * 都拿不到就标 dev —— 印在首页，用来确认手机上跑的是不是最新版。
 */
const buildId = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

export default defineConfig({
  base: './',
  build: {
    /*
     * 图片一律出成独立文件，不内联成 data URI。
     *
     * 分层换装有九十来个小文件，其中掩膜压完只有一两 KB，默认规则会把它们
     * 塞进主 JS 里 —— 首屏要下的那个包白白胖了几十 KB，而且这些图改一次
     * 整个 JS 的 hash 就变，缓存全作废。出成文件反而更好：Service Worker
     * 照样会预缓存，离线一样能用，改素材也只失效那几张。
     */
    assetsInlineLimit: (file) => (/\.(webp|png|jpe?g)$/.test(file) ? false : undefined),
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'RALLY 羽球社交竞技平台',
        short_name: 'RALLY',
        description: '让球友从到场、配对、比赛、记分到成长，在一处完成',
        lang: 'zh-CN',
        theme_color: '#f6fafa',
        background_color: '#f6fafa',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // webp 是角色立绘 —— 漏了它离线时头像会变成空白
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // 十张立绘约 220KB，加上代码离线包到 700KB 上下，默认 2MiB 的上限够用
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
