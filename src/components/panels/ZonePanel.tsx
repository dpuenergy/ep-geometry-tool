// ZonePanel – global zone type management + per-drawing breakdown + surfaces

import { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { ConditionType, ZoneType, BUILDING_TYPES } from '../../types'
import { round2, zoneInteriorAreaM2 } from '../../utils/geometry'

const CONDITION_LABELS: Record<ConditionType, string> = {
  HeatedOnly:      'Vytápěná',
  HeatedAndCooled: 'Vytápěná + chlazená',
  Unheated:        'Nevytápěná',
  Unconditioned:   'Nekondicionovaná',
}

const ZONE_TYPE_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280',
]

export default function ZonePanel() {
  const {
    project, metrics,
    setProjectMeta,
    addZoneType, removeZoneType,
    setDrawingFloorHeight,
    reorderDrawing,
    duplicateDrawing,
    deleteZone, deleteSurface,
    replicateZone,
    linkSurfaceToPlanEdge,
  } = useProjectStore()

  const { zones, surfaces, edges, drawings, zoneTypes } = project
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeCondition, setNewTypeCondition] = useState<ConditionType>('HeatedOnly')

  // Plan drawings only (for zone display), with cumulative Z offsets
  const planDrawings = drawings.filter(d => d.viewType === 'plan')
  const planDrawingZ: Record<string, { zBase: number; zTop: number }> = {}
  let cumZ = 0
  for (const d of planDrawings) {
    planDrawingZ[d.id] = { zBase: cumZ, zTop: round2(cumZ + d.floorHeightMeters) }
    cumZ = round2(cumZ + d.floorHeightMeters)
  }

  // Plan edges available for linking to elevation surfaces
  const planEdgeOptions = planDrawings.flatMap(d => {
    const dZones = zones.filter(z => z.drawingId === d.id)
    const eids   = [...new Set(dZones.flatMap(z => z.edgeIds))]
    return eids
      .map(eid => ({ eid, edge: edges[eid], drawingName: d.name }))
      .filter(x => x.edge)
  })

  // Active drawing for surface display
  const activeDrawing = drawings.find(d => d.id === project.activeDrawingId)
  const isElevOrSection = activeDrawing && activeDrawing.viewType !== 'plan'
  const activeSurfaces = surfaces.filter(s => s.drawingId === project.activeDrawingId)

  // Aggregate area per zone type
  // AP contribution: raw polygon area (gross)
  function zoneTypeRawArea(ztId: string) {
    return round2(zones.filter(z => z.zoneTypeId === ztId).reduce((s, z) => s + z.areaM2, 0))
  }
  // AEP contribution: net interior area (after wall correction)
  function zoneTypeInteriorArea(ztId: string) {
    return round2(zones.filter(z => z.zoneTypeId === ztId).reduce((s, z) => s + zoneInteriorAreaM2(z, edges), 0))
  }
  function zoneTypeVolume(ztId: string) {
    return round2(
      zones
        .filter(z => z.zoneTypeId === ztId)
        .reduce((s, z) => {
          const h = drawings.find(d => d.id === z.drawingId)?.floorHeightMeters ?? 3
          return s + zoneInteriorAreaM2(z, edges) * h
        }, 0)
    )
  }

  function handleAddZoneType() {
    if (!newTypeName.trim()) return
    const nextColor = ZONE_TYPE_COLORS[zoneTypes.length % ZONE_TYPE_COLORS.length]
    addZoneType({ name: newTypeName.trim(), conditionType: newTypeCondition, color: nextColor })
    setNewTypeName('')
    setAddingType(false)
  }

  return (
    <div className="panel flex flex-col gap-3">

      {/* ── Project metadata ── */}
      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold text-sm">Projekt</h3>
        <input
          className="input text-xs"
          placeholder="Název projektu"
          value={project.name}
          onChange={e => setProjectMeta({ name: e.target.value })}
        />
        <input
          className="input text-xs"
          placeholder="Lokalita (město, adresa)"
          value={project.location}
          onChange={e => setProjectMeta({ location: e.target.value })}
        />
        <select
          className="input text-xs"
          value={project.buildingType}
          onChange={e => setProjectMeta({ buildingType: e.target.value })}
        >
          {Object.entries(BUILDING_TYPES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* ── Zone types summary ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Typy zón</h3>
          <button
            className="text-xs text-blue-600 hover:text-blue-800"
            onClick={() => setAddingType(v => !v)}
          >
            {addingType ? 'Zrušit' : '+ Přidat typ'}
          </button>
        </div>

        {addingType && (
          <div className="border border-gray-200 rounded p-2 flex flex-col gap-1.5 mb-2">
            <input
              className="input text-xs"
              placeholder="Název zóny (např. Vytápěná)"
              value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddZoneType()}
            />
            <select
              className="input text-xs"
              value={newTypeCondition}
              onChange={e => setNewTypeCondition(e.target.value as ConditionType)}
            >
              {(Object.keys(CONDITION_LABELS) as ConditionType[]).map(ct => (
                <option key={ct} value={ct}>{CONDITION_LABELS[ct]}</option>
              ))}
            </select>
            <button className="btn-primary text-xs" onClick={handleAddZoneType}>
              Přidat
            </button>
          </div>
        )}

        {zoneTypes.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Žádné typy zón.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {zoneTypes.map((zt: ZoneType) => {
              const rawArea      = zoneTypeRawArea(zt.id)
              const interiorArea = zoneTypeInteriorArea(zt.id)
              const volume       = zoneTypeVolume(zt.id)
              const inUse        = zones.some(z => z.zoneTypeId === zt.id)
              return (
                <div key={zt.id} className="flex flex-col gap-0.5 py-1 border-b border-gray-50">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: zt.color }}
                    />
                    <span className="font-medium flex-1">{zt.name}</span>
                    <span className="text-gray-300 tabular-nums" title="Hrubá plocha polygonu (AP)">{rawArea} m²</span>
                    <span className="text-gray-500 tabular-nums font-medium" title="Vnitřní plocha po korekci (AEP)">{interiorArea} m²</span>
                    <span className="text-gray-400 tabular-nums">{volume} m³</span>
                  {!inUse && (
                    <button
                      className="text-red-400 hover:text-red-600 ml-1"
                      title="Smazat typ zóny"
                      onClick={() => removeZoneType(zt.id)}
                    >
                      ✕
                    </button>
                  )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary metrics */}
        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
          <div className="bg-gray-50 rounded px-2 py-1 text-center" title="Hrubá plocha polygonů všech zón">
            <div className="text-gray-400">AP</div>
            <div className="font-bold">{metrics.floorAreaM2} m²</div>
          </div>
          <div className="bg-gray-50 rounded px-2 py-1 text-center" title="Čistá vnitřní plocha vytápěných/klimatizovaných zón">
            <div className="text-gray-400">AEP</div>
            <div className="font-bold">{metrics.energyRelatedAreaM2} m²</div>
          </div>
          <div className="bg-gray-50 rounded px-2 py-1 text-center" title="Vnitřní objem vytápěných zón">
            <div className="text-gray-400">V</div>
            <div className="font-bold">{metrics.volumeM3} m³</div>
          </div>
        </div>
      </div>

      {/* ── Per-plan-drawing breakdown ── */}
      {planDrawings.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">Půdorysy</h3>
          {planDrawings.map((drawing, idx) => {
            const drawingZones = zones.filter(z => z.drawingId === drawing.id)
            return (
              <div key={drawing.id} className="border border-gray-200 rounded p-2 mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col gap-0">
                      <button
                        className="text-gray-300 hover:text-gray-600 leading-none disabled:opacity-20"
                        title="Posunout výše (nižší Z)"
                        disabled={idx === 0}
                        onClick={() => reorderDrawing(drawing.id, 'up')}
                      >▲</button>
                      <button
                        className="text-gray-300 hover:text-gray-600 leading-none disabled:opacity-20"
                        title="Posunout níže (vyšší Z)"
                        disabled={idx === planDrawings.length - 1}
                        onClick={() => reorderDrawing(drawing.id, 'down')}
                      >▼</button>
                    </div>
                    <span className="font-medium text-xs">{drawing.name}</span>
                    {planDrawingZ[drawing.id] && (
                      <span className="text-xs text-gray-400 tabular-nums">
                        Z {planDrawingZ[drawing.id].zBase}–{planDrawingZ[drawing.id].zTop} m
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500">výška:</label>
                    <input
                      type="number" min="0.5" max="20" step="0.1"
                      className="input w-16 text-xs text-center"
                      value={drawing.floorHeightMeters}
                      onChange={e => {
                        const v = parseFloat(e.target.value)
                        if (!isNaN(v) && v > 0) setDrawingFloorHeight(drawing.id, v)
                      }}
                    />
                    <span className="text-xs text-gray-400">m</span>
                    {/* Duplicate entire floor as a new drawing */}
                    <button
                      className="input text-xs py-0 px-1.5"
                      title="Duplikovat podlaží jako nový výkres (zkopíruje zóny i konstrukce)"
                      onClick={() => duplicateDrawing(drawing.id)}
                    >
                      ⧉ Duplikovat
                    </button>
                  </div>
                </div>

                {drawingZones.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Žádné zóny.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {drawingZones.map(zone => {
                      const zt = zoneTypes.find(t => t.id === zone.zoneTypeId)
                      const edgeStatuses = zone.edgeIds.map(id => edges[id]?.status)
                      const allComplete  = edgeStatuses.every(s => s === 'complete')
                      const anyComplete  = edgeStatuses.some(s => s === 'complete')
                      const otherPlanDrawings = planDrawings.filter(d => d.id !== drawing.id)
                      const missingFloor   = !zone.floorConstruction
                      const missingCeiling = !zone.ceilingConstruction
                      const missingConstr  = missingFloor || missingCeiling
                      const missingTitle   = [
                        missingFloor   ? 'chybí podlaha' : '',
                        missingCeiling ? 'chybí strop'   : '',
                      ].filter(Boolean).join(', ')
                      return (
                        <div key={zone.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: zt?.color ?? '#6b7280' }}
                          />
                          <span className="flex-1 truncate" title={zone.name}>{zone.name}</span>
                          {missingConstr && (
                            <span title={missingTitle} className="text-orange-400 shrink-0">⚠</span>
                          )}
                          <span
                            className="text-gray-400 tabular-nums"
                            title={`Polygon: ${round2(zone.areaM2)} m²`}
                          >
                            {zoneInteriorAreaM2(zone, edges)} m²
                          </span>
                          <span className={`tabular-nums ${allComplete ? 'text-green-600' : 'text-gray-400'}`}>
                            {edgeStatuses.filter(s => s === 'complete').length}/{edgeStatuses.length}
                            {allComplete && ' ✓'}
                          </span>

                          {/* Replicate button */}
                          {otherPlanDrawings.length > 0 && (
                            <select
                              className="input text-xs py-0 px-1 w-20"
                              defaultValue=""
                              title="Kopírovat zónu na jiný výkres"
                              onChange={e => {
                                if (e.target.value) {
                                  replicateZone(zone.id, e.target.value)
                                  e.target.value = ''
                                }
                              }}
                            >
                              <option value="">→ kopie</option>
                              {otherPlanDrawings.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          )}

                          <button
                            className="text-red-400 hover:text-red-600"
                            title="Smazat zónu"
                            onClick={() => {
                              if (anyComplete) {
                                if (!confirm(`Zóna „${zone.name}" má dokončené hrany. Smazat?`)) return
                                deleteZone(zone.id, true)
                              } else {
                                deleteZone(zone.id)
                              }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Surfaces (active elevation/section drawing) ── */}
      {isElevOrSection && (
        <div>
          <h3 className="font-semibold text-sm mb-2">
            Plochy – {activeDrawing?.name}
          </h3>
          {activeSurfaces.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Žádné plochy. Nakreslete polygon na canvasu.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activeSurfaces.map(surface => {
                const edgeStatuses = surface.edgeIds.map(id => edges[id]?.status)
                const allComplete  = edgeStatuses.every(s => s === 'complete')
                const linkedEdge   = surface.linkedPlanEdgeId ? edges[surface.linkedPlanEdgeId] : null
                return (
                  <div key={surface.id} className="border border-gray-200 rounded p-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs">{surface.name}</span>
                      <button
                        className="text-xs text-red-400 hover:text-red-600"
                        onClick={() => deleteSurface(surface.id)}
                      >
                        Smazat
                      </button>
                    </div>
                    {/* Link to plan edge — determines which wall gets openings in gbXML */}
                    <select
                      className="input text-xs"
                      value={surface.linkedPlanEdgeId ?? ''}
                      onChange={e => linkSurfaceToPlanEdge(surface.id, e.target.value || null)}
                    >
                      <option value="">— Nepropojeno s půdorysem —</option>
                      {planEdgeOptions.map(({ eid, edge, drawingName }) => (
                        <option key={eid} value={eid}>
                          {drawingName}: {edge.construction?.name ?? 'bez konstrukce'} ({edge.lengthMeters} m)
                        </option>
                      ))}
                    </select>
                    {linkedEdge && (
                      <div className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                        Výplně se exportují na: {linkedEdge.construction?.name ?? 'nepřiřazená stěna'}
                      </div>
                    )}
                    <div className="text-xs text-gray-400">
                      Hrany: {edgeStatuses.filter(s => s === 'complete').length}/{edgeStatuses.length} dokončeno
                      {allComplete && <span className="text-green-600 ml-1">✓</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
