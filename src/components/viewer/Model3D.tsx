// Model3D – 3D building preview + construction assignment + zone drawing
//
// Two draw modes driven by pre-selected construction type:
//   Horizontal (floor / ceiling / roof)  → polygon drawn on XZ plane
//   Vertical   (wall types)              → click-to-paint on existing wall faces
//
// Snap: screen-space projection of all 3D vertices — snaps within 20 px.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useProjectStore } from '../../store/projectStore'
import { useLibraryStore } from '../../store/libraryStore'
import { Project, Point, ConstructionType, Construction } from '../../types'
import EdgeWizard from '../panels/EdgeWizard'
import ZoneSurfaceWizard from '../panels/ZoneSurfaceWizard'

// ── Construction orientation ───────────────────────────────────────────────────

const HORIZONTAL_TYPES = new Set<ConstructionType>([
  'floor_on_ground', 'floor_over_ext', 'interior_ceiling', 'roof_flat', 'roof_pitched',
])
const VERTICAL_TYPES = new Set<ConstructionType>([
  'exterior_wall', 'interior_wall', 'unheated',
])

// Ceiling-type horizontal constructions go on the TOP face of a floor
const CEILING_SIDE = new Set<ConstructionType>([
  'roof_flat', 'roof_pitched', 'interior_ceiling',
])

// ── Colour tables ──────────────────────────────────────────────────────────────

const SNAP_DIST_PX = 20 // screen-space snap radius in pixels

const CONSTR_COLOR: Record<string, number> = {
  exterior_wall:    0xf97316,
  roof_flat:        0x8b5cf6,
  roof_pitched:     0xa78bfa,
  floor_on_ground:  0xa8a29e,
  floor_over_ext:   0x78716c,
  interior_wall:    0x94a3b8,
  interior_ceiling: 0xcbd5e1,
  unheated:         0xd1d5db,
}

const CONSTR_LABEL: Record<string, string> = {
  exterior_wall:    'Obvodová stěna',
  roof_flat:        'Střecha plochá',
  roof_pitched:     'Střecha šikmá',
  floor_on_ground:  'Podlaha na terénu',
  floor_over_ext:   'Podlaha nad ext.',
  interior_wall:    'Vnitřní stěna',
  interior_ceiling: 'Vnitřní strop',
  unheated:         'Nekondicionovaná',
}

// ── Scene result ───────────────────────────────────────────────────────────────

interface SceneResult {
  scene: THREE.Scene
  target: THREE.Vector3
  size: number
  clickableMeshes: THREE.Mesh[]
  wallMeshes: Map<string, THREE.Mesh>
  floorMeshes: Map<string, THREE.Mesh>
  ceilMeshes: Map<string, THREE.Mesh>
  offsets: Map<string, { dx: number; dz: number }>
  ppmMap: Map<string, number>
  zBaseMap: Map<string, number>
}

// ── Build scene ────────────────────────────────────────────────────────────────

function buildScene(project: Project): SceneResult {
  const { zones, edges, drawings, zoneTypes } = project
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1e293b)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(10, 20, 10); scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-5, 8, -10); scene.add(fill)

  const planDrawings = drawings.filter(d => d.viewType === 'plan')
  const planZones    = zones.filter(z => planDrawings.some(d => d.id === z.drawingId))
  const zoneTypeMap  = new Map(zoneTypes.map(zt => [zt.id, zt]))
  const drawingMap   = new Map(drawings.map(d => [d.id, d]))

  const zBaseMap = new Map<string, number>()
  let totalH = 0
  for (const d of planDrawings) { zBaseMap.set(d.id, totalH); totalH += d.floorHeightMeters }

  const ppmMap = new Map<string, number>()
  for (const d of planDrawings) if (d.scale) ppmMap.set(d.id, d.scale.pixelsPerMeter)

  // Centroid alignment
  const offsets = new Map<string, { dx: number; dz: number }>()
  let refX = 0, refZ = 0, refSet = false
  for (const d of planDrawings) {
    if (!d.scale) continue
    const ppm    = d.scale.pixelsPerMeter
    const dZones = planZones.filter(z => z.drawingId === d.id)
    if (!dZones.length) { offsets.set(d.id, { dx: 0, dz: 0 }); continue }
    let sx = 0, sz = 0, n = 0
    for (const z of dZones) for (const p of z.points) { sx += p.x / ppm; sz += p.y / ppm; n++ }
    const cx = sx / n, cz = sz / n
    if (!refSet) { refX = cx; refZ = cz; refSet = true }
    offsets.set(d.id, { dx: cx - refX, dz: cz - refZ })
  }

  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity
  const clickableMeshes: THREE.Mesh[] = []
  const wallMeshes = new Map<string, THREE.Mesh>()
  const floorMeshes = new Map<string, THREE.Mesh>()
  const ceilMeshes = new Map<string, THREE.Mesh>()

  for (const zone of planZones) {
    const d = drawingMap.get(zone.drawingId)
    if (!d?.scale) continue
    const ppm   = d.scale.pixelsPerMeter
    const zBase = zBaseMap.get(zone.drawingId) ?? 0
    const off   = offsets.get(zone.drawingId) ?? { dx: 0, dz: 0 }
    const h     = d.floorHeightMeters
    const color = new THREE.Color(zoneTypeMap.get(zone.zoneTypeId)?.color ?? '#6b7280')

    const wx = (p: Point) => p.x / ppm - off.dx
    const wz = (p: Point) => p.y / ppm - off.dz

    for (const p of zone.points) {
      xMin = Math.min(xMin, wx(p)); xMax = Math.max(xMax, wx(p))
      zMin = Math.min(zMin, wz(p)); zMax = Math.max(zMax, wz(p))
    }

    // Zone volume fill (not clickable)
    const shape  = new THREE.Shape(zone.points.map(p => new THREE.Vector2(wx(p), -wz(p))))
    const extGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
    extGeo.rotateX(-Math.PI / 2); extGeo.translate(0, zBase, 0); extGeo.computeVertexNormals()
    scene.add(new THREE.Mesh(extGeo, new THREE.MeshLambertMaterial({
      color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    })))
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(extGeo, 15),
      new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.5) })))

    // Wall faces — all edges, clickable
    for (const eid of zone.edgeIds) {
      const edge = edges[eid]; if (!edge) continue
      const [p1, p2] = edge.points
      const wallGeo = new THREE.BufferGeometry()
      wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        wx(p1), zBase,     wz(p1), wx(p2), zBase,     wz(p2),
        wx(p2), zBase + h, wz(p2), wx(p1), zBase + h, wz(p1),
      ]), 3))
      wallGeo.setIndex([0, 1, 2, 0, 2, 3]); wallGeo.computeVertexNormals()
      const hasC = !!edge.construction
      const wallMat = new THREE.MeshLambertMaterial({
        color: hasC ? (CONSTR_COLOR[edge.construction!.type] ?? 0x94a3b8) : 0x94a3b8,
        side: THREE.DoubleSide, transparent: true, opacity: hasC ? 0.9 : 0.18,
      })
      const m = new THREE.Mesh(wallGeo, wallMat)
      m.userData = { kind: 'wall', edgeId: eid, zoneId: zone.id }
      scene.add(m); clickableMeshes.push(m); wallMeshes.set(eid, m)
    }

    // Floor face
    const mkSh = () => new THREE.Shape(zone.points.map(p => new THREE.Vector2(wx(p), -wz(p))))
    const addHFace = (y: number, constr: Construction | null, meshMap: Map<string, THREE.Mesh>, kind: string) => {
      const geo = new THREE.ShapeGeometry(mkSh())
      geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0); geo.computeVertexNormals()
      const mat = new THREE.MeshLambertMaterial({
        color: constr ? (CONSTR_COLOR[constr.type] ?? 0xa8a29e) : 0x475569,
        side: THREE.DoubleSide, transparent: true, opacity: constr ? 0.9 : 0.18,
      })
      const m = new THREE.Mesh(geo, mat)
      m.userData = { kind, zoneId: zone.id }
      scene.add(m); clickableMeshes.push(m); meshMap.set(zone.id, m)
    }
    addHFace(zBase,     zone.floorConstruction,   floorMeshes, 'floor')
    addHFace(zBase + h, zone.ceilingConstruction, ceilMeshes,  'ceiling')
  }

  // Ground grid + world axes indicator
  if (isFinite(xMin)) {
    const cx = (xMin+xMax)/2, cz = (zMin+zMax)/2
    const span = Math.max(xMax-xMin, zMax-zMin, 1) * 2.5
    const grid = new THREE.GridHelper(span, Math.min(200, Math.max(10, Math.round(span))), 0x9ca3af, 0xe5e7eb)
    grid.position.set(cx, -0.01, cz); scene.add(grid)
    // Small axes indicator at grid corner (X=red, Y=green, Z=blue)
    const axLen = Math.max((xMax - xMin) * 0.08, 0.6)
    const axH = new THREE.AxesHelper(axLen)
    axH.position.set(xMin, 0, zMin)
    scene.add(axH)
  }

  const target = isFinite(xMin)
    ? new THREE.Vector3((xMin+xMax)/2, totalH/2, (zMin+zMax)/2)
    : new THREE.Vector3()
  const size = isFinite(xMin) ? Math.max(xMax-xMin, totalH||3, zMax-zMin, 1) : 10

  return { scene, target, size, clickableMeshes, wallMeshes, floorMeshes, ceilMeshes, offsets, ppmMap, zBaseMap }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Model3D({ onClose }: { onClose: () => void }) {
  const {
    project, selectEdge, selectZone,
    selectedEdgeId, selectedZoneId,
    addZoneToDrawing, moveWallEdge,
  } = useProjectStore()
  const { constructions: library } = useLibraryStore()

  // UI state
  const [error, setError]             = useState<string | null>(null)
  const [drawMode, setDrawMode]       = useState(false)
  const [pushPullMode, setPushPullMode] = useState(false)
  const [ppOffsetDisplay, setPpOffsetDisplay] = useState<number | null>(null)
  const [drawTab, setDrawTab]         = useState<'horizontal' | 'vertical'>('horizontal')
  const [drawConstrType, setDrawConstrType] = useState<ConstructionType | ''>('')
  const [drawTargetId, setDrawTargetId]     = useState<string>('')
  const [drawZoneTypeId, setDrawZoneTypeId] = useState<string>('')
  const [draftCount, setDraftCount]   = useState(0)
  const [snapActive, setSnapActive]   = useState(false)

  // Gizmo ref
  const gizmoCanvasRef     = useRef<HTMLCanvasElement>(null)

  // Three.js refs
  const containerRef       = useRef<HTMLDivElement>(null)
  const sceneRef           = useRef<THREE.Scene | null>(null)
  const cameraRef          = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef        = useRef<OrbitControls | null>(null)
  const rendererRef        = useRef<THREE.WebGLRenderer | null>(null)
  const clickableMeshesRef = useRef<THREE.Mesh[]>([])
  const wallMeshesRef      = useRef<Map<string, THREE.Mesh>>(new Map())
  const floorMeshesRef     = useRef<Map<string, THREE.Mesh>>(new Map())
  const ceilMeshesRef      = useRef<Map<string, THREE.Mesh>>(new Map())
  const offsetsRef         = useRef<Map<string, { dx: number; dz: number }>>(new Map())
  const ppmMapRef          = useRef<Map<string, number>>(new Map())
  const zBaseMapRef        = useRef<Map<string, number>>(new Map())
  const draftGroupRef      = useRef<THREE.Group | null>(null)
  const resetCameraRef     = useRef<(() => void) | null>(null)
  const activeMeshRef      = useRef<THREE.Mesh | null>(null)
  const savedEmissive      = useRef(new THREE.Color())

  // Push-pull refs
  const pushPullModeRef = useRef(false)
  const ppActiveRef = useRef<{
    edgeId: string
    normal: THREE.Vector3
    plane: THREE.Plane        // camera-facing plane for ray intersection
    startHit: THREE.Vector3
    mesh: THREE.Mesh
    origPos: THREE.Vector3
    currentDisp: number       // current displacement in metres
  } | null>(null)

  // Draw-mode refs (used in event handlers — avoid stale closures)
  const drawModeRef       = useRef(false)
  const drawConstrTypeRef = useRef<ConstructionType | ''>('')
  const drawTargetIdRef   = useRef('')
  const drawZoneTypeIdRef = useRef('')
  const draftPtsRef       = useRef<{ wx: number; wz: number }[]>([])
  const snapCandidatesRef = useRef<{ wx: number; wy: number; wz: number }[]>([])
  const libraryRef        = useRef(library)

  // Sync refs → state
  useEffect(() => { pushPullModeRef.current = pushPullMode }, [pushPullMode])
  useEffect(() => { drawModeRef.current       = drawMode       }, [drawMode])
  useEffect(() => { drawConstrTypeRef.current = drawConstrType }, [drawConstrType])
  useEffect(() => { drawTargetIdRef.current   = drawTargetId   }, [drawTargetId])
  useEffect(() => { drawZoneTypeIdRef.current = drawZoneTypeId }, [drawZoneTypeId])
  useEffect(() => { libraryRef.current        = library        }, [library])

  // Defaults when draw mode opens
  useEffect(() => {
    if (!drawMode) return
    const plans = project.drawings.filter(d => d.viewType === 'plan')
    if (!drawTargetId && plans.length) setDrawTargetId(plans[0].id)
    if (!drawZoneTypeId && project.zoneTypes.length) setDrawZoneTypeId(project.zoneTypes[0].id)
    // Ensure a construction type is always selected when entering draw mode
    if (!drawConstrType) {
      const lib = useLibraryStore.getState().constructions
      const first = lib.find(c => HORIZONTAL_TYPES.has(c.type))
      if (first) setDrawConstrType(first.type)
    }
  }, [drawMode]) // eslint-disable-line

  // Rebuild snap candidates when target changes or draw mode activates
  useEffect(() => {
    if (drawMode) buildSnapCandidates()
  }, [drawMode, drawTargetId]) // eslint-disable-line

  // ── Scene rebuild (preserves camera) ────────────────────────────────────────

  function rebuildScene() {
    const camera = cameraRef.current, controls = controlsRef.current
    if (!camera || !controls) return
    const savedPos = camera.position.clone()
    const savedTgt = controls.target.clone()

    sceneRef.current?.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
        (obj as THREE.Mesh).geometry?.dispose()
        const m = (obj as THREE.Mesh).material
        if (Array.isArray(m)) m.forEach((x: THREE.Material) => x.dispose())
        else (m as THREE.Material)?.dispose()
      }
    })

    const proj   = useProjectStore.getState().project
    const result = buildScene(proj)
    sceneRef.current           = result.scene
    wallMeshesRef.current      = result.wallMeshes
    floorMeshesRef.current     = result.floorMeshes
    ceilMeshesRef.current      = result.ceilMeshes
    clickableMeshesRef.current = result.clickableMeshes
    offsetsRef.current         = result.offsets
    ppmMapRef.current          = result.ppmMap
    zBaseMapRef.current        = result.zBaseMap
    activeMeshRef.current      = null

    const dg = new THREE.Group()
    result.scene.add(dg)
    draftGroupRef.current = dg

    camera.position.copy(savedPos)
    controls.target.copy(savedTgt)
    controls.update()
  }

  // ── Snap candidates (all zone vertices in 3D) ─────────────────────────────

  function buildSnapCandidates() {
    const proj = useProjectStore.getState().project
    const pts: { wx: number; wy: number; wz: number }[] = []
    for (const zone of proj.zones) {
      const d = proj.drawings.find(dd => dd.id === zone.drawingId)
      if (!d?.scale) continue
      const ppm  = d.scale.pixelsPerMeter
      const off  = offsetsRef.current.get(zone.drawingId) ?? { dx: 0, dz: 0 }
      const yBase = zBaseMapRef.current.get(zone.drawingId) ?? 0
      const h    = d.floorHeightMeters
      for (const p of zone.points) {
        const wx = p.x / ppm - off.dx, wz = p.y / ppm - off.dz
        pts.push({ wx, wy: yBase,     wz })
        pts.push({ wx, wy: yBase + h, wz })
      }
    }
    // Also include current draft points projected to current drawing plane
    const drawingId = drawTargetIdRef.current
    const planY     = getDrawPlaneY(drawingId, drawConstrTypeRef.current)
    for (const p of draftPtsRef.current) pts.push({ wx: p.wx, wy: planY, wz: p.wz })
    snapCandidatesRef.current = pts
  }

  // ── Screen-space snap ─────────────────────────────────────────────────────

  function screenSnap(
    ex: number, ey: number, rect: DOMRect,
  ): { wx: number; wz: number } | null {
    const camera = cameraRef.current; if (!camera) return null
    const temp = new THREE.Vector3()
    let best: { wx: number; wy: number; wz: number } | null = null
    let bestD = SNAP_DIST_PX
    for (const c of snapCandidatesRef.current) {
      temp.set(c.wx, c.wy, c.wz).project(camera)
      const sx = ((temp.x + 1) / 2) * rect.width
      const sy = ((1 - temp.y)  / 2) * rect.height
      const d  = Math.hypot(ex - sx, ey - sy)
      if (d < bestD) { bestD = d; best = c }
    }
    return best ? { wx: best.wx, wz: best.wz } : null
  }

  // ── Drawing plane Y ───────────────────────────────────────────────────────

  function getDrawPlaneY(drawingId: string, constrType: ConstructionType | ''): number {
    const zBase = zBaseMapRef.current.get(drawingId) ?? 0
    const proj  = useProjectStore.getState().project
    const d     = proj.drawings.find(dd => dd.id === drawingId)
    const h     = d?.floorHeightMeters ?? 3
    return CEILING_SIDE.has(constrType as ConstructionType) ? zBase + h : zBase
  }

  // ── Raycast against horizontal drawing plane ──────────────────────────────

  function hitDrawPlane(e: PointerEvent, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): { wx: number; wz: number } | null {
    const drawingId = drawTargetIdRef.current
    const y         = getDrawPlaneY(drawingId, drawConstrTypeRef.current)
    const rect      = renderer.domElement.getBoundingClientRect()
    const mouse     = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
    const hit   = new THREE.Vector3()
    if (!ray.ray.intersectPlane(plane, hit)) return null
    return { wx: hit.x, wz: hit.z }
  }

  // ── Draft visualisation ───────────────────────────────────────────────────

  function updateDraft(
    pts: { wx: number; wz: number }[],
    preview?: { wx: number; wz: number; snapped: boolean } | null,
  ) {
    const group = draftGroupRef.current; if (!group) return
    group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose()
        ;((obj as THREE.Mesh).material as THREE.Material).dispose()
      }
    })
    group.clear()
    if (!pts.length && !preview) return

    const yBase = getDrawPlaneY(drawTargetIdRef.current, drawConstrTypeRef.current) + 0.04

    // Placed points
    for (let i = 0; i < pts.length; i++) {
      const isFirst = i === 0
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: isFirst ? 0xfbbf24 : 0xffffff }),
      )
      dot.position.set(pts[i].wx, yBase, pts[i].wz); group.add(dot)
      // Snap ring around first point when polygon can close
      if (isFirst && pts.length >= 3) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.3, 0.45, 32),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(pts[0].wx, yBase - 0.01, pts[0].wz); group.add(ring)
      }
    }

    // Preview cursor
    if (preview) {
      const cur = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshBasicMaterial({ color: preview.snapped ? 0x22c55e : 0xfbbf24 }),
      )
      cur.position.set(preview.wx, yBase, preview.wz); group.add(cur)
    }

    // Lines
    const pos: number[] = []
    for (const p of pts) pos.push(p.wx, yBase, p.wz)
    if (preview) pos.push(preview.wx, yBase, preview.wz)
    if (pos.length >= 6) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfbbf24 })))
    }
  }

  // ── World → pixel ─────────────────────────────────────────────────────────

  function worldToPixel(wx: number, wz: number, drawingId: string): Point {
    const ppm = ppmMapRef.current.get(drawingId) ?? 100
    const off = offsetsRef.current.get(drawingId) ?? { dx: 0, dz: 0 }
    return { x: Math.round((wx + off.dx) * ppm), y: Math.round((wz + off.dz) * ppm) }
  }

  // ── Wall normal for push/pull ─────────────────────────────────────────────

  function wallNormalForEdge(edgeId: string): THREE.Vector3 | null {
    const proj = useProjectStore.getState().project
    const edge = proj.edges[edgeId]; if (!edge) return null
    const zone = proj.zones.find(z => z.edgeIds.includes(edgeId)); if (!zone) return null
    const drawing = proj.drawings.find(d => d.id === zone.drawingId)
    const ppm = drawing?.scale?.pixelsPerMeter ?? 100
    const [p1, p2] = edge.points
    const dx = (p2.x - p1.x) / ppm, dz = (p2.y - p1.y) / ppm
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return null
    return new THREE.Vector3(-dz / len, 0, dx / len)
  }

  // ── Finish polygon (horizontal or vertical) ───────────────────────────────

  function finishPolygon() {
    const pts        = draftPtsRef.current
    const drawingId  = drawTargetIdRef.current
    const zoneTypeId = drawZoneTypeIdRef.current
    const constrType = drawConstrTypeRef.current
    if (pts.length < 3 || !drawingId || !zoneTypeId) return

    const pixelPts = pts.map(p => worldToPixel(p.wx, p.wz, drawingId))
    const libItem  = libraryRef.current.find(c => c.type === constrType)
    const constrObj: Construction | null = libItem
      ? { type: libItem.type, name: libItem.name, thicknessMeters: libItem.thicknessMeters }
      : null

    if (VERTICAL_TYPES.has(constrType as ConstructionType)) {
      // Vertical: assign construction to all wall edges; floor/ceiling left for later
      addZoneToDrawing(drawingId, pixelPts, zoneTypeId, null, null, constrObj)
    } else {
      // Horizontal: assign to floor or ceiling based on CEILING_SIDE
      const isFloorSide = constrType && !CEILING_SIDE.has(constrType as ConstructionType)
      addZoneToDrawing(
        drawingId, pixelPts, zoneTypeId,
        isFloorSide ? constrObj : null,
        !isFloorSide ? constrObj : null,
      )
    }

    draftPtsRef.current = []
    setDraftCount(0)
    setSnapActive(false)
    rebuildScene()
    buildSnapCandidates()
  }

  // ── Main Three.js effect ──────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current; if (!container) return
    let animId = 0

    try {
      const w = container.clientWidth, h = container.clientHeight
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(w, h)
      container.appendChild(renderer.domElement)
      rendererRef.current = renderer

      const result = buildScene(project)
      sceneRef.current           = result.scene
      wallMeshesRef.current      = result.wallMeshes
      floorMeshesRef.current     = result.floorMeshes
      ceilMeshesRef.current      = result.ceilMeshes
      clickableMeshesRef.current = result.clickableMeshes
      offsetsRef.current         = result.offsets
      ppmMapRef.current          = result.ppmMap
      zBaseMapRef.current        = result.zBaseMap

      const dg = new THREE.Group(); result.scene.add(dg); draftGroupRef.current = dg

      const camera = new THREE.PerspectiveCamera(50, w / h, 0.05, result.size * 20)
      const dist   = Math.max(result.size * 2, 5)
      const initPos = new THREE.Vector3(result.target.x + dist * 0.7, result.target.y + dist * 0.65, result.target.z + dist)
      camera.position.copy(initPos); camera.lookAt(result.target); cameraRef.current = camera

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.copy(result.target); controls.update(); controlsRef.current = controls

      resetCameraRef.current = () => {
        camera.position.copy(initPos); controls.target.copy(result.target); controls.update()
      }

      const ro = new ResizeObserver(() => {
        const w = container.clientWidth, h = container.clientHeight
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
      }); ro.observe(container)

      // ── Orientation gizmo (2D canvas overlay) ───────────────────────────
      function renderGizmo() {
        const canvas = gizmoCanvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const sz  = 90
        if (canvas.width !== sz * dpr) {
          canvas.width  = sz * dpr
          canvas.height = sz * dpr
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, sz, sz)

        const cx = sz / 2, cy = sz / 2, r = sz * 0.33

        // Background circle
        ctx.fillStyle = 'rgba(15,23,42,0.55)'
        ctx.beginPath(); ctx.arc(cx, cy, sz / 2 - 1, 0, Math.PI * 2); ctx.fill()

        // Axes to project: positive + negative halves
        const axisDefs = [
          { v: new THREE.Vector3(1, 0, 0), posColor: '#ef4444', negColor: 'rgba(239,68,68,0.22)', label: 'X' },
          { v: new THREE.Vector3(0, 1, 0), posColor: '#22c55e', negColor: 'rgba(34,197,94,0.22)',  label: 'Y' },
          { v: new THREE.Vector3(0, 0, 1), posColor: '#60a5fa', negColor: 'rgba(96,165,250,0.22)', label: 'Z' },
        ]

        type GizmoAxis = {
          sx: number; sy: number; depth: number
          color: string; dot: boolean; label: string; lineW: number
        }
        const all: GizmoAxis[] = []
        for (const ax of axisDefs) {
          const pos = ax.v.clone().applyQuaternion(camera.quaternion)
          const neg = ax.v.clone().negate().applyQuaternion(camera.quaternion)
          all.push({ sx: neg.x, sy: -neg.y, depth: neg.z, color: ax.negColor, dot: false, label: '', lineW: 1.5 })
          all.push({ sx: pos.x, sy: -pos.y, depth: pos.z, color: ax.posColor, dot: true,  label: ax.label, lineW: 2.5 })
        }
        all.sort((a, b) => a.depth - b.depth) // back to front

        for (const ax of all) {
          const ex = cx + ax.sx * r, ey = cy + ax.sy * r
          ctx.strokeStyle = ax.color
          ctx.lineWidth   = ax.lineW
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke()
          if (ax.dot) {
            ctx.fillStyle = ax.color
            ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill()
            if (ax.label) {
              ctx.fillStyle   = '#ffffff'
              ctx.font        = 'bold 11px system-ui'
              ctx.textAlign   = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(ax.label, cx + ax.sx * (r + 13), cy + ax.sy * (r + 13))
            }
          }
        }
      }

      function animate() {
        animId = requestAnimationFrame(animate)
        controls.update()
        renderer.render(sceneRef.current!, camera)
        renderGizmo()
      }
      animate()

      // ── Pointer handling ─────────────────────────────────────────────────

      const raycaster = new THREE.Raycaster()
      let dragStartX = 0, dragStartY = 0, dragging = false, lastClickTime = 0

      function getMouseVec(e: PointerEvent) {
        const rect = renderer.domElement.getBoundingClientRect()
        return new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width)  * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
      }

      function applyHighlight(mesh: THREE.Mesh | null) {
        if (activeMeshRef.current) {
          ;(activeMeshRef.current.material as THREE.MeshLambertMaterial).emissive.copy(savedEmissive.current)
          activeMeshRef.current = null
        }
        if (mesh) {
          savedEmissive.current.copy((mesh.material as THREE.MeshLambertMaterial).emissive)
          ;(mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x555555)
          activeMeshRef.current = mesh
        }
      }

      function onPointerDown(e: PointerEvent) {
        dragStartX = e.clientX; dragStartY = e.clientY; dragging = false
        // Push-pull: start drag when clicking on a wall face
        if (pushPullModeRef.current) {
          raycaster.setFromCamera(getMouseVec(e), camera)
          const hits = raycaster.intersectObjects(clickableMeshesRef.current)
          if (hits.length && (hits[0].object as THREE.Mesh).userData.kind === 'wall') {
            const m = hits[0].object as THREE.Mesh
            const normal = wallNormalForEdge(m.userData.edgeId)
            if (normal) {
              const hitPt = hits[0].point.clone()
              // Use a camera-facing plane so mouse movement maps cleanly to 3D delta.
              // The wall-face plane would give dot(hit-startHit, wallNormal) ≡ 0.
              const camDir = camera.getWorldDirection(new THREE.Vector3())
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hitPt)
              ppActiveRef.current = {
                edgeId: m.userData.edgeId, normal, plane,
                startHit: hitPt, mesh: m, origPos: m.position.clone(), currentDisp: 0,
              }
              renderer.domElement.setPointerCapture(e.pointerId)
            }
          }
          return  // don't fall through to orbit/select
        }
      }

      function onPointerMove(e: PointerEvent) {
        // Push-pull drag: project mouse-driven 3D delta onto wall normal
        if (ppActiveRef.current) {
          const pp = ppActiveRef.current
          raycaster.setFromCamera(getMouseVec(e), camera)
          const hit = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(pp.plane, hit)) {
            const disp = hit.clone().sub(pp.startHit).dot(pp.normal)
            pp.currentDisp = disp
            pp.mesh.position.copy(pp.origPos).addScaledVector(pp.normal, disp)
            setPpOffsetDisplay(Math.round(disp * 100) / 100)
          }
          return
        }
        // Only track dragging in select mode — in draw mode orbiting is disabled so dragging is irrelevant
        if (!drawModeRef.current && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 5) dragging = true
        if (!drawModeRef.current) return
        const constr = drawConstrTypeRef.current
        if (!constr) return

        const rect = renderer.domElement.getBoundingClientRect()
        const snap = screenSnap(e.clientX - rect.left, e.clientY - rect.top, rect)
        if (snap) {
          setSnapActive(true)
          updateDraft(draftPtsRef.current, { ...snap, snapped: true })
        } else {
          setSnapActive(false)
          const hit = hitDrawPlane(e, camera, renderer)
          if (hit) updateDraft(draftPtsRef.current, { ...hit, snapped: false })
        }
      }

      function onPointerUp(e: PointerEvent) {
        // Commit push-pull drag
        if (ppActiveRef.current) {
          const pp = ppActiveRef.current
          const disp = pp.currentDisp
          pp.mesh.position.copy(pp.origPos) // reset preview mesh to avoid double-shift
          ppActiveRef.current = null
          setPpOffsetDisplay(null)
          try { renderer.domElement.releasePointerCapture(e.pointerId) } catch (_) { /* ignore */ }
          if (Math.abs(disp) > 0.01) {
            moveWallEdge(pp.edgeId, disp)
            rebuildScene()
          }
          return
        }
        // In draw mode orbiting is disabled — always handle the click.
        // In select mode skip drags (user was orbiting).
        if (!drawModeRef.current && dragging) return

        if (drawModeRef.current) {
          const constr = drawConstrTypeRef.current
          if (!constr) return

          // ── DRAW MODE: place polygon point (horizontal or vertical) ────
          const rect = renderer.domElement.getBoundingClientRect()
          const snap = screenSnap(e.clientX - rect.left, e.clientY - rect.top, rect)
          const pos  = snap ?? hitDrawPlane(e, camera, renderer)
          if (!pos) return

          const pts = draftPtsRef.current
          const now = Date.now()
          const dbl = now - lastClickTime < 350
          lastClickTime = now

          if (pts.length >= 3 && dbl) { finishPolygon(); return }
          if (pts.length >= 3 && snap) {
            const d = Math.hypot(pos.wx - pts[0].wx, pos.wz - pts[0].wz)
            if (d < 0.5) { finishPolygon(); return }
          }

          pts.push(pos)
          setDraftCount(pts.length)
          buildSnapCandidates() // include new draft point as snap target
          updateDraft(pts, { ...pos, snapped: !!snap })
        } else {
          // ── SELECT MODE ───────────────────────────────────────────────────
          raycaster.setFromCamera(getMouseVec(e), camera)
          const hits = raycaster.intersectObjects(clickableMeshesRef.current)
          if (hits.length) {
            const m = hits[0].object as THREE.Mesh
            applyHighlight(m)
            if (m.userData.kind === 'wall') selectEdge(m.userData.edgeId)
            else selectZone(m.userData.zoneId)
          } else {
            applyHighlight(null); selectEdge(null); selectZone(null)
          }
        }
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointermove', onPointerMove)
      renderer.domElement.addEventListener('pointerup',   onPointerUp)

      return () => {
        cancelAnimationFrame(animId); ro.disconnect(); controls.dispose()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerup',   onPointerUp)
        renderer.dispose()
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw mode side-effects ────────────────────────────────────────────────

  useEffect(() => {
    const el = rendererRef.current?.domElement; if (!el) return
    el.style.cursor = drawMode ? 'crosshair' : pushPullMode ? 'ew-resize' : 'default'
    if (controlsRef.current) controlsRef.current.enabled = !drawMode && !pushPullMode
    if (!drawMode) { draftPtsRef.current = []; setDraftCount(0); setSnapActive(false); updateDraft([]) }
    if (!pushPullMode) { ppActiveRef.current = null; setPpOffsetDisplay(null) }
  }, [drawMode, pushPullMode]) // eslint-disable-line

  // Switch construction default when tab changes
  useEffect(() => {
    const first = library.find(c =>
      drawTab === 'horizontal' ? HORIZONTAL_TYPES.has(c.type) : VERTICAL_TYPES.has(c.type)
    )
    if (first) setDrawConstrType(first.type)
  }, [drawTab]) // eslint-disable-line

  // ── Material colour sync ──────────────────────────────────────────────────

  useEffect(() => {
    const active = activeMeshRef.current
    const sync = (m: THREE.Mesh, color: number, opacity: number) => {
      const mat = m.material as THREE.MeshLambertMaterial
      mat.color.setHex(color); mat.opacity = opacity
      if (m !== active) mat.emissive.setHex(0x000000)
      mat.needsUpdate = true
    }
    for (const [eid, m] of wallMeshesRef.current) {
      const e = project.edges[eid]
      sync(m, e?.construction ? (CONSTR_COLOR[e.construction.type] ?? 0x94a3b8) : 0x94a3b8, e?.construction ? 0.9 : 0.18)
    }
    for (const [zid, m] of floorMeshesRef.current) {
      const z = project.zones.find(z => z.id === zid)
      sync(m, z?.floorConstruction ? (CONSTR_COLOR[z.floorConstruction.type] ?? 0xa8a29e) : 0x475569, z?.floorConstruction ? 0.9 : 0.18)
    }
    for (const [zid, m] of ceilMeshesRef.current) {
      const z = project.zones.find(z => z.id === zid)
      sync(m, z?.ceilingConstruction ? (CONSTR_COLOR[z.ceilingConstruction.type] ?? 0xcbd5e1) : 0x475569, z?.ceilingConstruction ? 0.9 : 0.18)
    }
  }, [project.edges, project.zones])

  // ── Render ────────────────────────────────────────────────────────────────

  const planDrawings = project.drawings.filter(d => d.viewType === 'plan')
  const zoneLegend   = project.zoneTypes.map(zt => ({ color: zt.color, label: zt.name }))
  const constrLegend = Object.entries(CONSTR_LABEL).map(([k, l]) => ({
    label: l, color: `#${(CONSTR_COLOR[k] ?? 0x94a3b8).toString(16).padStart(6, '0')}`,
  }))

  const hLib = library.filter(c => HORIZONTAL_TYPES.has(c.type))
  const vLib = library.filter(c => VERTICAL_TYPES.has(c.type))
  const isVerticalDraw = drawTab === 'vertical'

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#1e293b' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 gap-3 flex-wrap" style={{ background: '#0f172a' }}>
        <span className="font-semibold text-sm text-white shrink-0">3D náhled – {project.name}</span>

        {!drawMode && (
          <span className="text-xs" style={{ color: '#6b7280' }}>
            Klikněte na stěnu / podlahu / strop → přiřadit konstrukci
          </span>
        )}

        {drawMode && (
          <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: '#9ca3af' }}>

            {/* Orientation tabs */}
            <div className="flex rounded overflow-hidden" style={{ border: '1px solid #4b5563' }}>
              <button
                onClick={() => setDrawTab('horizontal')}
                style={{
                  padding: '2px 10px', fontSize: 11, cursor: 'pointer',
                  background: drawTab === 'horizontal' ? '#1d4ed8' : '#1e293b',
                  color: 'white', border: 'none',
                }}
              >
                ↔ Vodorovné
              </button>
              <button
                onClick={() => setDrawTab('vertical')}
                style={{
                  padding: '2px 10px', fontSize: 11, cursor: 'pointer',
                  background: drawTab === 'vertical' ? '#1d4ed8' : '#1e293b',
                  color: 'white', border: '1px solid transparent', borderLeft: '1px solid #4b5563',
                }}
              >
                ↕ Svislé
              </button>
            </div>

            {/* Construction picker */}
            <select
              style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #6366f1', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}
              value={drawConstrType}
              onChange={e => setDrawConstrType(e.target.value as ConstructionType)}
            >
              {(isVerticalDraw ? vLib : hLib).map(c => (
                <option key={c.type} value={c.type}>{c.name}</option>
              ))}
            </select>

            {/* Floor selector — only for horizontal */}
            {!isVerticalDraw && (
              <>
                <span style={{ color: '#4b5563' }}>na</span>
                <select
                  style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #4b5563', borderRadius: 4, padding: '2px 4px' }}
                  value={drawTargetId}
                  onChange={e => setDrawTargetId(e.target.value)}
                >
                  {planDrawings.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {/* Zone type */}
                <select
                  style={{ background: '#1e293b', color: '#9ca3af', border: '1px solid #374151', borderRadius: 4, padding: '2px 4px', fontSize: 10 }}
                  value={drawZoneTypeId}
                  onChange={e => setDrawZoneTypeId(e.target.value)}
                >
                  {project.zoneTypes.map(zt => <option key={zt.id} value={zt.id}>{zt.name}</option>)}
                </select>
              </>
            )}

            {/* Status */}
            <span style={{ color: snapActive ? '#22c55e' : '#6b7280' }}>
              {draftCount === 0
                ? 'Klikněte pro první bod'
                : snapActive
                  ? `🔗 ${draftCount} bodů · přichyceno`
                  : `${draftCount} bodů · dvojklik nebo klik na ● pro uzavření`}
            </span>

            {/* Actions */}
            {draftCount >= 3 && (
              <button
                style={{ background: '#16a34a', color: 'white', border: 'none', borderRadius: 4, padding: '2px 10px' }}
                onClick={finishPolygon}
              >✓ Uzavřít</button>
            )}
            {draftCount > 0 && (
              <button
                style={{ background: '#374151', color: '#e2e8f0', border: 'none', borderRadius: 4, padding: '2px 8px' }}
                onClick={() => { draftPtsRef.current = []; setDraftCount(0); setSnapActive(false); updateDraft([]) }}
              >Zrušit body</button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setDrawMode(v => !v)}
            className="px-3 py-1 rounded text-sm text-white"
            style={{ border: '1px solid #4b5563', background: drawMode ? '#1d4ed8' : 'transparent' }}
          >
            ✏ {drawMode ? 'Kreslení ZAP' : 'Kreslit'}
          </button>
          <button
            onClick={() => { setPushPullMode(m => !m); if (drawMode) setDrawMode(false) }}
            className="text-white px-3 py-1 rounded text-sm"
            style={{ border: `1px solid ${pushPullMode ? '#f59e0b' : '#4b5563'}`, background: pushPullMode ? 'rgba(245,158,11,0.2)' : undefined }}
            title="Táhněte stěnu pro změnu rozměrů"
          >
            ↔ {pushPullMode ? 'Posun ZAP' : 'Posunout stěnu'}
          </button>
          <button onClick={() => resetCameraRef.current?.()} className="text-white px-3 py-1 rounded text-sm" style={{ border: '1px solid #4b5563' }}>⌂ Reset</button>
          <button onClick={onClose} className="text-white px-3 py-1 rounded text-sm" style={{ border: '1px solid #4b5563' }}>Zavřít ✕</button>
        </div>
      </div>

      {/* ── Viewport ───────────────────────────────────────────────────────── */}
      <div className="relative flex-1" ref={containerRef}>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)' }}>
            <div style={{ background: '#7f1d1d', color: '#fee2e2', padding: '1.5rem', borderRadius: '0.5rem', maxWidth: '28rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Chyba 3D renderování</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: '1rem' }}>{error}</div>
              <button style={{ fontSize: '0.75rem', textDecoration: 'underline', color: '#fca5a5' }} onClick={onClose}>Zavřít</button>
            </div>
          </div>
        )}

        {/* Construction wizard (select mode only) */}
        {!drawMode && (selectedEdgeId || selectedZoneId) && (
          <div style={{
            position: 'absolute', top: 8, right: 8, width: 288,
            maxHeight: 'calc(100% - 16px)', overflowY: 'auto',
            zIndex: 10, borderRadius: 8,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)', pointerEvents: 'all',
          }}>
            {selectedEdgeId && <EdgeWizard />}
            {!selectedEdgeId && selectedZoneId && <ZoneSurfaceWizard />}
          </div>
        )}
        {/* Orientation gizmo */}
        <canvas
          ref={gizmoCanvasRef}
          style={{
            position: 'absolute', top: 12, left: 12,
            width: 90, height: 90,
            borderRadius: '50%', pointerEvents: 'none',
            zIndex: 5,
          }}
        />

        {/* Push-pull overlay */}
        {pushPullMode && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(245,158,11,0.92)', color: '#1c1917',
            borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600,
            pointerEvents: 'none', zIndex: 10,
          }}>
            {ppOffsetDisplay !== null
              ? `${ppOffsetDisplay >= 0 ? '+' : ''}${ppOffsetDisplay.toFixed(2)} m`
              : '↔ Klikněte na stěnu a táhněte'}
          </div>
        )}
      </div>

      {/* Zone legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: '8px 12px', fontSize: 12, pointerEvents: 'none' }}>
        <div style={{ fontWeight: 600, color: '#4b5563', marginBottom: 4 }}>Typ zóny</div>
        {zoneLegend.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: color, opacity: 0.7, display: 'inline-block' }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Construction legend */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: '8px 12px', fontSize: 12, pointerEvents: 'none' }}>
        <div style={{ fontWeight: 600, color: '#4b5563', marginBottom: 4 }}>Konstrukce</div>
        {constrLegend.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: color, display: 'inline-block' }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
