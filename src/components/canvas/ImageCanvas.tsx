// ImageCanvas – background image, scale calibration, polygon zone/surface drawing
//
// Zoom: scroll wheel (centred on cursor) | +/- buttons | 1:1 reset
// Pan:  left-drag in idle mode (hand cursor)
//
// Coordinate system: all stored points are in "world" space (image pixels at
// zoom=1).  The Stage transform (scale + position) maps world → screen.
// We use stageRef to read/write transform imperatively, avoiding React state
// sync issues during continuous gestures.

import { useRef, useState, useCallback, useEffect } from 'react'
import Konva from 'konva'
import {
  Stage, Layer, Image as KonvaImage,
  Line, Circle, Text, Arrow,
} from 'react-konva'
import useImage from 'use-image'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from '../../store/projectStore'
import { Point, DrawingViewType, DRAWING_VIEW_LABELS } from '../../types'
import { pdfPageToDataUrl } from '../../utils/pdfToImage'
import { detectCorners } from '../../utils/cornerDetect'
import PolygonLayer from './PolygonLayer'
import EdgeHighlight from './EdgeHighlight'

// ── Constants ─────────────────────────────────────────────────────────────────

const CANVAS_H     = 620
const SNAP_PX      = 14         // snap radius in screen pixels
const DBL_CLICK_MS = 280
const ZOOM_FACTOR  = 1.18
const ZOOM_MIN     = 0.05
const ZOOM_MAX     = 30

type DrawMode = 'idle' | 'setScaleA' | 'setScaleB' | 'drawing'

// ── Sub-components ────────────────────────────────────────────────────────────

function BackgroundImage({
  src, cw, ch, rotation,
}: { src: string; cw: number; ch: number; rotation: number }) {
  const [image] = useImage(src)
  if (!image) return null

  const rot = rotation ?? 0

  // For 90° / 270° the image appears transposed – swap dimensions for the fit
  const normalized = ((rot % 360) + 360) % 360
  const swapped    = normalized === 90 || normalized === 270
  const fitW       = swapped ? image.height : image.width
  const fitH       = swapped ? image.width  : image.height
  const s          = Math.min(cw / fitW, ch / fitH)
  const w          = image.width  * s
  const h          = image.height * s

  // x/y places the anchor at canvas centre.
  // offsetX/Y shifts the anchor to the image centre → rotation around image centre.
  return (
    <KonvaImage
      image={image}
      x={cw / 2}
      y={ch / 2}
      width={w}
      height={h}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={rot}
    />
  )
}

function ScaleLine({ a, b, label }: { a: Point; b: Point; label?: string }) {
  return (
    <>
      <Arrow
        points={[a.x, a.y, b.x, b.y]}
        stroke="orange" strokeWidth={2} fill="orange"
        pointerLength={8} pointerWidth={6} pointerAtBeginning
      />
      <Circle x={a.x} y={a.y} radius={5} fill="orange" />
      <Circle x={b.x} y={b.y} radius={5} fill="orange" />
      {label && (
        <Text
          x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 14}
          text={label} fill="orange" fontSize={12} fontStyle="bold"
        />
      )}
    </>
  )
}

// ── DrawingTab – click to select, double-click to rename inline ───────────────

const VIEW_ICON: Record<string, string> = { plan: '⬛', elevation: '🔲', section: '✂️' }

function DrawingTab({
  drawing, isActive, onSelect, onRename,
}: {
  drawing: { id: string; name: string; viewType: string }
  isActive: boolean
  onSelect: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(drawing.name)
  const inputRef              = useRef<HTMLInputElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(drawing.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commit() {
    const trimmed = draft.trim()
    if (trimmed) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div
      onDoubleClick={startEdit}
      onClick={onSelect}
      title="Dvojklik = přejmenovat"
      className={`relative flex items-center gap-1 px-3 py-1.5 text-xs rounded-t border border-b-0 transition-colors cursor-pointer select-none ${
        isActive
          ? 'bg-white border-gray-300 font-semibold text-gray-800'
          : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-50'
      }`}
    >
      <span>{VIEW_ICON[drawing.viewType] ?? '📄'}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="w-24 text-xs border-0 outline-none bg-transparent font-semibold"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span>{drawing.name}</span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImageCanvas() {
  const {
    project,
    setBackgroundImage, setBackgroundRotation,
    setScale, addZone, addSurface,
    setActiveDrawing, addDrawing, removeDrawing, renameDrawing,
    selectEdge, selectZone, selectSurface,
  } = useProjectStore()

  // Derive active drawing
  const activeDrawing = project.drawings.find(d => d.id === project.activeDrawingId)
  const activeViewType = activeDrawing?.viewType ?? 'plan'
  const isElevOrSection = activeViewType !== 'plan'

  // ── Draw / scale mode ──
  const [mode, setMode]                     = useState<DrawMode>('idle')
  const [scalePointA, setScalePointA]       = useState<Point | null>(null)
  const [scaleDistInput, setScaleDistInput] = useState('')
  const [drawPoints, setDrawPoints]         = useState<Point[]>([])
  const [cursorPos, setCursorPos]           = useState<Point | null>(null)
  const [snapActive, setSnapActive]         = useState(false)
  const drawPointsRef                       = useRef<Point[]>([])
  useEffect(() => { drawPointsRef.current = drawPoints }, [drawPoints])

  // Pending polygon points waiting for zone type assignment (plan view)
  const [pendingPlanPoints, setPendingPlanPoints] = useState<Point[] | null>(null)

  // ── Corner detection state ──
  const [detectedCorners, setDetectedCorners] = useState<Point[]>([])
  const [cornerSnap, setCornerSnap]           = useState<Point | null>(null)

  // ── Vertex snap: snap to existing polygon vertices on the active drawing ──
  const [vertexSnap, setVertexSnap] = useState<Point | null>(null)
  const [cornersLoading, setCornersLoading]   = useState(false)

  // ── PDF ──
  const [pdfLoading, setPdfLoading]     = useState(false)
  const [pdfError, setPdfError]         = useState<string | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [pdfPage, setPdfPage]           = useState(1)
  const pdfFileRef                      = useRef<File | null>(null)

  // ── Stage ref (imperative zoom/pan) ──
  const stageRef   = useRef<Konva.Stage>(null)
  const scaleRef   = useRef(1)                       // current zoom (ref = no stale closures)
  const [zoomPct, setZoomPct] = useState(100)        // display only

  // renderScale: triggers re-render so overlay strokeWidths update after zoom
  const [renderScale, setRenderScale] = useState(1)

  // ── Drag-vs-click guard ──
  const stageDragged = useRef(false)

  // ── Double-click guard ──
  const lastClickTs = useRef(0)

  // ── Container width ──
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(900)
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setCanvasW(containerRef.current.offsetWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const fileRef = useRef<HTMLInputElement>(null)

  // Re-run corner detection whenever the active drawing's background or rotation changes.
  // Must be after canvasW declaration.
  useEffect(() => {
    const img = activeDrawing?.backgroundImage
    if (!img) { setDetectedCorners([]); return }
    let cancelled = false
    setCornersLoading(true)
    detectCorners(img, canvasW, CANVAS_H, activeDrawing.backgroundRotation ?? 0)
      .then(pts => { if (!cancelled) { setDetectedCorners(pts); setCornersLoading(false) } })
      .catch(() => { if (!cancelled) setCornersLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawing?.backgroundImage, activeDrawing?.backgroundRotation, canvasW])

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  /** Screen coords → world coords using current stage transform. */
  function screenToWorld(screen: Point): Point {
    const stage = stageRef.current
    const pos   = stage?.position() ?? { x: 0, y: 0 }
    const s     = scaleRef.current
    return { x: (screen.x - pos.x) / s, y: (screen.y - pos.y) / s }
  }

  function getPos(e: KonvaEventObject<MouseEvent>): Point | null {
    const sp = e.target.getStage()?.getPointerPosition()
    return sp ? screenToWorld(sp) : null
  }

  /** Snap radius in world pixels (fixed screen size at any zoom). */
  function snapR() { return SNAP_PX / scaleRef.current }

  function distToFirst(pos: Point): number {
    const pts = drawPointsRef.current
    if (!pts.length) return Infinity
    return Math.sqrt((pos.x - pts[0].x) ** 2 + (pos.y - pts[0].y) ** 2)
  }

  function closePolygon() {
    const pts = drawPointsRef.current
    if (pts.length < 3) return
    setDrawPoints([])
    setMode('idle')
    setSnapActive(false)
    setCursorPos(null)
    if (isElevOrSection) {
      addSurface(pts)
    } else {
      // Show zone type picker before creating zone
      setPendingPlanPoints(pts)
    }
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  function applyZoom(newScale: number, pivotScreen: Point) {
    const stage = stageRef.current
    if (!stage) return
    const s   = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale))
    const pos = stage.position()
    const wx  = (pivotScreen.x - pos.x) / scaleRef.current
    const wy  = (pivotScreen.y - pos.y) / scaleRef.current
    scaleRef.current = s
    stage.scale({ x: s, y: s })
    stage.position({ x: pivotScreen.x - wx * s, y: pivotScreen.y - wy * s })
    stage.batchDraw()
    setZoomPct(Math.round(s * 100))
    setRenderScale(s)
  }

  function zoomBy(factor: number) {
    const cx = canvasW / 2
    const cy = CANVAS_H / 2
    applyZoom(scaleRef.current * factor, { x: cx, y: cy })
  }

  function resetView() {
    const stage = stageRef.current
    if (!stage) return
    scaleRef.current = 1
    stage.scale({ x: 1, y: 1 })
    stage.position({ x: 0, y: 0 })
    stage.batchDraw()
    setZoomPct(100)
    setRenderScale(1)
  }

  // ── Image / PDF upload ─────────────────────────────────────────────────────

  async function loadPdfPage(file: File, page: number) {
    setPdfLoading(true)
    setPdfError(null)
    let dataUrl = ''
    try {
      const result = await pdfPageToDataUrl(file, page)
      dataUrl = result.dataUrl
      setPdfPageCount(result.pageCount)
      setPdfPage(page)
    } catch (err) {
      console.error('PDF render error:', err)
    }
    if (dataUrl) {
      setBackgroundImage(dataUrl)
    } else {
      setPdfError('PDF se nepodařilo vykreslit.')
    }
    setPdfLoading(false)
  }

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''
      setPdfError(null)
      if (file.type === 'application/pdf') {
        pdfFileRef.current = file
        setPdfPageCount(0)
        await loadPdfPage(file, 1)
      } else {
        pdfFileRef.current = null
        setPdfPageCount(0)
        const reader = new FileReader()
        reader.onload = () => setBackgroundImage(reader.result as string)
        reader.readAsDataURL(file)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setBackgroundImage]
  )

  // ── Wheel zoom ─────────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const pointer = e.target.getStage()?.getPointerPosition()
    if (!pointer) return
    const direction = e.evt.deltaY < 0 ? 1 : -1
    applyZoom(scaleRef.current * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR), pointer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse move (rubber-band + snap) ───────────────────────────────────────

  /** Find the closest detected corner within snap radius, or null. */
  function findCornerSnap(pos: Point): Point | null {
    if (detectedCorners.length === 0) return null
    const r = snapR()
    let best: Point | null = null
    let bestDist = r
    for (const c of detectedCorners) {
      const d = Math.sqrt((pos.x - c.x) ** 2 + (pos.y - c.y) ** 2)
      if (d < bestDist) { bestDist = d; best = c }
    }
    return best
  }

  /**
   * Find the closest existing polygon vertex on the active drawing within snap
   * radius.  Vertex snap takes priority over image corner snap so that shared
   * edges between zones are guaranteed to be geometrically identical.
   */
  function findVertexSnap(pos: Point): Point | null {
    const r = snapR()
    let best: Point | null = null
    let bestDist = r
    const drawingId = project.activeDrawingId

    // Collect vertices from zones (plan) and surfaces (elevation/section)
    const candidates: Point[] = [
      ...project.zones
        .filter(z => z.drawingId === drawingId)
        .flatMap(z => z.points),
      ...project.surfaces
        .filter(s => s.drawingId === drawingId)
        .flatMap(s => s.points),
    ]

    for (const v of candidates) {
      const d = Math.sqrt((pos.x - v.x) ** 2 + (pos.y - v.y) ** 2)
      if (d < bestDist) { bestDist = d; best = v }
    }
    return best
  }

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const sp = e.target.getStage()?.getPointerPosition()
    if (!sp) return
    const pos = screenToWorld(sp)
    setCursorPos(pos)
    if (mode === 'drawing') {
      setVertexSnap(findVertexSnap(pos))
      setCornerSnap(findCornerSnap(pos))
      if (drawPointsRef.current.length >= 3) {
        setSnapActive(distToFirst(pos) <= snapR())
      } else {
        setSnapActive(false)
      }
    } else {
      setVertexSnap(null)
      setCornerSnap(null)
      setSnapActive(false)
    }
  }, [mode, detectedCorners, project.zones, project.surfaces, project.activeDrawingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null)
    setSnapActive(false)
    setVertexSnap(null)
    setCornerSnap(null)
  }, [])

  // ── Click ──────────────────────────────────────────────────────────────────

  const handleClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return

    // If the stage was dragged (pan), ignore this click
    if (stageDragged.current) { stageDragged.current = false; return }

    // Double-click guard: skip second click of a dblclick
    const now = Date.now()
    if (now - lastClickTs.current < DBL_CLICK_MS) return
    lastClickTs.current = now

    const pos = getPos(e)
    if (!pos) return

    if (mode === 'setScaleA') {
      setScalePointA(pos); setMode('setScaleB'); return
    }
    if (mode === 'setScaleB' && scalePointA) {
      const dist = parseFloat(scaleDistInput)
      if (!isNaN(dist) && dist > 0) {
        setScale(scalePointA, pos, dist)
        setScalePointA(null)
        setMode('idle')
      }
      return
    }
    if (mode === 'drawing') {
      if (drawPointsRef.current.length >= 3 && distToFirst(pos) <= snapR()) {
        closePolygon(); return
      }
      // Priority: vertex snap (exact match with existing polygon) > corner snap > raw pos
      const snapped = findVertexSnap(pos) ?? findCornerSnap(pos)
      setDrawPoints(pts => [...pts, snapped ?? pos])
      return
    }
    if (mode === 'idle') {
      selectEdge(null)
      selectZone(null)
      selectSurface(null)
    }
  }, [mode, scalePointA, scaleDistInput, setScale, selectEdge, selectZone, selectSurface]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDblClick = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    if (mode === 'drawing') closePolygon()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rotation helpers ───────────────────────────────────────────────────────

  function rotate(delta: number) {
    const current = activeDrawing?.backgroundRotation ?? 0
    const next = ((current + delta) % 360 + 360) % 360
    setBackgroundRotation(next)
  }

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  function toggleDraw() {
    if (mode === 'drawing') { setMode('idle'); setDrawPoints([]); setSnapActive(false) }
    else { setMode('drawing'); setDrawPoints([]) }
  }

  const scaleSet       = !!activeDrawing?.scale
  const scaleDistValid = scaleDistInput !== '' && parseFloat(scaleDistInput) > 0

  // Priority: snap-to-first > vertex snap > corner snap > raw cursor
  const activeSnapPoint: Point | null =
    (snapActive && drawPoints.length >= 3) ? drawPoints[0]
    : vertexSnap ?? cornerSnap ?? null

  const previewTarget: Point | null = activeSnapPoint ?? cursorPos

  // Rubber-band colour: green = vertex/first snap, amber = image corner snap, blue = free
  const rubberBandColor =
    snapActive || vertexSnap ? '#22c55e' : cornerSnap ? '#f59e0b' : '#3b82f6'

  // Cursor: hand when idle (pan available), crosshair when drawing/calibrating
  const cursorClass = mode === 'idle' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'

  // Overlay element sizes scale inversely so they stay constant on screen
  const inv = 1 / renderScale

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">

      {/* ── Zone type picker (appears after closing a polygon on plan view) ── */}
      {pendingPlanPoints && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-800">Přiřadit zónu:</span>
          {project.zoneTypes.map(zt => (
            <button
              key={zt.id}
              className="text-sm px-3 py-1 rounded text-white font-medium hover:opacity-90"
              style={{ backgroundColor: zt.color }}
              onClick={() => {
                addZone(pendingPlanPoints, zt.id)
                setPendingPlanPoints(null)
              }}
            >
              {zt.name}
            </button>
          ))}
          <button
            className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
            onClick={() => setPendingPlanPoints(null)}
          >
            Zrušit
          </button>
        </div>
      )}

      {/* ── Drawing tabs ── */}
      <div className="flex items-end gap-1 px-1 flex-wrap">
        {project.drawings.map(d => (
          <DrawingTab
            key={d.id}
            drawing={d}
            isActive={d.id === project.activeDrawingId}
            onSelect={() => setActiveDrawing(d.id)}
            onRename={(name) => renameDrawing(d.id, name)}
          />
        ))}
        <div className="flex gap-1 ml-2 mb-0.5">
          {(['plan','elevation','section'] as DrawingViewType[]).map(vt => (
            <button
              key={vt}
              onClick={() => addDrawing(vt)}
              className="btn-secondary text-xs px-2 py-1"
              title={`Přidat ${DRAWING_VIEW_LABELS[vt]}`}
            >
              + {DRAWING_VIEW_LABELS[vt]}
            </button>
          ))}
          {project.drawings.length > 1 && (
            <button
              onClick={() => {
                if (confirm(`Smazat kresbu „${activeDrawing?.name}"?`))
                  removeDrawing(project.activeDrawingId)
              }}
              className="btn-secondary text-xs px-2 py-1 text-red-500"
            >
              Smazat
            </button>
          )}
        </div>
      </div>

      <div className="border border-gray-300 rounded-b-lg rounded-tr-lg overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap gap-2 items-center bg-white px-3 py-2">

          {/* Upload */}
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            Nahrát obrázek / PDF
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />

          {pdfLoading && <span className="text-xs text-gray-400 animate-pulse">Načítám PDF…</span>}
          {pdfError   && <span className="text-xs text-red-500">{pdfError}</span>}
          {cornersLoading && (
            <span className="text-xs text-amber-500 animate-pulse">Detekcí rohů…</span>
          )}
          {!cornersLoading && detectedCorners.length > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="Snapping na detekované rohy je aktivní při kreslení">
              ◆ {detectedCorners.length} rohů
            </span>
          )}

          {/* PDF page selector */}
          {pdfPageCount > 1 && !pdfLoading && (
            <div className="flex items-center gap-1">
              <button className="btn-secondary px-1.5 py-0.5 text-xs" disabled={pdfPage <= 1}
                onClick={() => { const p = pdfPage - 1; if (pdfFileRef.current) loadPdfPage(pdfFileRef.current, p) }}>‹</button>
              <span className="text-xs text-gray-600">str. {pdfPage} / {pdfPageCount}</span>
              <button className="btn-secondary px-1.5 py-0.5 text-xs" disabled={pdfPage >= pdfPageCount}
                onClick={() => { const p = pdfPage + 1; if (pdfFileRef.current) loadPdfPage(pdfFileRef.current, p) }}>›</button>
            </div>
          )}

          {/* Image rotation */}
          {activeDrawing?.backgroundImage && (
            <>
              <div className="w-px h-5 bg-gray-200" />
              <div className="flex items-center gap-1" title="Rotace podkladu">
                <button className="btn-secondary px-2 py-1 text-sm" onClick={() => rotate(-90)} title="Otočit doleva o 90°">↺</button>
                <span className="text-xs text-gray-500 w-10 text-center tabular-nums">
                  {activeDrawing?.backgroundRotation ?? 0}°
                </span>
                <button className="btn-secondary px-2 py-1 text-sm" onClick={() => rotate(90)} title="Otočit doprava o 90°">↻</button>
              </div>
            </>
          )}

          <div className="w-px h-5 bg-gray-200" />

          {/* Scale calibration */}
          <div className="flex items-center gap-1.5">
            <input type="number" min="0.01" step="0.1" placeholder="délka (m)"
              value={scaleDistInput} onChange={e => setScaleDistInput(e.target.value)}
              className="input w-28"
            />
            <button
              className={`btn-secondary ${mode === 'setScaleA' || mode === 'setScaleB' ? 'ring-2 ring-amber-400 bg-amber-50' : ''}`}
              onClick={() => { setMode('setScaleA'); setScalePointA(null) }}
              disabled={!scaleDistValid}
            >
              📏 Měřítko
            </button>
            {scaleSet && (
              <span className="text-xs text-green-700 font-medium bg-green-50 px-2 py-0.5 rounded">
                ✓ {activeDrawing?.scale!.pixelsPerMeter.toFixed(1)} px/m
              </span>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200" />

          {/* Draw button */}
          <div className="flex items-center gap-1">
            <button
              className={`btn-primary ${mode === 'drawing' ? 'ring-2 ring-blue-700 bg-blue-700' : ''}`}
              onClick={toggleDraw}
              disabled={!scaleSet}
              title={!scaleSet ? 'Nejprve nastavte měřítko' : ''}
            >
              {mode === 'drawing' ? '■ Zrušit' : isElevOrSection ? '+ Kreslit plochu' : '+ Kreslit zónu'}
            </button>
            {mode === 'drawing' && drawPoints.length >= 3 && (
              <button className="btn-secondary" onClick={closePolygon}>Zavřít ↵</button>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200" />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button className="btn-secondary px-2 py-1 font-mono text-base leading-none" onClick={() => zoomBy(1 / ZOOM_FACTOR)}>−</button>
            <span className="text-xs text-gray-600 w-12 text-center tabular-nums">{zoomPct} %</span>
            <button className="btn-secondary px-2 py-1 font-mono text-base leading-none" onClick={() => zoomBy(ZOOM_FACTOR)}>+</button>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={resetView}>1:1</button>
          </div>

        </div>

        {/* ── Status bar ── */}
        <div className="min-h-[24px] flex items-center gap-3 px-3 bg-white border-t border-gray-100">
          {mode === 'setScaleA' && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-0.5">
              Klikněte na <strong>první bod</strong> referenční vzdálenosti
            </p>
          )}
          {mode === 'setScaleB' && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-0.5">
              Klikněte na <strong>druhý bod</strong> — vzdálenost: {scaleDistInput} m
            </p>
          )}
          {mode === 'drawing' && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded px-2 py-0.5">
              {drawPoints.length === 0
                ? `Klikněte na první bod ${isElevOrSection ? 'plochy' : 'zóny'}`
                : drawPoints.length < 3
                ? `${drawPoints.length} bod${drawPoints.length > 1 ? 'y' : ''} – pokračujte`
                : snapActive
                ? '🟢 Klikněte pro zavření polygonu'
                : `${drawPoints.length} bodů – dvojklik nebo klik na ● pro zavření`}
              <span className="text-blue-500 ml-2 text-xs">· tažení = posun · kolečko = zoom</span>
            </p>
          )}
          {mode === 'idle' && (
            <p className="text-xs text-gray-400">
              Tažení = posun &nbsp;·&nbsp; kolečko = zoom
            </p>
          )}
        </div>

        {/* ── Canvas ── */}
        <div ref={containerRef} className={`bg-gray-100 select-none ${cursorClass}`}>
          <Stage
            ref={stageRef}
            width={canvasW}
            height={CANVAS_H}
            draggable
            onDragStart={() => { stageDragged.current = false }}
            onDragMove={() => { stageDragged.current = true }}
            onWheel={handleWheel}
            onClick={handleClick}
            onDblClick={handleDblClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Background */}
            <Layer>
              {activeDrawing?.backgroundImage
                ? <BackgroundImage src={activeDrawing.backgroundImage} cw={canvasW} ch={CANVAS_H} rotation={activeDrawing?.backgroundRotation ?? 0} />
                : <Text
                    x={canvasW / 2 - 140} y={CANVAS_H / 2 - 10}
                    text="Nahrajte obrázek nebo PDF půdorysu"
                    fill="#9ca3af" fontSize={16}
                  />
              }
            </Layer>

            {/* Zones + edges */}
            <Layer>
              <PolygonLayer />
              <EdgeHighlight />
            </Layer>

            {/* Detected corners overlay – visible only in drawing mode */}
            {mode === 'drawing' && detectedCorners.length > 0 && (
              <Layer listening={false}>
                {detectedCorners.map((c, i) => (
                  <Circle
                    key={i}
                    x={c.x} y={c.y}
                    radius={3 * inv}
                    fill={
                      cornerSnap && cornerSnap.x === c.x && cornerSnap.y === c.y
                        ? '#f59e0b'   // amber – active snap target
                        : 'rgba(245,158,11,0.25)'  // faint amber dots
                    }
                    stroke={
                      cornerSnap && cornerSnap.x === c.x && cornerSnap.y === c.y
                        ? '#f59e0b' : 'transparent'
                    }
                    strokeWidth={1.5 * inv}
                  />
                ))}
                {/* Snap ring around active corner */}
                {cornerSnap && !snapActive && (
                  <Circle
                    x={cornerSnap.x} y={cornerSnap.y}
                    radius={snapR()}
                    stroke="#f59e0b"
                    strokeWidth={1.5 * inv}
                    fill="transparent"
                    dash={[4 * inv, 3 * inv]}
                  />
                )}
              </Layer>
            )}

            {/* Vertex snap overlay – existing polygon vertices, visible in drawing mode */}
            {mode === 'drawing' && (
              <Layer listening={false}>
                {[
                  ...project.zones.filter(z => z.drawingId === project.activeDrawingId).flatMap(z => z.points),
                  ...project.surfaces.filter(s => s.drawingId === project.activeDrawingId).flatMap(s => s.points),
                ].map((v, i) => (
                  <Circle
                    key={i}
                    x={v.x} y={v.y}
                    radius={3 * inv}
                    fill={
                      vertexSnap && vertexSnap.x === v.x && vertexSnap.y === v.y
                        ? '#22c55e'
                        : 'rgba(34,197,94,0.2)'
                    }
                    stroke={
                      vertexSnap && vertexSnap.x === v.x && vertexSnap.y === v.y
                        ? '#22c55e' : 'transparent'
                    }
                    strokeWidth={1.5 * inv}
                  />
                ))}
                {/* Snap ring around active vertex */}
                {vertexSnap && !snapActive && (
                  <Circle
                    x={vertexSnap.x} y={vertexSnap.y}
                    radius={snapR()}
                    stroke="#22c55e"
                    strokeWidth={2 * inv}
                    fill="transparent"
                  />
                )}
              </Layer>
            )}

            {/* Drawing overlay (non-interactive) */}
            <Layer listening={false}>

              {/* Polygon fill preview */}
              {drawPoints.length >= 3 && (
                <Line points={drawPoints.flatMap(p => [p.x, p.y])} closed fill="rgba(59,130,246,0.08)" stroke="transparent" />
              )}

              {/* Drawn segments */}
              {drawPoints.length >= 2 && (
                <Line points={drawPoints.flatMap(p => [p.x, p.y])} stroke="#3b82f6" strokeWidth={2 * inv} />
              )}

              {/* Rubber-band */}
              {drawPoints.length >= 1 && previewTarget && (
                <Line
                  points={[drawPoints[drawPoints.length - 1].x, drawPoints[drawPoints.length - 1].y, previewTarget.x, previewTarget.y]}
                  stroke={rubberBandColor}
                  strokeWidth={2 * inv}
                  dash={[5 * inv, 4 * inv]}
                />
              )}

              {/* Vertex dots */}
              {drawPoints.map((p, i) => (
                <Circle key={i} x={p.x} y={p.y}
                  radius={(i === 0 && drawPoints.length >= 3 ? 7 : 4) * inv}
                  fill={i === 0 && drawPoints.length >= 3 ? (snapActive ? '#22c55e' : '#1d4ed8') : '#3b82f6'}
                  stroke="white" strokeWidth={1.5 * inv}
                />
              ))}

              {/* Snap ring */}
              {drawPoints.length >= 3 && snapActive && (
                <Circle x={drawPoints[0].x} y={drawPoints[0].y}
                  radius={snapR()}
                  stroke="#22c55e" strokeWidth={1.5 * inv}
                  dash={[4 * inv, 3 * inv]}
                  fill="transparent"
                />
              )}

              {/* Cursor readout */}
              {cursorPos && mode === 'drawing' && activeDrawing?.scale && (
                <Text
                  x={cursorPos.x + 10 * inv} y={cursorPos.y - 18 * inv}
                  text={`${(cursorPos.x / activeDrawing.scale.pixelsPerMeter).toFixed(2)} m, ${(cursorPos.y / activeDrawing.scale.pixelsPerMeter).toFixed(2)} m`}
                  fill="#374151" fontSize={11 * inv}
                />
              )}

              {/* Confirmed scale line */}
              {mode === 'idle' && activeDrawing?.scale && (
                <ScaleLine a={activeDrawing.scale.pointA} b={activeDrawing.scale.pointB} label={`${activeDrawing.scale.realDistanceMeters} m`} />
              )}

              {/* Live scale preview */}
              {mode === 'setScaleB' && scalePointA && cursorPos && (
                <ScaleLine a={scalePointA} b={cursorPos} label={`${scaleDistInput} m`} />
              )}
              {mode === 'setScaleB' && scalePointA && !cursorPos && (
                <Circle x={scalePointA.x} y={scalePointA.y} radius={5 * inv} fill="orange" />
              )}

            </Layer>
          </Stage>
        </div>

      </div>
    </div>
  )
}
