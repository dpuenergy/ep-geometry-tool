// Renders one page of a PDF file to a PNG data URL using PDF.js
// Worker is served from /public/pdf.worker.min.mjs (copied from pdfjs-dist at setup time)

import * as pdfjsLib from 'pdfjs-dist'
import type { RenderParameters } from 'pdfjs-dist/types/src/display/api'

// Absolute path served by Vite from the /public directory.
// Must match the filename copied to public/ during setup.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

/**
 * Convert a single PDF page to a PNG data URL.
 * @param file   PDF File from <input type="file">
 * @param page   1-based page number (default: 1)
 * @param scale  Render scale – 2 gives crisp 2× resolution (default: 2)
 */
export async function pdfPageToDataUrl(
  file: File,
  page = 1,
  scale = 2
): Promise<{ dataUrl: string; pageCount: number }> {
  const arrayBuffer = await file.arrayBuffer()

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise

  const pageCount = pdf.numPages
  const pdfPage = await pdf.getPage(Math.min(page, pageCount))
  const viewport = pdfPage.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')!

  const params: RenderParameters = {
    canvasContext: ctx,
    viewport,
    canvas,
  }
  await pdfPage.render(params).promise

  // Release memory
  pdf.destroy()

  return { dataUrl: canvas.toDataURL('image/png'), pageCount }
}
