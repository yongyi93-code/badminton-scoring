import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareFallback, shareImageData, shareSnapshot } from '@/lib/shareAssets'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('分享图的头像资源', () => {
  it('网络失败时显示球友名字，不能用透明图顶位', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await shareImageData('https://photos.example/a.png', '小明')
    expect(result).toBe(shareFallback('小明'))
    expect(decodeURIComponent(result)).toContain('小明')
    expect(decodeURIComponent(result)).toContain('fill="#dceadf"')
  })

  it('读取原图地址一次，不附加破坏缓存或签名的时间戳', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    })
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,cGhvdG8='
      onload?: () => void
      readAsDataURL() { this.onload?.() }
    })
    const src = 'https://photos.example/a.png?token=signed'
    expect(await shareImageData(src, 'Sean')).toBe('data:image/png;base64,cGhvdG8=')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe(src)
  })

  it('404 和返回 HTML 的图片都使用可见后备头像', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['login'], { type: 'text/html' }) })
    vi.stubGlobal('fetch', fetcher)
    expect(await shareImageData('/missing.png', '阿伟')).toBe(shareFallback('阿伟'))
    expect(await shareImageData('/login', '阿伟')).toBe(shareFallback('阿伟'))
  })

  it('慢网络有时间上限，不会无限卡在生成中', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetcher)
    const pending = shareImageData('/slow.png', '小林', 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(shareFallback('小林'))
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('已内嵌的头像无需再走网络', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const data = shareFallback('小明')
    expect(await shareImageData(data, '小明')).toBe(data)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('不允许姓名向后备 SVG 注入标签', () => {
    expect(decodeURIComponent(shareFallback('<x'))).not.toContain('<x')
  })

  it('屏幕外的懒加载照片在导出副本中变成主动加载的内嵌图片', async () => {
    const src = shareFallback('小明')
    const removed: string[] = []
    const image = {
      alt: '小明', loading: 'lazy', decoding: 'async', src,
      getAttribute: () => src,
      removeAttribute: (name: string) => removed.push(name),
    }
    const snapshot = {
      querySelectorAll: (tag: string) => tag === 'img' ? [image] : [],
    }
    const live = {
      cloneNode: () => snapshot,
      querySelectorAll: () => [],
    }
    await shareSnapshot(live as unknown as HTMLElement)
    expect(image.loading).toBe('eager')
    expect(image.decoding).toBe('sync')
    expect(image.src).toBe(src)
    expect(removed).toContain('srcset')
  })

  it.each(['pending', 'error', 'done'])('角色画布 %s 时也不会导出空圈', async (state) => {
    const image = { className: '', style: {} as Record<string, string>, src: '', alt: '' }
    vi.stubGlobal('document', { createElement: () => image })
    const source = {
      width: 100, height: 100, dataset: { paint: state },
      closest: () => ({ getAttribute: () => '小明' }),
      toDataURL: () => 'data:image/png;base64,Y2hhcmFjdGVy',
    }
    const target = { className: 'avatar', style: { cssText: 'opacity:0' }, replaceWith: vi.fn() }
    const snapshot = { querySelectorAll: (tag: string) => tag === 'canvas' ? [target] : [] }
    const live = { cloneNode: () => snapshot, querySelectorAll: () => [source] }
    await shareSnapshot(live as unknown as HTMLElement)
    expect(target.replaceWith).toHaveBeenCalledWith(image)
    expect(image.style.opacity).toBe('1')
    expect(image.style.transition).toBe('none')
    expect(image.src).toBe(state === 'done' ? source.toDataURL() : shareFallback('小明'))
  })
})
