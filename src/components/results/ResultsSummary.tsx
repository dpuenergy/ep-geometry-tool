// ResultsSummary – project metrics and per-construction area table

import { useProjectStore } from '../../store/projectStore'
import { round2, netWallArea, zoneInteriorAreaM2 } from '../../utils/geometry'

export default function ResultsSummary() {
  const { project, metrics } = useProjectStore()
  const { zones, surfaces, edges, drawings, zoneTypes } = project

  // ── Per-zone-type area & volume ────────────────────────────────────────────
  const drawingMap = new Map(drawings.map(d => [d.id, d]))

  const zoneTypeRows = zoneTypes.map(zt => {
    const typeZones = zones.filter(z => z.zoneTypeId === zt.id)
    const area = round2(typeZones.reduce((s, z) => s + zoneInteriorAreaM2(z, edges), 0))
    const polygonArea = round2(typeZones.reduce((s, z) => s + z.areaM2, 0))
    const volume = round2(
      typeZones.reduce((s, z) => {
        const h = drawingMap.get(z.drawingId)?.floorHeightMeters ?? 3
        return s + zoneInteriorAreaM2(z, edges) * h
      }, 0)
    )
    return { zt, area, polygonArea, volume, count: typeZones.length }
  }).filter(r => r.count > 0)

  // ── Construction areas – from elevation/section surfaces ───────────────────
  interface ConstructionRow { name: string; type: string; netAreaM2: number; openingAreaM2: number }
  const constrMap = new Map<string, ConstructionRow>()

  for (const surface of surfaces) {
    const drawing = drawingMap.get(surface.drawingId)
    const height  = drawing?.floorHeightMeters ?? 3
    for (const edgeId of surface.edgeIds) {
      const edge = edges[edgeId]
      if (!edge?.construction) continue
      const key = edge.construction.type
      const net = round2(netWallArea(edge.lengthMeters, height, edge.openings))
      const openingArea = round2(edge.openings.reduce((s, o) => s + o.area * o.count, 0))
      const existing = constrMap.get(key)
      if (existing) {
        existing.netAreaM2     = round2(existing.netAreaM2 + net)
        existing.openingAreaM2 = round2(existing.openingAreaM2 + openingArea)
      } else {
        constrMap.set(key, {
          name: edge.construction.name,
          type: edge.construction.type,
          netAreaM2: round2(net),
          openingAreaM2: round2(openingArea),
        })
      }
    }
  }
  const constrRows = Array.from(constrMap.values())

  return (
    <div className="panel flex flex-col gap-3">
      <h3 className="font-semibold text-sm">Výsledky</h3>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2">
        <MetricCard
          label="AP"
          sublabel="Hrubá plocha (polygon)"
          value={metrics.floorAreaM2}
          unit="m²"
          tooltip="Součet ploch polygonů všech zón (bez korekce tloušťky stěn)"
        />
        <MetricCard
          label="AEP"
          sublabel="Čistá vnitřní (vytápěná)"
          value={metrics.energyRelatedAreaM2}
          unit="m²"
          tooltip="Čistá vnitřní plocha vytápěných/klimatizovaných zón po odečtení tloušťky stěn"
        />
        <MetricCard
          label="V"
          sublabel="Objem (vytápěný)"
          value={metrics.volumeM3}
          unit="m³"
          tooltip="Vnitřní objem vytápěných zón = AEP × výška podlaží"
        />
      </div>

      {/* Export readiness */}
      <div className={`text-xs px-2 py-1 rounded ${
        metrics.allEdgesComplete
          ? 'bg-green-50 text-green-700'
          : 'bg-yellow-50 text-yellow-700'
      }`}>
        {metrics.allEdgesComplete
          ? '✓ Všechny hrany dokončeny – export je možný'
          : '⚠ Některé hrany nejsou dokončeny'}
      </div>

      {/* Per zone-type breakdown */}
      {zoneTypeRows.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-gray-600 mt-1">Plochy zón (vnitřní)</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1 font-medium">Typ zóny</th>
                <th className="text-right py-1 font-medium" title="Vnitřní plocha po odečtení tloušťky stěn">Vnitřní (m²)</th>
                <th className="text-right py-1 font-medium" title="Plocha polygonu (hrubá)">Polygon (m²)</th>
                <th className="text-right py-1 font-medium">V (m³)</th>
              </tr>
            </thead>
            <tbody>
              {zoneTypeRows.map(({ zt, area, polygonArea, volume }) => (
                <tr key={zt.id} className="border-b border-gray-50">
                  <td className="py-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: zt.color }}
                      />
                      {zt.name}
                    </span>
                  </td>
                  <td className="py-1 text-right font-medium">{area.toFixed(2)}</td>
                  <td className="py-1 text-right text-gray-400">{polygonArea.toFixed(2)}</td>
                  <td className="py-1 text-right">{volume.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400">AP a AEP = vnitřní plocha (polygon − korekce tloušťky stěn)</p>
        </>
      )}

      {/* Construction table – from elevation surfaces */}
      {constrRows.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-gray-600 mt-1">Tabulka konstrukcí (z pohledů)</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1 font-medium">Konstrukce</th>
                <th className="text-right py-1 font-medium">Stěna (m²)</th>
                <th className="text-right py-1 font-medium">Výplně (m²)</th>
              </tr>
            </thead>
            <tbody>
              {constrRows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right">{r.netAreaM2.toFixed(2)}</td>
                  <td className="py-1 text-right text-gray-500">
                    {r.openingAreaM2 > 0 ? r.openingAreaM2.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {zones.length === 0 && surfaces.length === 0 && (
        <p className="text-xs text-gray-400 italic">Žádné zóny ani plochy. Začněte kreslením.</p>
      )}
    </div>
  )
}

function MetricCard({
  label, sublabel, value, unit, tooltip,
}: {
  label: string; sublabel: string; value: number; unit: string; tooltip?: string
}) {
  return (
    <div className="bg-gray-50 rounded p-2" title={tooltip}>
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="text-xs text-gray-400 leading-tight mb-0.5">{sublabel}</div>
      <div className="text-base font-bold text-gray-800 tabular-nums">
        {value.toFixed(2)}
      </div>
      <div className="text-xs text-gray-400">{unit}</div>
    </div>
  )
}
