// Geometry utilities: area, volume, scale conversion

import { Point, Scale, Opening, Zone, Edge } from '../types'

/**
 * Shoelace formula for polygon area in canvas pixels².
 * Returns absolute value (sign depends on winding order).
 */
export function polygonAreaPx(points: Point[]): number {
  const n = points.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Convert pixel² area to m² using scale (pixels per meter).
 */
export function pxAreaToM2(areaPx2: number, scale: Scale): number {
  return areaPx2 / (scale.pixelsPerMeter ** 2)
}

/**
 * Calculate pixels per meter from two canvas points and real distance.
 */
export function calcPixelsPerMeter(pointA: Point, pointB: Point, realMeters: number): number {
  const dx = pointB.x - pointA.x
  const dy = pointB.y - pointA.y
  const distancePx = Math.sqrt(dx * dx + dy * dy)
  return distancePx / realMeters
}

/**
 * Euclidean distance between two canvas points in pixels.
 */
export function distancePx(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

/**
 * Convert pixel distance to meters using scale.
 */
export function pxToMeters(px: number, scale: Scale): number {
  return px / scale.pixelsPerMeter
}

/**
 * Gross wall area = edge length × floor height.
 */
export function grossWallArea(lengthMeters: number, heightMeters: number): number {
  return lengthMeters * heightMeters
}

/**
 * Net wall area = gross area − sum of opening areas.
 */
export function netWallArea(
  lengthMeters: number,
  heightMeters: number,
  openings: Opening[]
): number {
  const gross = grossWallArea(lengthMeters, heightMeters)
  const openingsTotal = openings.reduce((sum, o) => sum + o.area * o.count, 0)
  return Math.max(0, gross - openingsTotal)
}

/**
 * Round to 2 decimal places (required precision for all area outputs).
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Interior floor area of a zone after subtracting wall thickness corrections.
 *
 * Correction = Σ (edge.construction.thicknessMeters × edge.lengthMeters)
 *
 * Assumption: the polygon was traced to the EXTERIOR face of walls.
 * For interior-face tracing set all thicknesses to 0.
 * Note: shared interior walls are counted twice (once per adjacent zone),
 * which is a conservative approximation; set interior wall thickness to half
 * the actual value to compensate if needed.
 */
export function zoneInteriorAreaM2(zone: Zone, edges: Record<string, Edge>): number {
  const correction = zone.edgeIds.reduce((s, eid) => {
    const e = edges[eid]
    if (!e?.construction) return s
    return s + (e.construction.thicknessMeters ?? 0) * e.lengthMeters
  }, 0)
  return round2(Math.max(0, zone.areaM2 - correction))
}
