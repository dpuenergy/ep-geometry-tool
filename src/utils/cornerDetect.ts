// Shi-Tomasi corner detection – pure TypeScript, no external dependencies
//
// Pipeline: grayscale → Sobel gradients → structure tensor → min-eigenvalue
//           → non-maximum suppression → top-N corners
//
// All processing is at a downscaled resolution (≤ MAX_DIM on the longer side)
// so it runs in well under 100 ms even for large PDF renders.

import { Point } from '../types'

const MAX_DIM    = 500   // process at most 500 px on the longer side
const WINDOW_R   = 2     // structure-tensor summation window half-size (5×5)
const NMS_R      = 6     // non-max-suppression window half-size (13×13)
const QUALITY    = 0.04  // min response as fraction of global max

// ── Image processing helpers ──────────────────────────────────────────────────

function toGrayscale(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return g
}

function sobelGradients(
  gray: Float32Array, w: number, h: number
): { Ix: Float32Array; Iy: Float32Array } {
  const Ix = new Float32Array(w * h)
  const Iy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y-1)*w + (x-1)], tm = gray[(y-1)*w + x], tr = gray[(y-1)*w + (x+1)]
      const ml = gray[   y *w + (x-1)],                           mr = gray[   y *w + (x+1)]
      const bl = gray[(y+1)*w + (x-1)], bm = gray[(y+1)*w + x], br = gray[(y+1)*w + (x+1)]
      Ix[y*w+x] = -tl + tr - 2*ml + 2*mr - bl + br
      Iy[y*w+x] = -tl - 2*tm - tr        + bl + 2*bm + br
    }
  }
  return { Ix, Iy }
}

function shiTomasiResponse(
  Ix: Float32Array, Iy: Float32Array, w: number, h: number
): Float32Array {
  const R = new Float32Array(w * h)
  const r = WINDOW_R
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      let Ixx = 0, Iyy = 0, Ixy = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const idx = (y+dy)*w + (x+dx)
          Ixx += Ix[idx] * Ix[idx]
          Iyy += Iy[idx] * Iy[idx]
          Ixy += Ix[idx] * Iy[idx]
        }
      }
      const trace = Ixx + Iyy
      const det   = Ixx * Iyy - Ixy * Ixy
      const disc  = Math.max(0, trace * trace - 4 * det)
      R[y*w+x] = (trace - Math.sqrt(disc)) / 2   // min eigenvalue = Shi-Tomasi score
    }
  }
  return R
}

function nonMaxSuppress(
  R: Float32Array, w: number, h: number
): { x: number; y: number; score: number }[] {
  const nr = NMS_R
  const peaks: { x: number; y: number; score: number }[] = []
  for (let y = nr; y < h - nr; y++) {
    for (let x = nr; x < w - nr; x++) {
      const val = R[y*w+x]
      if (val <= 0) continue
      let isMax = true
      outer: for (let dy = -nr; dy <= nr; dy++) {
        for (let dx = -nr; dx <= nr; dx++) {
          if (dy === 0 && dx === 0) continue
          if (R[(y+dy)*w + (x+dx)] > val) { isMax = false; break outer }
        }
      }
      if (isMax) peaks.push({ x, y, score: val })
    }
  }
  return peaks.sort((a, b) => b.score - a.score)
}

// ── Coordinate transform: image pixel → Konva world ──────────────────────────
//
// BackgroundImage renders with: x=cw/2, y=ch/2, offsetX=dispW/2, offsetY=dispH/2,
// rotation=rot.  Reversing: scale pixel → shift to image centre → rotate → canvas centre.

function imagePixelToWorld(
  px: number, py: number,
  imgW: number, imgH: number,
  canvasW: number, canvasH: number,
  rotation: number,
): Point {
  const norm    = ((rotation % 360) + 360) % 360
  const swapped = norm === 90 || norm === 270
  const fitW    = swapped ? imgH : imgW
  const fitH    = swapped ? imgW : imgH
  const s       = Math.min(canvasW / fitW, canvasH / fitH)
  const dispW   = imgW * s
  const dispH   = imgH * s

  let wx = px * s - dispW / 2
  let wy = py * s - dispH / 2

  if (rotation !== 0) {
    const angle = rotation * Math.PI / 180
    const cos   = Math.cos(angle)
    const sin   = Math.sin(angle)
    ;[wx, wy] = [wx * cos - wy * sin, wx * sin + wy * cos]
  }

  return { x: wx + canvasW / 2, y: wy + canvasH / 2 }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect Shi-Tomasi corners in an image and return them as Konva world-space points.
 * @param dataUrl  background image data-URL (PNG / JPEG)
 * @param canvasW  Konva Stage width  (px)
 * @param canvasH  Konva Stage height (px)
 * @param rotation background rotation (degrees, same as Drawing.backgroundRotation)
 * @param maxCorners  cap on returned corners (default 400)
 */
export function detectCorners(
  dataUrl: string,
  canvasW: number,
  canvasH: number,
  rotation: number,
  maxCorners = 400,
): Promise<Point[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const origW = img.naturalWidth  || img.width
      const origH = img.naturalHeight || img.height
      if (!origW || !origH) { resolve([]); return }

      const procScale = Math.min(1, MAX_DIM / Math.max(origW, origH))
      const pw = Math.round(origW * procScale)
      const ph = Math.round(origH * procScale)

      const cvs = document.createElement('canvas')
      cvs.width  = pw
      cvs.height = ph
      const ctx  = cvs.getContext('2d')!
      ctx.drawImage(img, 0, 0, pw, ph)
      const { data } = ctx.getImageData(0, 0, pw, ph)

      const gray         = toGrayscale(data, pw, ph)
      const { Ix, Iy }   = sobelGradients(gray, pw, ph)
      const R            = shiTomasiResponse(Ix, Iy, pw, ph)
      const peaks        = nonMaxSuppress(R, pw, ph)

      if (peaks.length === 0) { resolve([]); return }

      const maxScore = peaks[0].score
      const threshold = maxScore * QUALITY

      const worldPoints = peaks
        .filter(p => p.score >= threshold)
        .slice(0, maxCorners)
        .map(p => imagePixelToWorld(
          p.x / procScale, p.y / procScale,
          origW, origH, canvasW, canvasH, rotation
        ))

      resolve(worldPoints)
    }
    img.onerror = () => resolve([])
    img.src = dataUrl
  })
}
