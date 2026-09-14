/* ------------------------------------------------------------------ *
 * 推送通知：Service Worker 这一侧
 *
 * 这个文件被 vite-plugin-pwa 生成的那个 Service Worker importScripts
 * 进去（见 vite.config.ts）。为什么不直接写进主 SW：那个是构建时
 * 生成的，改不了；而 importScripts 一句就能把自己的逻辑挂上去，
 * 又不用把整套预缓存改成手写模式（injectManifest）。
 *
 * 注意这里跑的是 Service Worker 环境：没有 window、没有 DOM，
 * 而且随时会被系统叫醒又睡下。所有活都得在 waitUntil 里干完，
 * 不然可能话说到一半就被冻住。
 * ------------------------------------------------------------------ */

/* global self, clients */

self.addEventListener('push', (event) => {
  /*
   * 推送内容拿不到也要弹一条。
   *
   * 规范上（以及某些浏览器的实现里）收到 push 却不弹通知，
   * 系统会认为你在偷偷用推送干别的事，几次之后直接吊销推送权限。
   * 所以哪怕解析失败，也给一条最朴素的。
   */
  let title = 'RALLY'
  let body = '有人开球局了'
  let url = './'
  let tag = 'rally-session'

  try {
    const data = event.data ? event.data.json() : {}
    if (data.title) title = data.title
    if (data.body) body = data.body
    if (data.url) url = data.url
    if (data.tag) tag = data.tag
  } catch {
    /* 不是 JSON 就用默认的那条 */
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      /*
       * 同一个 tag 的通知会互相顶掉，所以 tag 由发的那一头决定。
       *
       * 开局提醒共用一个：一晚上开三个局，通知栏里堆三条只会让人
       * 烦到关掉推送。私聊正相反 —— 三个人找你，只剩最后一条的话
       * 前两个就等于没找过，所以它按人分开（见 notify-social）。
       *
       * 原来这里写死成 rally-session，于是好友申请会把私信顶掉、
       * 私信又会把开局顶掉，三件事互相吃。
       */
      tag,
      renotify: true,
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || './'

  /*
   * 已经开着就切过去，没开才新开一个 —— 直接 openWindow 会在
   * App 已经在后台时又开一个，用户回头发现两个 RALLY。
   */
  /*
   * App 已经开着的时候，focus() 只是把它调到前台 —— 停在他离开时
   * 那一屏上。点「有人给你发消息」落回昨晚的记分板，是说不过去的。
   *
   * 所以除了 focus，还往那个页面喊一句「去这儿」，由页面自己跳。
   * 冷启动那条路不用喊：地址里带着 #friends，App 起来时自己会看。
   */
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (c.postMessage) c.postMessage({ type: 'rally-navigate', url: target })
          return c.focus()
        }
      }
      return clients.openWindow(target)
    }),
  )
})
