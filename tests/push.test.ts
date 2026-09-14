import { describe, expect, it } from 'vitest'
import { readyOrNull, SW_WAIT_MS } from '@/lib/push'

/*
 * 这一份只钉一件事，但那件事线上真的卡住过人：
 *
 * navigator.serviceWorker.ready 没注册过 Service Worker 时既不
 * resolve 也不 reject，就那样一直挂着。await 它的那段代码整个停住，
 * try/catch 抓不到（没有异常），界面上的按钮永远停在「稍等…」。
 *
 * readyOrNull 的全部职责就是「不许无限等」。
 */

const never = () => new Promise<never>(() => {})

describe('等 Service Worker 就绪', () => {
  it('就绪了就把它交出来', async () => {
    const fake = { scope: '/' } as unknown as ServiceWorkerRegistration
    await expect(readyOrNull(Promise.resolve(fake), 50)).resolves.toBe(fake)
  })

  /*
   * 这一条是整份测试的理由。没有上限的话，它会一直跑到超时被杀，
   * 而线上对应的是一个永远按不动的开关。
   */
  it('一直等不到就返回 null，不会永远挂着', async () => {
    await expect(readyOrNull(never(), 20)).resolves.toBeNull()
  })

  it('按规范它不会 reject，但真 reject 了也当没就绪，不往外抛', async () => {
    await expect(readyOrNull(Promise.reject(new Error('炸了')), 20)).resolves.toBeNull()
  })

  /*
   * 先到的那个说了算。就绪比超时晚一点点也要等到 ——
   * 刚重载完的那一两秒里，Service Worker 正在注册，那是正常的。
   */
  it('赶在超时之前就绪，仍然算就绪', async () => {
    const fake = { scope: '/' } as unknown as ServiceWorkerRegistration
    const slow = new Promise<ServiceWorkerRegistration>((r) => setTimeout(() => r(fake), 10))
    await expect(readyOrNull(slow, 200)).resolves.toBe(fake)
  })

  /*
   * 上限本身也钉一下。这个数不是随手写的：ready 要等的是
   * 「装完了」，而装完 = 把 3.4 MB 的离线包下载一遍。
   * 第一版写的 8 秒正好卡在「装到一半」，于是提示跳出来说
   * 「后台服务没起来，重启 App」—— 而它其实好好地在下载，
   * 那句话把人指去做一件没用的事。
   */
  it('默认上限要给下载留够时间，不能是几秒', () => {
    expect(SW_WAIT_MS).toBeGreaterThanOrEqual(30_000)
  })
})
