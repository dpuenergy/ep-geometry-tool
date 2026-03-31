// gbXML v0.37 – full 3D export
//
// Strategy:
//   1. Plan drawings, sorted by array order → cumulative Z offsets
//   2. Zone polygon points → 3D world coords via drawing scale (px → m)
//   3. Each zone → <Space> with <ShellGeometry> (extruded polygon)
//   4. Each plan edge → <Surface> with planar 3D geometry + openings
//      (openings collected from linked elevation surfaces)
//   5. Adjacency: edges from two zones within tolerance → InteriorWall
//   6. Floor / ceiling faces auto-generated per zone
//   7. Constructions deduplicated by type

import { Project, Opening } from '../types'
import { round2 } from './geometry'

// ── 3D vector ─────────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }

function toWorld(pt: { x: number; y: number }, ppm: number, z: number): Vec3 {
  return { x: round2(pt.x / ppm), y: round2(pt.y / ppm), z: round2(z) }
}

// ── Adjacency detection ───────────────────────────────────────────────────────
//
// Two plan edges are adjacent (shared wall between zones) when both endpoints
// match within ADJ_TOL_PX pixels.  The tolerance is intentionally generous so
// that edges drawn independently but meant to coincide are treated as shared.

const ADJ_TOL_PX = 12

// Bounding-box overlap test — used to detect which zone on floor N+1 sits
// above a zone on floor N.  Good enough for typical buildings where zones
// align between floors (no complex cantilevers).
function bboxOverlap(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  const axMin = Math.min(...a.map(p => p.x)), axMax = Math.max(...a.map(p => p.x))
  const ayMin = Math.min(...a.map(p => p.y)), ayMax = Math.max(...a.map(p => p.y))
  const bxMin = Math.min(...b.map(p => p.x)), bxMax = Math.max(...b.map(p => p.x))
  const byMin = Math.min(...b.map(p => p.y)), byMax = Math.max(...b.map(p => p.y))
  return axMax > bxMin && axMin < bxMax && ayMax > byMin && ayMin < byMax
}

function ptClose(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < ADJ_TOL_PX
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function makeHelpers(doc: XMLDocument) {
  function el(tag: string, attrs: Record<string, string> = {}): Element {
    const e = doc.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    return e
  }
  function txt(parent: Element, tag: string, value: string) {
    const n = doc.createElement(tag)
    n.textContent = value
    parent.appendChild(n)
  }
  function polyLoop(pts: Vec3[]): Element {
    const pl = el('PolyLoop')
    for (const p of pts) {
      const cp = el('CartesianPoint')
      txt(cp, 'Coordinate', String(p.x))
      txt(cp, 'Coordinate', String(p.y))
      txt(cp, 'Coordinate', String(p.z))
      pl.appendChild(cp)
    }
    return pl
  }
  return { el, txt, polyLoop }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportGbXml(project: Project): void {
  const { zones, edges, surfaces, drawings, zoneTypes, name } = project

  // Plan drawings in array order → Z base for each floor
  const planDrawings = drawings.filter(d => d.viewType === 'plan')
  const drawingZ = new Map<string, number>()
  let cumZ = 0
  for (const d of planDrawings) {
    drawingZ.set(d.id, cumZ)
    cumZ += d.floorHeightMeters
  }

  const drawingMap  = new Map(drawings.map(d => [d.id, d]))
  const zoneTypeMap = new Map(zoneTypes.map(zt => [zt.id, zt]))

  // Collect openings per plan edge from linked elevation surfaces
  // (openings are stored on elevation edges; surface.linkedPlanEdgeId ties
  //  the whole elevation surface to one plan edge)
  const planEdgeOpenings = new Map<string, Opening[]>()
  for (const surf of surfaces) {
    if (!surf.linkedPlanEdgeId) continue
    const collected: Opening[] = []
    for (const eid of surf.edgeIds) {
      const e = edges[eid]
      if (e?.openings?.length) collected.push(...e.openings)
    }
    if (collected.length) {
      const existing = planEdgeOpenings.get(surf.linkedPlanEdgeId)
      if (existing) existing.push(...collected)
      else planEdgeOpenings.set(surf.linkedPlanEdgeId, collected)
    }
  }

  // Build adjacency map: edgeId → id of the neighbouring zone
  // Only compare edges within the same drawing (same floor)
  const edgeAdjacentZone = new Map<string, string>()
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const za = zones[i]
      const zb = zones[j]
      if (za.drawingId !== zb.drawingId) continue
      for (const eidA of za.edgeIds) {
        for (const eidB of zb.edgeIds) {
          const ea = edges[eidA]
          const eb = edges[eidB]
          if (!ea || !eb) continue
          if (edgeAdjacentZone.has(eidA) && edgeAdjacentZone.has(eidB)) continue
          const [a1, b1] = ea.points
          const [a2, b2] = eb.points
          const fwd = ptClose(a1, a2) && ptClose(b1, b2)
          const rev = ptClose(a1, b2) && ptClose(b1, a2)
          if (fwd || rev) {
            edgeAdjacentZone.set(eidA, zb.id)
            edgeAdjacentZone.set(eidB, za.id)
          }
        }
      }
    }
  }

  // ── Build XML document ─────────────────────────────────────────────────────

  const doc = document.implementation.createDocument('', '', null)
  doc.appendChild(doc.createProcessingInstruction('xml', 'version="1.0" encoding="UTF-8"'))
  const { el, txt, polyLoop } = makeHelpers(doc)

  const root = el('gbXML', {
    xmlns: 'http://www.gbxml.org/schema',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation':
      'http://www.gbxml.org/schema http://www.gbxml.org/schema/6-01/GreenBuildingXML_Ver6.01.xsd',
    version: '0.37',
    useSIUnitsForResults: 'true',
    temperatureUnit: 'C',
    lengthUnit: 'Meters',
    areaUnit: 'SquareMeters',
    volumeUnit: 'CubicMeters',
  })
  doc.appendChild(root)

  const campus  = el('Campus',  { id: 'campus_1' })
  if (project.location) {
    const loc = el('Location')
    const locName = el('Name'); locName.textContent = project.location
    loc.appendChild(locName)
    campus.appendChild(loc)
  }
  const building = el('Building', { id: 'building_1', buildingType: project.buildingType ?? 'MultiFamily' })

  // ── Spaces ─────────────────────────────────────────────────────────────────

  for (const zone of zones) {
    const drawing  = drawingMap.get(zone.drawingId)
    if (!drawing?.scale) continue                    // no scale → can't place in 3D
    const ppm      = drawing.scale.pixelsPerMeter
    const zBase    = drawingZ.get(zone.drawingId) ?? 0
    const h        = drawing.floorHeightMeters
    const zoneType = zoneTypeMap.get(zone.zoneTypeId)

    const space = el('Space', {
      id:            `space_${zone.id}`,
      conditionType: zoneType?.conditionType ?? 'HeatedOnly',
      zoneIdRef:     `zone_${zone.zoneTypeId}`,
    })
    txt(space, 'Name', zone.name)

    const areaEl = el('Area'); areaEl.textContent = String(round2(zone.areaM2))
    const volEl  = el('Volume'); volEl.textContent = String(round2(zone.areaM2 * h))
    space.appendChild(areaEl)
    space.appendChild(volEl)

    // ShellGeometry — closed extruded polygon
    const shell  = el('ShellGeometry', { id: `shell_${zone.id}` })
    const closed = el('ClosedShell')

    const btm = zone.points.map(p => toWorld(p, ppm, zBase))
    const top = zone.points.map(p => toWorld(p, ppm, zBase + h))

    // Floor face — reverse winding so normal points downward (outward for floor)
    closed.appendChild(polyLoop([...btm].reverse()))
    // Ceiling face
    closed.appendChild(polyLoop(top))
    // Wall faces
    for (let i = 0; i < zone.points.length; i++) {
      const p1 = zone.points[i]
      const p2 = zone.points[(i + 1) % zone.points.length]
      closed.appendChild(polyLoop([
        toWorld(p1, ppm, zBase),
        toWorld(p2, ppm, zBase),
        toWorld(p2, ppm, zBase + h),
        toWorld(p1, ppm, zBase + h),
      ]))
    }

    shell.appendChild(closed)
    space.appendChild(shell)
    building.appendChild(space)
  }

  campus.appendChild(building)
  root.appendChild(campus)

  // Zone groups (one per ZoneType)
  const usedZoneTypeIds = new Set(zones.map(z => z.zoneTypeId))
  for (const zt of zoneTypes) {
    if (!usedZoneTypeIds.has(zt.id)) continue
    const zoneEl = el('Zone', { id: `zone_${zt.id}` })
    txt(zoneEl, 'Name', zt.name)
    root.appendChild(zoneEl)
  }

  // ── Vertical adjacency: which zone on floor N+1 is above each zone on floor N?
  // A zone's floor is "handled" when the zone below generated a shared surface.

  const zoneAboveMap  = new Map<string, string>() // lower zoneId → upper zoneId
  const handledFloor  = new Set<string>()          // upper zoneIds whose floor is already covered

  for (let i = 0; i < planDrawings.length - 1; i++) {
    const lowerZones = zones.filter(z => z.drawingId === planDrawings[i].id)
    const upperZones = zones.filter(z => z.drawingId === planDrawings[i + 1].id)
    for (const lower of lowerZones) {
      for (const upper of upperZones) {
        if (bboxOverlap(lower.points, upper.points)) {
          zoneAboveMap.set(lower.id, upper.id)
          handledFloor.add(upper.id)
          break  // one match per lower zone is sufficient
        }
      }
    }
  }

  // ── Wall surfaces (from plan edges) ────────────────────────────────────────

  const processedEdges = new Set<string>()

  for (const zone of zones) {
    const drawing = drawingMap.get(zone.drawingId)
    if (!drawing?.scale) continue
    const ppm    = drawing.scale.pixelsPerMeter
    const zBase  = drawingZ.get(zone.drawingId) ?? 0
    const h      = drawing.floorHeightMeters

    for (const eid of zone.edgeIds) {
      if (processedEdges.has(eid)) continue
      processedEdges.add(eid)

      const edge = edges[eid]
      if (!edge) continue

      const adjZoneId  = edgeAdjacentZone.get(eid)
      const constrType = edge.construction?.type

      // Surface type: adjacency takes priority over construction tag
      let surfType: string
      if (adjZoneId) {
        surfType = 'InteriorWall'
      } else {
        switch (constrType) {
          case 'exterior_wall':    surfType = 'ExteriorWall'; break
          case 'roof_flat':
          case 'roof_pitched':     surfType = 'Roof';          break
          case 'floor_on_ground':  surfType = 'SlabOnGrade';   break
          case 'floor_over_ext':   surfType = 'RaisedFloor';   break
          case 'interior_wall':    surfType = 'InteriorWall';  break
          case 'interior_ceiling': surfType = 'Ceiling';       break
          case 'unheated':         surfType = 'Shade';         break
          default:                 surfType = 'ExteriorWall';  break
        }
      }

      // 3D wall rectangle
      const [p1, p2] = edge.points
      const wallPts: Vec3[] = [
        toWorld(p1, ppm, zBase),
        toWorld(p2, ppm, zBase),
        toWorld(p2, ppm, zBase + h),
        toWorld(p1, ppm, zBase + h),
      ]

      const openings   = planEdgeOpenings.get(eid) ?? []
      const openingSum = round2(openings.reduce((s, o) => s + o.area * o.count, 0))
      const netArea    = round2(Math.max(0, edge.lengthMeters * h - openingSum))

      const surfEl = el('Surface', {
        id:          `surf_${eid}`,
        surfaceType: surfType,
        ...(constrType ? { constructionIdRef: `constr_${constrType}` } : {}),
      })
      txt(surfEl, 'Name', edge.construction?.name ?? 'Stěna')

      // This zone is always adjacent to this surface
      surfEl.appendChild(el('AdjacentSpaceId', { spaceIdRef: `space_${zone.id}` }))
      // Second space if interior wall
      if (adjZoneId) {
        surfEl.appendChild(el('AdjacentSpaceId', { spaceIdRef: `space_${adjZoneId}` }))
      }

      const areaEl = el('Area'); areaEl.textContent = String(netArea)
      surfEl.appendChild(areaEl)

      const pg = el('PlanarGeometry')
      pg.appendChild(polyLoop(wallPts))
      surfEl.appendChild(pg)

      // Openings
      openings.forEach((o, idx) => {
        const openEl = el('Opening', {
          id:          `open_${eid}_${idx}`,
          openingType: o.type === 'window' ? 'FixedWindow' : 'NonSlidingDoor',
          surfaceIdRef: `surf_${eid}`,
        })
        const oa = el('Area'); oa.textContent = String(round2(o.area * o.count))
        openEl.appendChild(oa)
        surfEl.appendChild(openEl)
      })

      root.appendChild(surfEl)
    }

    // ── Floor face ───────────────────────────────────────────────────────────
    // Skip if a zone below already generated a shared InteriorFloor for us.

    const drawing2 = drawingMap.get(zone.drawingId)!
    const ppm2     = drawing2.scale!.pixelsPerMeter
    const zBase2   = drawingZ.get(zone.drawingId) ?? 0
    const floorIdx = planDrawings.findIndex(d => d.id === zone.drawingId)

    if (!handledFloor.has(zone.id)) {
      const isBottom    = floorIdx === 0
      const floorConstr = zone.floorConstruction
      const floorPts    = zone.points.map(p => toWorld(p, ppm2, zBase2))
      const floorSurf   = el('Surface', {
        id:          `floor_${zone.id}`,
        surfaceType: isBottom ? 'SlabOnGrade' : 'InteriorFloor',
        ...(floorConstr ? { constructionIdRef: `constr_${floorConstr.type}` } : {}),
      })
      txt(floorSurf, 'Name', `Podlaha – ${zone.name}`)
      floorSurf.appendChild(el('AdjacentSpaceId', { spaceIdRef: `space_${zone.id}` }))
      const fArea = el('Area'); fArea.textContent = String(round2(zone.areaM2))
      floorSurf.appendChild(fArea)
      const fpg = el('PlanarGeometry')
      fpg.appendChild(polyLoop([...floorPts].reverse()))
      floorSurf.appendChild(fpg)
      root.appendChild(floorSurf)
    }

    // ── Ceiling / Roof face ──────────────────────────────────────────────────
    // If there's a zone directly above: one shared InteriorFloor surface with
    // two AdjacentSpaceId references (replaces both this ceiling and upper floor).
    // If top floor: Roof.  If no match above: Ceiling (orphaned intermediate zone).

    const h2          = drawing2.floorHeightMeters
    const isTop       = floorIdx === planDrawings.length - 1
    const upperZoneId = zoneAboveMap.get(zone.id)
    const ceilPts     = zone.points.map(p => toWorld(p, ppm2, zBase2 + h2))

    const ceilConstr = zone.ceilingConstruction
    const ceilSurf   = el('Surface', {
      id:          `ceil_${zone.id}`,
      surfaceType: upperZoneId ? 'InteriorFloor' : (isTop ? 'Roof' : 'Ceiling'),
      ...(ceilConstr ? { constructionIdRef: `constr_${ceilConstr.type}` } : {}),
    })
    const ceilLabel = upperZoneId
      ? `Strop/Podlaha – ${zone.name}`
      : (isTop ? `Střecha – ${zone.name}` : `Strop – ${zone.name}`)
    txt(ceilSurf, 'Name', ceilLabel)

    // Always reference this zone
    ceilSurf.appendChild(el('AdjacentSpaceId', { spaceIdRef: `space_${zone.id}` }))
    // If shared, also reference the zone above
    if (upperZoneId) {
      ceilSurf.appendChild(el('AdjacentSpaceId', { spaceIdRef: `space_${upperZoneId}` }))
    }

    const cArea = el('Area'); cArea.textContent = String(round2(zone.areaM2))
    ceilSurf.appendChild(cArea)
    const cpg = el('PlanarGeometry')
    cpg.appendChild(polyLoop(ceilPts))
    ceilSurf.appendChild(cpg)
    root.appendChild(ceilSurf)
  }

  // ── Constructions (deduplicated by type) ───────────────────────────────────

  const usedConstr = new Map<string, string>() // type → name
  for (const zone of zones) {
    if (zone.floorConstruction)
      usedConstr.set(zone.floorConstruction.type, zone.floorConstruction.name)
    if (zone.ceilingConstruction)
      usedConstr.set(zone.ceilingConstruction.type, zone.ceilingConstruction.name)
    for (const eid of zone.edgeIds) {
      const edge = edges[eid]
      if (!edge?.construction) continue
      usedConstr.set(edge.construction.type, edge.construction.name)
    }
  }
  for (const [key, name] of usedConstr) {
    const constr = el('Construction', { id: `constr_${key}` })
    txt(constr, 'Name', name)
    root.appendChild(constr)
  }

  // ── Serialize & download ───────────────────────────────────────────────────

  const xml  = new XMLSerializer().serializeToString(doc)
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${name}_gbxml.xml`
  a.click()
  URL.revokeObjectURL(url)
}
