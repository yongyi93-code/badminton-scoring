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
    /*
     * 出一份 version.json，里面只有构建号。
     *
     * 页面靠它自己判断「我这份是不是过期了」：启动后拿网络上的这个文件
     * 和自己编译进来的构建号比一比，对不上就说明手上跑的是旧的。
     *
     * 为什么不能问 Service Worker：出问题的时候正是它在骗人 ——
     * 它端出一份旧的 index.html，页面自己毫不知情。所以这个文件
     * 故意不进预缓存（globPatterns 里没有 json），fetch 时又带
     * no-store，问到的必定是服务器上此刻的真相。
     */
    {
      name: 'rally-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: buildId }),
        })
      },
    },
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
        /*
         * 带 ?_v= 的那次导航一律走网络，不许拿预缓存里的 index.html 应付。
         *
         * 「检查更新」的做法是先注销 Service Worker 再重载。但注销要等
         * 页面卸载才真正生效，那次重载的导航请求仍然可能被旧的 Service
         * Worker 接住 —— 它照规矩端出自己预缓存的那份 index.html，
         * 于是「更新完还是旧版本」，而那份旧 HTML 引用的 JS 要是已经被
         * 系统清掉（手机存储紧张时很常见），拿到的就是一片白。
         *
         * ?_v= 是我们自己加的更新标记，只在这一次导航里出现，
         * 拿它当「这次别用缓存」的信号最准。
         */
        navigateFallbackDenylist: [/[?&]_v=/],
        /*
         * 把推送的处理逻辑挂进生成的 Service Worker。
         *
         * 生成的那个 SW 是构建产物，改不了；importScripts 一句就能把
         * 自己的 push / notificationclick 挂上去，又不用把整套预缓存
         * 换成手写模式（injectManifest）—— 那样每加一个资源都要自己维护。
         */
        importScripts: ['push-sw.js'],
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
