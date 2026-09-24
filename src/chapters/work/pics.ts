/*
 * Screenshot loading: fetch → blob → createImageBitmap (decoded and resized
 * off the main thread at the size the CRT actually shows), falling back to a
 * plain <img> where that isn't available. Uploads run in idle slots.
 */

export interface Pic {
  src: ImageBitmap | HTMLImageElement
  bitmap: boolean
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function loadPic(url: string, w: number, h: number): Promise<Pic> {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    let blob: Blob | null = null
    try {
      const res = await fetch(url)
      if (res.ok) blob = await res.blob()
    } catch {
      blob = null
    }
    if (blob) {
      try {
        return { src: await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }), bitmap: true }
      } catch {
        /* resize options unsupported: decode at full size */
      }
      try {
        return { src: await createImageBitmap(blob), bitmap: true }
      } catch {
        /* fall through to <img> */
      }
    }
  }
  return { src: await loadImage(url), bitmap: false }
}

/** Run `fn` when the main thread is idle (or within `timeout` ms regardless). */
export const whenIdle = (fn: () => void, timeout: number) => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout })
  else window.setTimeout(fn, 34)
}
