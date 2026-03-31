// Zustand store for the active project – persists to localStorage

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from '../utils/uuid'
import {
  Project, Zone, Surface, Edge, Opening, Scale, Point,
  Construction, DrawingViewType, Drawing, ProjectMetrics,
  ZoneType,
} from '../types'
import {
  polygonAreaPx, pxAreaToM2, calcPixelsPerMeter,
  distancePx, pxToMeters, round2, zoneInteriorAreaM2,
} from '../utils/geometry'

// ── Default zone types ────────────────────────────────────────────────────────

export const DEFAULT_ZONE_TYPES: ZoneType[] = [
  { id: 'zt_heated',        name: 'Vytápěná',            conditionType: 'HeatedOnly',      color: '#3b82f6' },
  { id: 'zt_unheated',      name: 'Nevytápěná',          conditionType: 'Unheated',        color: '#9ca3af' },
  { id: 'zt_heated_cooled', name: 'Vytápěná + chlazená', conditionType: 'HeatedAndCooled', color: '#8b5cf6' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

type EdgeStatus = Edge['status']

function deriveEdgeStatus(edge: Edge): EdgeStatus {
  if (!edge.construction) return 'incomplete'
  if (!edge.openingsConfirmed) return 'warning'
  return 'complete'
}

function activeDrawing(project: Project): Drawing | undefined {
  return project.drawings.find(d => d.id === project.activeDrawingId)
}

function recalcZone(zone: Zone, scale: Scale | null): Zone {
  if (!scale) return zone
  const areaPx2 = polygonAreaPx(zone.points)
  const areaM2  = round2(pxAreaToM2(areaPx2, scale))
  return { ...zone, areaM2 }
}

function recalcEdgesForPolygon(
  edgeIds: string[],
  edges: Record<string, Edge>,
  scale: Scale | null
): Record<string, Edge> {
  if (!scale) return edges
  const updated = { ...edges }
  for (const edgeId of edgeIds) {
    const edge = updated[edgeId]
    if (!edge) continue
    const lengthMeters = round2(pxToMeters(distancePx(edge.points[0], edge.points[1]), scale))
    const newEdge = { ...edge, lengthMeters }
    updated[edgeId] = { ...newEdge, status: deriveEdgeStatus(newEdge) }
  }
  return updated
}

function computeMetrics(project: Project): ProjectMetrics {
  const { zones, edges, drawings, zoneTypes } = project

  const drawingMap  = new Map(drawings.map(d => [d.id, d]))
  const zoneTypeMap = new Map(zoneTypes.map(zt => [zt.id, zt]))

  // AP = gross polygon area of ALL zones (as drawn, no wall thickness correction)
  // This represents the total floor area including structural elements.
  const floorAreaM2 = round2(zones.reduce((s, z) => s + z.areaM2, 0))

  // AEP = net interior area of CONDITIONED zones only (polygon minus wall corrections)
  // This is the energy-related floor area measured to interior wall faces.
  const conditioned = zones.filter(z => {
    const ct = zoneTypeMap.get(z.zoneTypeId)?.conditionType
    return ct === 'HeatedOnly' || ct === 'HeatedAndCooled'
  })
  const energyRelatedAreaM2 = round2(
    conditioned.reduce((s, z) => s + zoneInteriorAreaM2(z, edges), 0)
  )

  // V = interior volume of conditioned zones (for energy calculations)
  const volumeM3 = round2(
    conditioned.reduce((s, z) => {
      const h = drawingMap.get(z.drawingId)?.floorHeightMeters ?? 3
      return s + zoneInteriorAreaM2(z, edges) * h
    }, 0)
  )

  const allEdgesComplete = Object.values(edges).every(e => e.status === 'complete')

  return { floorAreaM2, energyRelatedAreaM2, volumeM3, allEdgesComplete }
}

function makeDefaultDrawing(viewType: DrawingViewType = 'plan', name?: string): Drawing {
  return {
    id: uuid(),
    name: name ?? (viewType === 'plan' ? 'Půdorys' : viewType === 'elevation' ? 'Pohled' : 'Řez'),
    viewType,
    backgroundImage: null,
    backgroundRotation: 0,
    scale: null,
    floorHeightMeters: 3.0,
  }
}

// ── Store interface ───────────────────────────────────────────────────────────

interface ProjectState {
  project: Project
  metrics: ProjectMetrics

  // Project metadata
  setProjectMeta: (changes: { name?: string; buildingType?: string; location?: string }) => void

  // Drawing management
  setActiveDrawing: (drawingId: string) => void
  addDrawing: (viewType: DrawingViewType, name?: string) => void
  duplicateDrawing: (drawingId: string) => void
  removeDrawing: (drawingId: string) => void
  renameDrawing: (drawingId: string, name: string) => void
  reorderDrawing: (drawingId: string, direction: 'up' | 'down') => void
  setDrawingFloorHeight: (drawingId: string, height: number) => void

  // Active drawing: background + scale
  setBackgroundImage: (dataUrl: string | null) => void
  setBackgroundRotation: (degrees: number) => void
  setScale: (pointA: Point, pointB: Point, realDistanceMeters: number) => void
  clearScale: () => void

  // Zone types (global, project-level)
  addZoneType: (partial: Omit<ZoneType, 'id'>) => void
  updateZoneType: (id: string, changes: Partial<Omit<ZoneType, 'id'>>) => void
  removeZoneType: (id: string) => void

  // Zones (plan drawings only)
  addZone: (points: Point[], zoneTypeId: string) => void
  addZoneToDrawing: (drawingId: string, points: Point[], zoneTypeId: string, floorConstruction?: Construction | null, ceilingConstruction?: Construction | null, edgeConstruction?: Construction | null) => void
  deleteZone: (zoneId: string, force?: boolean) => boolean
  replicateZone: (zoneId: string, targetDrawingId: string) => void

  // Surfaces (elevation/section drawings)
  addSurface: (points: Point[]) => void
  deleteSurface: (surfaceId: string) => void
  linkSurfaceToPlanEdge: (surfaceId: string, planEdgeId: string | null) => void

  // Edges
  setEdgeConstruction: (edgeId: string, construction: Construction) => void
  addOpening: (edgeId: string, opening: Omit<Opening, 'id'>) => void
  removeOpening: (edgeId: string, openingId: string) => void
  confirmNoOpenings: (edgeId: string) => void
  linkEdges: (edgeId: string, linkedEdgeId: string | null) => void
  selectEdge: (edgeId: string | null) => void
  selectedEdgeId: string | null

  // Zone / surface polygon selection
  selectedZoneId: string | null
  selectedSurfaceId: string | null
  selectZone: (zoneId: string | null) => void
  selectSurface: (surfaceId: string | null) => void
  setZoneFloorConstruction: (zoneId: string, c: Construction | null) => void
  setZoneCeilingConstruction: (zoneId: string, c: Construction | null) => void
  setSurfaceConstruction: (surfaceId: string, c: Construction | null) => void

  // Project meta
  setProjectName: (name: string) => void
  resetProject: () => void

  // Project file I/O
  exportProjectFile: () => void
  importProjectFile: (json: string) => string | null  // returns error message or null on success
}

// ── Initial state ─────────────────────────────────────────────────────────────

function emptyProject(): Project {
  const d = makeDefaultDrawing('plan', 'Půdorys')
  return {
    id: uuid(),
    name: 'Nový projekt',
    buildingType: 'MultiFamily',
    location: '',
    activeDrawingId: d.id,
    drawings: [d],
    zoneTypes: [...DEFAULT_ZONE_TYPES],
    zones: [],
    surfaces: [],
    edges: {},
  }
}

const emptyMetrics: ProjectMetrics = {
  floorAreaM2: 0, energyRelatedAreaM2: 0, volumeM3: 0, allEdgesComplete: true,
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      project: emptyProject(),
      metrics: emptyMetrics,
      selectedEdgeId: null,
      selectedZoneId: null,
      selectedSurfaceId: null,

      // ── Project metadata ────────────────────────────────────────────────────

      setProjectMeta: (changes) =>
        set(s => ({ project: { ...s.project, ...changes } })),

      // ── Drawing management ──────────────────────────────────────────────────

      setActiveDrawing: (drawingId) =>
        set(s => ({ project: { ...s.project, activeDrawingId: drawingId }, selectedEdgeId: null, selectedZoneId: null, selectedSurfaceId: null })),

      addDrawing: (viewType, name) =>
        set(s => {
          const d = makeDefaultDrawing(viewType, name)
          return { project: { ...s.project, drawings: [...s.project.drawings, d], activeDrawingId: d.id } }
        }),

      duplicateDrawing: (drawingId) =>
        set(s => {
          const src = s.project.drawings.find(d => d.id === drawingId)
          if (!src || src.viewType !== 'plan') return s

          // New drawing: same scale + height, no background image, name suffixed
          const newDrawing: typeof src = {
            ...makeDefaultDrawing('plan', `${src.name} (kopie)`),
            scale:             src.scale,
            floorHeightMeters: src.floorHeightMeters,
          }

          // Copy all zones from the source drawing into the new drawing
          const sourceZones = s.project.zones.filter(z => z.drawingId === drawingId)
          const newZones: typeof s.project.zones = []
          const newEdges: Record<string, Edge> = {}

          for (const sourceZone of sourceZones) {
            const newZoneId = uuid()
            const edgeIds: string[] = []

            for (let i = 0; i < sourceZone.points.length; i++) {
              const edgeId = uuid()
              const edgePts: [Point, Point] = [
                sourceZone.points[i],
                sourceZone.points[(i + 1) % sourceZone.points.length],
              ]
              const sourceEdge = s.project.edges[sourceZone.edgeIds[i]]
              newEdges[edgeId] = {
                id: edgeId, points: edgePts,
                lengthMeters:      sourceEdge?.lengthMeters      ?? 0,
                construction:      sourceEdge?.construction      ?? null,
                openings:          (sourceEdge?.openings ?? []).map(o => ({ ...o, id: uuid() })),
                openingsConfirmed: sourceEdge?.openingsConfirmed ?? false,
                status:            sourceEdge?.status            ?? 'incomplete',
                linkedEdgeId: null,
              }
              edgeIds.push(edgeId)
            }

            newZones.push({
              ...sourceZone,
              id: newZoneId,
              drawingId: newDrawing.id,
              edgeIds,
              floorConstruction:   sourceZone.floorConstruction,
              ceilingConstruction: sourceZone.ceilingConstruction,
            })
          }

          const updated = {
            ...s.project,
            drawings: [...s.project.drawings, newDrawing],
            zones:    [...s.project.zones, ...newZones],
            edges:    { ...s.project.edges, ...newEdges },
            activeDrawingId: newDrawing.id,
          }
          return { project: updated, metrics: computeMetrics(updated) }
        }),

      removeDrawing: (drawingId) =>
        set(s => {
          if (s.project.drawings.length <= 1) return s
          const drawings  = s.project.drawings.filter(d => d.id !== drawingId)
          const zones     = s.project.zones.filter(z => z.drawingId !== drawingId)
          const surfaces  = s.project.surfaces.filter(su => su.drawingId !== drawingId)
          const keepEdgeIds = new Set([
            ...zones.flatMap(z => z.edgeIds),
            ...surfaces.flatMap(su => su.edgeIds),
          ])
          const edges = Object.fromEntries(
            Object.entries(s.project.edges).filter(([id]) => keepEdgeIds.has(id))
          )
          const activeDrawingId = drawingId === s.project.activeDrawingId
            ? drawings[0].id
            : s.project.activeDrawingId
          const updated = { ...s.project, drawings, zones, surfaces, edges, activeDrawingId }
          return { project: updated, metrics: computeMetrics(updated) }
        }),

      renameDrawing: (drawingId, name) =>
        set(s => ({
          project: {
            ...s.project,
            drawings: s.project.drawings.map(d => d.id === drawingId ? { ...d, name } : d),
          },
        })),

      reorderDrawing: (drawingId, direction) =>
        set(s => {
          const drawings = [...s.project.drawings]
          const idx = drawings.findIndex(d => d.id === drawingId)
          if (idx < 0) return s
          const swapIdx = direction === 'up' ? idx - 1 : idx + 1
          if (swapIdx < 0 || swapIdx >= drawings.length) return s
          ;[drawings[idx], drawings[swapIdx]] = [drawings[swapIdx], drawings[idx]]
          return { project: { ...s.project, drawings } }
        }),

      setDrawingFloorHeight: (drawingId, height) =>
        set(s => {
          const drawings = s.project.drawings.map(d =>
            d.id === drawingId ? { ...d, floorHeightMeters: height } : d
          )
          const updated = { ...s.project, drawings }
          return { project: updated, metrics: computeMetrics(updated) }
        }),

      // ── Active drawing props ────────────────────────────────────────────────

      setBackgroundImage: (dataUrl) =>
        set(s => ({
          project: {
            ...s.project,
            drawings: s.project.drawings.map(d =>
              d.id === s.project.activeDrawingId ? { ...d, backgroundImage: dataUrl } : d
            ),
          },
        })),

      setBackgroundRotation: (degrees) =>
        set(s => ({
          project: {
            ...s.project,
            drawings: s.project.drawings.map(d =>
              d.id === s.project.activeDrawingId ? { ...d, backgroundRotation: degrees } : d
            ),
          },
        })),

      setScale: (pointA, pointB, realDistanceMeters) => {
        const pixelsPerMeter = calcPixelsPerMeter(pointA, pointB, realDistanceMeters)
        const scale: Scale = { pointA, pointB, realDistanceMeters, pixelsPerMeter }
        set(s => {
          const drawingId = s.project.activeDrawingId
          const drawings  = s.project.drawings.map(d =>
            d.id === drawingId ? { ...d, scale } : d
          )
          let edges = s.project.edges
          const zones = s.project.zones.map(z => {
            if (z.drawingId !== drawingId) return z
            edges = recalcEdgesForPolygon(z.edgeIds, edges, scale)
            return recalcZone(z, scale)
          })
          s.project.surfaces.forEach(su => {
            if (su.drawingId === drawingId)
              edges = recalcEdgesForPolygon(su.edgeIds, edges, scale)
          })
          const updated = { ...s.project, drawings, zones, edges }
          return { project: updated, metrics: computeMetrics(updated) }
        })
      },

      clearScale: () =>
        set(s => ({
          project: {
            ...s.project,
            drawings: s.project.drawings.map(d =>
              d.id === s.project.activeDrawingId ? { ...d, scale: null } : d
            ),
          },
        })),

      // ── Zone types ──────────────────────────────────────────────────────────

      addZoneType: (partial) =>
        set(s => ({
          project: {
            ...s.project,
            zoneTypes: [...s.project.zoneTypes, { ...partial, id: uuid() }],
          },
        })),

      updateZoneType: (id, changes) =>
        set(s => ({
          project: {
            ...s.project,
            zoneTypes: s.project.zoneTypes.map(zt =>
              zt.id === id ? { ...zt, ...changes } : zt
            ),
          },
        })),

      removeZoneType: (id) =>
        set(s => {
          // Do not remove if zones are using this type
          const inUse = s.project.zones.some(z => z.zoneTypeId === id)
          if (inUse) return s
          return {
            project: {
              ...s.project,
              zoneTypes: s.project.zoneTypes.filter(zt => zt.id !== id),
            },
          }
        }),

      // ── Zones ───────────────────────────────────────────────────────────────

      addZone: (points, zoneTypeId) => {
        const { project } = get()
        const drawing = activeDrawing(project)
        if (!drawing || drawing.viewType !== 'plan') return

        const zoneType = project.zoneTypes.find(zt => zt.id === zoneTypeId)
        if (!zoneType) return

        const zoneId = uuid()
        const newEdges: Record<string, Edge> = {}
        const edgeIds: string[] = []

        for (let i = 0; i < points.length; i++) {
          const edgeId   = uuid()
          const edgePts: [Point, Point] = [points[i], points[(i + 1) % points.length]]
          const lengthMeters = drawing.scale
            ? round2(pxToMeters(distancePx(edgePts[0], edgePts[1]), drawing.scale))
            : 0
          // Plan edges: openings not used here, auto-confirm later when construction set
          newEdges[edgeId] = {
            id: edgeId, points: edgePts, lengthMeters,
            construction: null, openings: [], openingsConfirmed: false,
            status: 'incomplete', linkedEdgeId: null,
          }
          edgeIds.push(edgeId)
        }

        const areaPx2 = polygonAreaPx(points)
        const areaM2  = drawing.scale ? round2(pxAreaToM2(areaPx2, drawing.scale)) : 0

        // Generate name: type name + floor counter on this drawing
        const sameTypeOnDrawing = project.zones.filter(
          z => z.drawingId === drawing.id && z.zoneTypeId === zoneTypeId
        ).length
        const nameSuffix = sameTypeOnDrawing > 0 ? ` (${sameTypeOnDrawing + 1})` : ''
        const name = `${zoneType.name}${nameSuffix}`

        const zone: Zone = {
          id: zoneId, drawingId: drawing.id,
          zoneTypeId, name,
          points, areaM2, edgeIds,
          floorConstruction: null,
          ceilingConstruction: null,
        }
        set(s => {
          const updated = {
            ...s.project,
            zones: [...s.project.zones, zone],
            edges: { ...s.project.edges, ...newEdges },
          }
          return { project: updated, metrics: computeMetrics(updated) }
        })
      },

      addZoneToDrawing: (drawingId, points, zoneTypeId, floorConstruction = null, ceilingConstruction = null, edgeConstruction = null) => {
        const { project } = get()
        const drawing  = project.drawings.find(d => d.id === drawingId)
        const zoneType = project.zoneTypes.find(zt => zt.id === zoneTypeId)
        if (!drawing || drawing.viewType !== 'plan' || !zoneType) return

        const zoneId   = uuid()
        const newEdges: Record<string, Edge> = {}
        const edgeIds: string[] = []

        for (let i = 0; i < points.length; i++) {
          const edgeId  = uuid()
          const edgePts: [Point, Point] = [points[i], points[(i + 1) % points.length]]
          const lengthMeters = drawing.scale
            ? round2(pxToMeters(distancePx(edgePts[0], edgePts[1]), drawing.scale))
            : 0
          newEdges[edgeId] = {
            id: edgeId, points: edgePts, lengthMeters,
            construction: edgeConstruction ?? null,
            openings: [], openingsConfirmed: false,
            status: edgeConstruction ? 'warning' : 'incomplete',
            linkedEdgeId: null,
          }
          edgeIds.push(edgeId)
        }

        const areaPx2 = polygonAreaPx(points)
        const areaM2  = drawing.scale ? round2(pxAreaToM2(areaPx2, drawing.scale)) : 0
        const sameType = project.zones.filter(z => z.drawingId === drawingId && z.zoneTypeId === zoneTypeId).length
        const name     = `${zoneType.name}${sameType > 0 ? ` (${sameType + 1})` : ''}`

        const zone: Zone = {
          id: zoneId, drawingId, zoneTypeId, name,
          points, areaM2, edgeIds,
          floorConstruction:   floorConstruction   ?? null,
          ceilingConstruction: ceilingConstruction ?? null,
        }
        set(s => {
          const updated = { ...s.project, zones: [...s.project.zones, zone], edges: { ...s.project.edges, ...newEdges } }
          return { project: updated, metrics: computeMetrics(updated) }
        })
      },

      deleteZone: (zoneId, force = false) => {
        const { project } = get()
        const zone = project.zones.find(z => z.id === zoneId)
        if (!zone) return false
        const hasComplete = zone.edgeIds.some(eid => project.edges[eid]?.status === 'complete')
        if (hasComplete && !force) return false
        const edgeSet = new Set(zone.edgeIds)
        const zones = project.zones.filter(z => z.id !== zoneId)
        const edges = Object.fromEntries(
          Object.entries(project.edges).filter(([id]) => !edgeSet.has(id))
        )
        set(s => {
          const updated = { ...s.project, zones, edges }
          return { project: updated, metrics: computeMetrics(updated) }
        })
        return true
      },

      replicateZone: (zoneId, targetDrawingId) => {
        const { project } = get()
        const sourceZone = project.zones.find(z => z.id === zoneId)
        const targetDrawing = project.drawings.find(d => d.id === targetDrawingId)
        if (!sourceZone || !targetDrawing || targetDrawing.viewType !== 'plan') return

        // If target drawing has no scale, inherit it from the source drawing
        const sourceDrawing = project.drawings.find(d => d.id === sourceZone.drawingId)
        const effectiveScale = targetDrawing.scale ?? sourceDrawing?.scale ?? null

        const newZoneId = uuid()
        const newEdges: Record<string, Edge> = {}
        const edgeIds: string[] = []

        // Copy edges using effective scale, preserving construction + openings
        for (let i = 0; i < sourceZone.points.length; i++) {
          const edgeId     = uuid()
          const edgePts: [Point, Point] = [
            sourceZone.points[i],
            sourceZone.points[(i + 1) % sourceZone.points.length],
          ]
          const lengthMeters = effectiveScale
            ? round2(pxToMeters(distancePx(edgePts[0], edgePts[1]), effectiveScale))
            : 0
          const sourceEdge = project.edges[sourceZone.edgeIds[i]]
          newEdges[edgeId] = {
            id: edgeId, points: edgePts, lengthMeters,
            construction:       sourceEdge?.construction       ?? null,
            openings:           (sourceEdge?.openings ?? []).map(o => ({ ...o, id: uuid() })),
            openingsConfirmed:  sourceEdge?.openingsConfirmed  ?? false,
            status:             sourceEdge?.status             ?? 'incomplete',
            linkedEdgeId: null,
          }
          edgeIds.push(edgeId)
        }

        const areaPx2 = polygonAreaPx(sourceZone.points)
        const areaM2  = effectiveScale
          ? round2(pxAreaToM2(areaPx2, effectiveScale))
          : sourceZone.areaM2

        const zoneType  = project.zoneTypes.find(zt => zt.id === sourceZone.zoneTypeId)
        const sameTypeOnTarget = project.zones.filter(
          z => z.drawingId === targetDrawingId && z.zoneTypeId === sourceZone.zoneTypeId
        ).length
        const nameSuffix = sameTypeOnTarget > 0 ? ` (${sameTypeOnTarget + 1})` : ''
        const name = `${zoneType?.name ?? 'Zóna'}${nameSuffix}`

        const newZone: Zone = {
          id: newZoneId, drawingId: targetDrawingId,
          zoneTypeId: sourceZone.zoneTypeId, name,
          points: [...sourceZone.points], areaM2, edgeIds,
          floorConstruction:   sourceZone.floorConstruction,
          ceilingConstruction: sourceZone.ceilingConstruction,
        }

        set(s => {
          // Propagate scale to target drawing if it didn't have one
          const drawings = effectiveScale && !targetDrawing.scale
            ? s.project.drawings.map(d =>
                d.id === targetDrawingId ? { ...d, scale: effectiveScale } : d
              )
            : s.project.drawings
          const updated = {
            ...s.project,
            drawings,
            zones: [...s.project.zones, newZone],
            edges: { ...s.project.edges, ...newEdges },
          }
          return { project: updated, metrics: computeMetrics(updated) }
        })
      },

      // ── Surfaces ────────────────────────────────────────────────────────────

      addSurface: (points) => {
        const { project } = get()
        const drawing = activeDrawing(project)
        if (!drawing || drawing.viewType === 'plan') return

        const surfaceId = uuid()
        const newEdges: Record<string, Edge> = {}
        const edgeIds: string[] = []

        for (let i = 0; i < points.length; i++) {
          const edgeId = uuid()
          const edgePts: [Point, Point] = [points[i], points[(i + 1) % points.length]]
          const lengthMeters = drawing.scale
            ? round2(pxToMeters(distancePx(edgePts[0], edgePts[1]), drawing.scale))
            : 0
          newEdges[edgeId] = {
            id: edgeId, points: edgePts, lengthMeters,
            construction: null, openings: [], openingsConfirmed: false,
            status: 'incomplete', linkedEdgeId: null,
          }
          edgeIds.push(edgeId)
        }

        const surface: Surface = {
          id: surfaceId, drawingId: drawing.id,
          name: `Plocha ${project.surfaces.length + 1}`,
          points, edgeIds, linkedPlanEdgeId: null,
          construction: null,
        }
        set(s => {
          const updated = {
            ...s.project,
            surfaces: [...s.project.surfaces, surface],
            edges: { ...s.project.edges, ...newEdges },
          }
          return { project: updated, metrics: computeMetrics(updated) }
        })
      },

      deleteSurface: (surfaceId) =>
        set(s => {
          const surface = s.project.surfaces.find(su => su.id === surfaceId)
          if (!surface) return s
          const edgeSet = new Set(surface.edgeIds)
          const surfaces = s.project.surfaces.filter(su => su.id !== surfaceId)
          const edges = Object.fromEntries(
            Object.entries(s.project.edges).filter(([id]) => !edgeSet.has(id))
          )
          const updated = { ...s.project, surfaces, edges }
          return { project: updated, metrics: computeMetrics(updated) }
        }),

      linkSurfaceToPlanEdge: (surfaceId, planEdgeId) =>
        set(s => ({
          project: {
            ...s.project,
            surfaces: s.project.surfaces.map(su =>
              su.id === surfaceId ? { ...su, linkedPlanEdgeId: planEdgeId } : su
            ),
          },
        })),

      // ── Edges ───────────────────────────────────────────────────────────────

      setEdgeConstruction: (edgeId, construction) =>
        set(s => {
          const edge = s.project.edges[edgeId]
          if (!edge) return s
          // Plan edges (in a zone) auto-confirm openings – no step 2
          const isPlanEdge = s.project.zones.some(z => z.edgeIds.includes(edgeId))
          const openingsConfirmed = isPlanEdge ? true : false
          const updated: Edge = {
            ...edge, construction, openingsConfirmed,
            status: isPlanEdge ? 'complete' : 'warning',
          }
          const edges = { ...s.project.edges, [edgeId]: updated }
          const project = { ...s.project, edges }
          return { project, metrics: computeMetrics(project) }
        }),

      addOpening: (edgeId, opening) =>
        set(s => {
          const edge = s.project.edges[edgeId]
          if (!edge) return s
          const newOpening: Opening = { ...opening, id: uuid() }
          const updated: Edge = {
            ...edge,
            openings: [...edge.openings, newOpening],
            openingsConfirmed: false,
            status: edge.construction ? 'warning' : 'incomplete',
          }
          const edges = { ...s.project.edges, [edgeId]: updated }
          const project = { ...s.project, edges }
          return { project, metrics: computeMetrics(project) }
        }),

      removeOpening: (edgeId, openingId) =>
        set(s => {
          const edge = s.project.edges[edgeId]
          if (!edge) return s
          const updated: Edge = {
            ...edge,
            openings: edge.openings.filter(o => o.id !== openingId),
            openingsConfirmed: false,
          }
          updated.status = deriveEdgeStatus(updated)
          const edges = { ...s.project.edges, [edgeId]: updated }
          const project = { ...s.project, edges }
          return { project, metrics: computeMetrics(project) }
        }),

      confirmNoOpenings: (edgeId) =>
        set(s => {
          const edge = s.project.edges[edgeId]
          if (!edge) return s
          const updated: Edge = {
            ...edge,
            openingsConfirmed: true,
            status: deriveEdgeStatus({ ...edge, openingsConfirmed: true }),
          }
          const edges = { ...s.project.edges, [edgeId]: updated }
          const project = { ...s.project, edges }
          return { project, metrics: computeMetrics(project) }
        }),

      linkEdges: (edgeId, linkedEdgeId) =>
        set(s => {
          const edge = s.project.edges[edgeId]
          if (!edge) return s
          const edges = { ...s.project.edges, [edgeId]: { ...edge, linkedEdgeId } }
          return { project: { ...s.project, edges } }
        }),

      selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedZoneId: null, selectedSurfaceId: null }),

      selectZone: (zoneId) => set({ selectedZoneId: zoneId, selectedEdgeId: null, selectedSurfaceId: null }),

      selectSurface: (surfaceId) => set({ selectedSurfaceId: surfaceId, selectedEdgeId: null, selectedZoneId: null }),

      setZoneFloorConstruction: (zoneId, construction) =>
        set(s => ({
          project: {
            ...s.project,
            zones: s.project.zones.map(z => z.id === zoneId ? { ...z, floorConstruction: construction } : z),
          },
        })),

      setZoneCeilingConstruction: (zoneId, construction) =>
        set(s => ({
          project: {
            ...s.project,
            zones: s.project.zones.map(z => z.id === zoneId ? { ...z, ceilingConstruction: construction } : z),
          },
        })),

      setSurfaceConstruction: (surfaceId, construction) =>
        set(s => ({
          project: {
            ...s.project,
            surfaces: s.project.surfaces.map(su => su.id === surfaceId ? { ...su, construction } : su),
          },
        })),

      setProjectName: (name) =>
        set(s => ({ project: { ...s.project, name } })),

      resetProject: () =>
        set({ project: emptyProject(), metrics: emptyMetrics, selectedEdgeId: null, selectedZoneId: null, selectedSurfaceId: null }),

      exportProjectFile: () => {
        const { project } = get()
        const json  = JSON.stringify({ version: 1, project }, null, 2)
        const blob  = new Blob([json], { type: 'application/json;charset=utf-8;' })
        const url   = URL.createObjectURL(blob)
        const a     = document.createElement('a')
        // Sanitise filename: strip diacritics, replace spaces/special chars
        const safe  = project.name
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_').replace(/^_|_$/g, '') || 'projekt'
        a.href     = url
        a.download = `${safe}.epgeo.json`
        a.click()
        URL.revokeObjectURL(url)
      },

      importProjectFile: (json) => {
        try {
          const parsed = JSON.parse(json)
          // Accept both wrapped { version, project } and bare project objects
          const raw = (parsed && typeof parsed === 'object' && parsed.project) ? parsed.project : parsed
          if (!raw || typeof raw !== 'object') return 'Neplatný formát souboru.'

          const migratedProject: Project = { ...emptyProject(), ...raw }

          migratedProject.buildingType = migratedProject.buildingType ?? 'MultiFamily'
          migratedProject.location     = migratedProject.location ?? ''
          migratedProject.drawings     = (migratedProject.drawings ?? []).map((d: Drawing) => ({
            ...d,
            floorHeightMeters: (d as Drawing & { floorHeightMeters?: number }).floorHeightMeters ?? 3.0,
          }))
          if (!migratedProject.zoneTypes?.length) {
            migratedProject.zoneTypes = [...DEFAULT_ZONE_TYPES]
          }
          migratedProject.surfaces = migratedProject.surfaces ?? []
          migratedProject.zones    = (migratedProject.zones ?? []).map((z: Zone) => ({
            ...z,
            drawingId:  z.drawingId  ?? migratedProject.activeDrawingId,
            zoneTypeId: z.zoneTypeId ?? 'zt_heated',
            floorConstruction:   z.floorConstruction   ?? null,
            ceilingConstruction: z.ceilingConstruction ?? null,
          }))
          migratedProject.surfaces = (migratedProject.surfaces ?? []).map((su: Surface) => ({
            ...su,
            construction: su.construction ?? null,
          }))

          const edges: Record<string, Edge> = {}
          for (const [k, v] of Object.entries(migratedProject.edges ?? {})) {
            const e = v as Edge & { construction?: (Construction & { uValue?: number; thicknessMeters?: number }) | null }
            edges[k] = {
              ...e,
              construction: e.construction
                ? { type: e.construction.type, name: e.construction.name,
                    thicknessMeters: e.construction.thicknessMeters ?? 0 }
                : null,
              openings:    (e.openings ?? []).map(o => ({ id: o.id, type: o.type, area: o.area, count: o.count })),
              linkedEdgeId: e.linkedEdgeId ?? null,
            }
          }
          migratedProject.edges = edges

          set({ project: migratedProject, metrics: computeMetrics(migratedProject), selectedEdgeId: null })
          return null
        } catch {
          return 'Soubor nelze načíst – zkontrolujte formát.'
        }
      },
    }),
    {
      name: 'ep-project',
      // Exclude backgroundImage (base64) from localStorage – it fills the quota quickly.
      // Images are re-uploaded by the user each session; all other state persists normally.
      partialize: (state) => ({
        ...state,
        project: {
          ...state.project,
          drawings: state.project.drawings.map(d => ({
            ...d,
            backgroundImage: null,
          })),
        },
      }),
      merge: (persisted, current) => {
        const p = persisted as typeof current
        const empty = emptyProject()
        const migratedProject: Project = { ...empty, ...p.project }

        // Migration: old project without drawings → wrap in default drawing
        if (!migratedProject.drawings || migratedProject.drawings.length === 0) {
          const d = makeDefaultDrawing('plan', 'Půdorys')
          const oldProject = p.project as unknown as Record<string, unknown>
          d.backgroundImage    = (oldProject['backgroundImage'] as string | null) ?? null
          d.backgroundRotation = (oldProject['backgroundRotation'] as number) ?? 0
          d.scale              = (oldProject['scale'] as Scale | null) ?? null
          migratedProject.drawings = [d]
          migratedProject.activeDrawingId = d.id
          migratedProject.zones = (migratedProject.zones ?? []).map(z => ({
            ...z, drawingId: z.drawingId ?? d.id,
          }))
        }

        // Ensure floorHeightMeters on drawings
        migratedProject.drawings = migratedProject.drawings.map(d => ({
          ...d,
          floorHeightMeters: (d as Drawing & { floorHeightMeters?: number }).floorHeightMeters ?? 3.0,
        }))

        // Ensure zoneTypes
        if (!migratedProject.zoneTypes || migratedProject.zoneTypes.length === 0) {
          migratedProject.zoneTypes = [...DEFAULT_ZONE_TYPES]
        }

        // Ensure project metadata fields
        migratedProject.buildingType = migratedProject.buildingType ?? 'MultiFamily'
        migratedProject.location     = migratedProject.location ?? ''

        migratedProject.surfaces = migratedProject.surfaces ?? []
        migratedProject.zones = (migratedProject.zones ?? []).map(z => {
          const oldZ = z as Zone & { floorHeightMeters?: number; conditionType?: string; zoneTypeId?: string }
          return {
            ...z,
            drawingId:  z.drawingId ?? migratedProject.activeDrawingId,
            // Migrate old conditionType to nearest zoneTypeId
            zoneTypeId: oldZ.zoneTypeId ?? (() => {
              const ct = oldZ.conditionType ?? 'HeatedOnly'
              if (ct === 'HeatedAndCooled') return 'zt_heated_cooled'
              if (ct === 'Unheated' || ct === 'Unconditioned') return 'zt_unheated'
              return 'zt_heated'
            })(),
            floorConstruction:   z.floorConstruction   ?? null,
            ceilingConstruction: z.ceilingConstruction ?? null,
          }
        })
        migratedProject.surfaces = (migratedProject.surfaces ?? []).map((su: Surface) => ({
          ...su,
          construction: su.construction ?? null,
        }))

        // Migrate edges: remove legacy uValue fields
        const edges: Record<string, Edge> = {}
        for (const [k, v] of Object.entries(migratedProject.edges ?? {})) {
          const e = v as Edge & { construction?: (Construction & { uValue?: number }) | null }
          const construction = e.construction
            ? {
                type: e.construction.type,
                name: e.construction.name,
                thicknessMeters: (e.construction as Construction & { thicknessMeters?: number }).thicknessMeters ?? 0,
              }
            : null
          const openings = (e.openings ?? []).map(o => ({
            id: o.id, type: o.type, area: o.area, count: o.count,
          }))
          edges[k] = {
            ...e,
            construction,
            openings,
            linkedEdgeId: e.linkedEdgeId ?? null,
          }
        }
        migratedProject.edges = edges

        return { ...current, ...p, project: migratedProject }
      },
    }
  )
)
