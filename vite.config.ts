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
     * 整个 JS 的 hash 就变，缓存全作废。出成文件反而更好：改素材只失效
     * 那几张，而且能单独决定它们进不进离线包（见下面的 assetFileNames）。
     */
    assetsInlineLimit: (file) => (/\.(webp|png|jpe?g)$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        /*
         * 把几个不常变的依赖单独拿出来。
         *
         * 这一刀省的不是第一次打开，是**每一次更新**。
         *
         * 离线包里的 JS 是按文件名（带内容 hash）算新旧的：名字没变
         * 就不重下。React、react-dom、supabase-js 加起来 112 KB（压缩后），
         * 而它们几个月才动一次 —— 和天天在改的业务代码打包在一起的话，
         * 每发一版所有人都要把这 112 KB 再下一遍。
         *
         * 分开之后，一次普通更新只下业务那一块（129 KB → 只重下它）。
         * 第一次打开的总量一点没变，多一个请求而已。
         *
         * 只点名这几个，不写「所有 node_modules」—— 试过，那样会把
         * leaflet 也拽进来，而 leaflet 本来是跟着地图那一屏懒加载的
         * （151 KB），拽进来就变成人人都要下。
         */
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('node_modules/react/')) return 'vendor-react'
          if (id.includes('node_modules/scheduler')) return 'vendor-react'
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          return undefined
        },
        /*
         * 换装素材单独出到 assets/dress/，别的资源照旧。
         *
         * 分出来只为一件事：让 Service Worker 认得出它们。
         * 这两百来个文件一共 2.1 MB，占了离线包的三分之二，而其中
         * 绝大多数是商店里那些还没买的衣服 —— 一个新人第一次打开
         * App，要先在 4G 上把它们全下完才算装好，而他可能根本
         * 不碰换装。
         *
         * 分完之后：预缓存里不放它们（globIgnores），改成用到哪张
         * 下哪张、下过就留着（runtimeCaching）。见下面 workbox 那段。
         *
         * 靠源文件路径判断，不靠文件名 —— 文件名会撞（两套素材里
         * 都有 top-01.webp，正是靠文件夹分开的）。
         */
        assetFileNames: (info) => {
          const from = info.originalFileNames?.[0] ?? ''
          if (/src\/assets\/dressup(-m)?\//.test(from)) {
            return 'assets/dress/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
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
      includeAssets: ['favicon-96-v2.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'RALLY 羽球社交竞技平台',
        short_name: 'RALLY',
        description: '让球友从到场、配对、比赛、记分到成长，在一处完成',
        lang: 'zh-CN',
        theme_color: '#f2f8f2',
        background_color: '#f2f8f2',
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
         * 换装素材不进预缓存。
         *
         * 它是离线包里最大的一块（2.1 MB / 3.4 MB），而且这 2.1 MB
         * 里绝大部分是商店里还没买的衣服。原来的做法是装 App 的时候
         * 一次性全下 —— 一个刚被拉进来的球友，在球馆的 4G 下要等
         * 三四兆下完才算装好，而他多半只想看今晚谁在打球。
         *
         * 改成用到哪张下哪张（见下面的 runtimeCaching），下过就留着。
         * 代价是第一次打开时自己那身行头要现下 —— 十来张小图，
         * 而那一刻他反正在联网（不联网连球局都拉不到）。
         * 下过一次之后离线照样穿得上。
         */
        globIgnores: ['assets/dress/**'],
        runtimeCaching: [
          {
            /*
             * 下过就一直用本地那份，不再回头问服务器 ——
             * 这些文件名里带内容 hash，内容变了就是另一个名字，
             * 所以「旧的那份是不是过期了」这个问题根本不存在。
             */
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/assets/dress/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'rally-dress',
              expiration: {
                // 两套素材一共 178 个文件，留够一整套还有富余
                maxEntries: 220,
                maxAgeSeconds: 180 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
        /*
         * 离线包现在是 35 个文件、压缩后 617 KB（换装那 2.1 MB 已经
         * 挪去按需下载）。默认 2 MiB 的单文件上限够用。
         *
         * 这个数字会长。哪天又觉得装 App 太慢，先跑一遍
         * `npm run build` 看 precache 那一行，再决定动谁 ——
         * 别凭印象猜，上一次凭印象猜的结果是盯着 800 KB 的 JS 看了
         * 半天，而真正胖的是那 2.1 MB 没人看的衣服。
         */
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * 测试跑在马来西亚时区，不是 UTC。
     *
     * 用户全在 UTC+8，而这个 App 里到处是「今天是哪一天」的判断 ——
     * 球局按 date 归属、日历按周走、跨零点还在打的那种局算前一天。
     * 这类 bug 最典型的样子是 `d.toISOString().slice(0,10)`：在 UTC 上
     * 完全正确，一到 UTC+8 就把晚上八点的球局记成前一天，
     * 而晚上八点正是羽球局最常见的时间。
     *
     * CI 默认是 UTC，那种环境下这类错的测试根本不会红 ——
     * 这一行是实测出来的：不加它，「用本地时区不是 UTC」那条测试
     * 换成错的实现照样通过。
     */
    env: { TZ: 'Asia/Kuala_Lumpur' },
  },
})
