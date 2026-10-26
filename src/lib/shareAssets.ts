/** A visible, self-contained fallback: never export a transparent avatar. */
export function shareFallback(name = '?'): string {
  const label = (name.trim() || '?').slice(0, 2).replace(/[&<>"']/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#dceadf"/><text x="50" y="52" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#193c2b">${label || '?'}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Fetch once without cache-busting, so offline/cached and signed photos still work. */
export async function shareImageData(src: string, name: string, timeoutMs = 4000): Promise<string> {
  if (src.startsWith('data:')) return src
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error('Image unavailable')
        const blob = await response.blob()
        if (!blob.type.startsWith('image/')) throw new Error('Not an image')
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
      })(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve(shareFallback(name))
        }, timeoutMs)
      }),
    ])
  } catch {
    return shareFallback(name)
  } finally {
    clearTimeout(timer)
  }
}

/** Prepare a detached export copy; leave React's live images and canvases untouched. */
export async function shareSnapshot(node: HTMLElement): Promise<HTMLElement> {
  const snapshot = node.cloneNode(true) as HTMLElement
  const originals = node.querySelectorAll('canvas')
  snapshot.querySelectorAll('canvas').forEach((canvas, index) => {
    const source = originals[index]
    const image = document.createElement('img')
    image.className = canvas.className
    image.style.cssText = canvas.style.cssText
    // A finished canvas can still be in its opacity transition when sharing starts.
    image.style.opacity = '1'
    image.style.transition = 'none'
    image.width = source.width
    image.height = source.height
    const name = source.closest('[data-avatar-name]')?.getAttribute('data-avatar-name') ?? '?'
    image.alt = name
    try {
      if (source.dataset.paint === 'pending' || source.dataset.paint === 'error') throw new Error('Not painted')
      image.src = source.toDataURL()
      if (image.src === 'data:,') throw new Error('Empty canvas')
    } catch {
      image.src = shareFallback(name)
    }
    canvas.replaceWith(image)
  })

  const fetched = new Map<string, Promise<string>>()
  await Promise.all(Array.from(snapshot.querySelectorAll('img')).map(async (image) => {
    const src = image.getAttribute('src') ?? ''
    const name = image.alt || image.closest('[data-avatar-name]')?.getAttribute('data-avatar-name') || '?'
    const key = `${src}\n${name}`
    if (!fetched.has(key)) fetched.set(key, shareImageData(src, name))
    // Eager loading matters even on an offscreen node and on html-to-image's clone.
    image.loading = 'eager'
    image.decoding = 'sync'
    image.removeAttribute('srcset')
    image.removeAttribute('sizes')
    image.removeAttribute('crossorigin')
    image.src = await fetched.get(key)!
    image.onerror = () => { image.src = shareFallback(name) }
  }))
  return snapshot
}
