import type { BoardElement } from './types'
import { uid } from './utils'
import { useBoardStore } from './store'

/**
 * Image import pipeline: decode -> optional downscale -> re-encode, so a photo
 * stays small enough for the realtime broadcast payload and the REST batch.
 */

export interface ProcessedImage {
  dataUrl: string
  /** pixel size after downscale (aspect preserved) */
  w: number
  h: number
}

/** base64 char cap: ~640KB binary, safely under the Supabase broadcast limit */
const MAX_DATAURL = 850_000
/** longest allowed edge before quality reduction kicks in */
const MAX_EDGE = 1600

interface Decoded {
  src: CanvasImageSource
  w: number
  h: number
}

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { src: bmp, w: bmp.width, h: bmp.height }
    } catch {
      /* fall through to <img> decoding */
    }
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null
  return new Promise((res) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      res({ src: img, w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      res(null)
    }
    img.src = url
  })
}

/** encode at the given scale; JPEG gets a white backdrop (alpha would turn black) */
function encode(d: Decoded, scale: number, jpeg: boolean, quality: number): { dataUrl: string; w: number; h: number } | null {
  const canvas = document.createElement('canvas')
  const w = Math.max(1, Math.round(d.w * scale))
  const h = Math.max(1, Math.round(d.h * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (jpeg) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(d.src, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', quality), w, h }
}

/**
 * Decode + downscale + re-encode an image file.
 * Returns null when the file cannot be decoded or cannot be squeezed under
 * the payload cap even at the smallest supported quality.
 */
export async function processImageFile(file: Blob): Promise<ProcessedImage | null> {
  if (typeof document === 'undefined') return null
  const d = await decode(file)
  if (!d || d.w === 0 || d.h === 0) return null

  // PNG keeps transparency on round 0; anything else (and any too-big PNG)
  // goes through JPEG with a white backdrop.
  const pngFirst = file.type === 'image/png'
  let scale = Math.min(1, MAX_EDGE / Math.max(d.w, d.h))

  for (let round = 0; round < 7; round++) {
    const jpeg = !(pngFirst && round === 0)
    const quality = round === 0 ? 1 : round === 1 ? 0.85 : round === 2 ? 0.75 : round === 3 ? 0.7 : round === 4 ? 0.6 : 0.55
    const out = encode(d, scale, jpeg, quality)
    if (out && out.dataUrl.length <= MAX_DATAURL) return out
    if (round >= 2) scale *= 0.85 // dims shrink once quality alone stops helping
  }
  return null
}

/**
 * Place processed images at the center of the current viewport (slightly
 * staggered when several are added at once), sized to look right on screen.
 * Switches to the select tool and selects everything placed.
 */
export function placeImagesOnBoard(images: ProcessedImage[]): BoardElement[] {
  if (images.length === 0) return []
  const s = useBoardStore.getState()
  const zoom = s.camera.zoom || 1
  const maxW = Math.min(440, Math.max(160, s.viewport.w * 0.5))
  const maxH = Math.min(360, Math.max(140, s.viewport.h * 0.5))

  const els: BoardElement[] = images.map((im, i) => {
    // on-screen fit: never upscale beyond natural size, big photos shrink to fit
    const fit = Math.min(maxW / im.w, maxH / im.h, 1)
    const w = (im.w * fit) / zoom
    const h = (im.h * fit) / zoom
    const stagger = (i * 24) / zoom
    return {
      id: uid(),
      type: 'image',
      x: s.camera.x - w / 2 + stagger,
      y: s.camera.y - h / 2 + stagger,
      w,
      h,
      img: im.dataUrl,
    }
  })

  s.addElements(els)
  s.setTool('select')
  s.selectMany(els.map((e) => e.id))
  return els
}
