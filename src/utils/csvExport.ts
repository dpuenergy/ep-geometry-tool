// CSV export utility

import { Project } from '../types'
import { round2, netWallArea } from './geometry'

function escapeCsv(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Export construction areas per surface edge (elevation/section views) */
export function exportCsv(project: Project): void {
  const drawingMap = new Map(project.drawings.map(d => [d.id, d]))

  const header = [
    'Výkres', 'Plocha', 'ID hrany', 'Typ konstrukce', 'Název konstrukce',
    'Délka (m)', 'Výška (m)', 'Hrubá plocha (m²)', 'Čistá plocha (m²)', 'Výplně (m²)',
  ]

  const rows: string[][] = []

  for (const surface of project.surfaces) {
    const drawing = drawingMap.get(surface.drawingId)
    const height  = drawing?.floorHeightMeters ?? 3
    for (const edgeId of surface.edgeIds) {
      const edge = project.edges[edgeId]
      if (!edge) continue
      const gross       = round2(edge.lengthMeters * height)
      const net         = round2(netWallArea(edge.lengthMeters, height, edge.openings))
      const openingArea = round2(edge.openings.reduce((s, o) => s + o.area * o.count, 0))
      rows.push([
        drawing?.name ?? '',
        surface.name,
        edge.id,
        edge.construction?.type ?? '',
        edge.construction?.name ?? '',
        String(round2(edge.lengthMeters)),
        String(height),
        String(gross),
        String(net),
        String(openingArea),
      ])
    }
  }

  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map(r => r.map(escapeCsv).join(',')),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${project.name.replace(/[^a-z0-9_\-.\s]/gi, '_')}_konstrukce.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Export zone areas per floor and zone type */
export function exportZonesCsv(project: Project): void {
  const drawingMap  = new Map(project.drawings.map(d => [d.id, d]))
  const zoneTypeMap = new Map(project.zoneTypes.map(zt => [zt.id, zt]))

  const header = [
    'Výkres', 'Zóna', 'Typ zóny', 'Kondice',
    'Plocha (m²)', 'Výška podlaží (m)', 'Objem (m³)',
    'Podlaha – typ', 'Podlaha – název',
    'Strop – typ',   'Strop – název',
  ]

  const lines = [
    header.map(escapeCsv).join(','),
    ...project.zones.map(z => {
      const drawing  = drawingMap.get(z.drawingId)
      const zoneType = zoneTypeMap.get(z.zoneTypeId)
      const h        = drawing?.floorHeightMeters ?? 3
      return [
        drawing?.name ?? '',
        z.name,
        zoneType?.name ?? '',
        zoneType?.conditionType ?? '',
        round2(z.areaM2),
        h,
        round2(z.areaM2 * h),
        z.floorConstruction?.type   ?? '',
        z.floorConstruction?.name   ?? '',
        z.ceilingConstruction?.type ?? '',
        z.ceilingConstruction?.name ?? '',
      ].map(escapeCsv).join(',')
    }),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${project.name.replace(/[^a-z0-9_\-.\s]/gi, '_')}_zony.csv`
  a.click()
  URL.revokeObjectURL(url)
}
