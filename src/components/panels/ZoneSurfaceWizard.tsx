// ZoneSurfaceWizard – panel for assigning floor/ceiling construction to zone polygons
// and a direct construction to surface polygons (elevation/section view)

import { useProjectStore } from '../../store/projectStore'
import { useLibraryStore } from '../../store/libraryStore'
import {
  Construction, ConstructionType,
  FLOOR_CONSTRUCTION_PRIORITY, CEILING_CONSTRUCTION_PRIORITY, SURFACE_CONSTRUCTION_PRIORITY,
} from '../../types'

// ── Construction picker sub-component ────────────────────────────────────────

interface LibraryItem {
  type: ConstructionType
  name: string
  thicknessMeters: number
}

function ConstructionPicker({
  label,
  current,
  constructions,
  priority,
  onSelect,
}: {
  label: string
  current: Construction | null
  constructions: LibraryItem[]
  priority: ConstructionType[]
  onSelect: (c: Construction | null) => void
}) {
  const sorted = [...constructions].sort(
    (a, b) => priority.indexOf(a.type) - priority.indexOf(b.type)
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-700">{label}</p>
        {current && (
          <button
            className="text-xs text-gray-400 hover:text-red-500"
            onClick={() => onSelect(null)}
            title="Odebrat"
          >
            ✕
          </button>
        )}
      </div>
      {current && (
        <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 flex items-center gap-1">
          <span>✓</span>
          <span>{current.name}</span>
          {current.thicknessMeters > 0 && (
            <span className="text-green-500 ml-1">· {current.thicknessMeters} m</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        {sorted.map(c => (
          <button
            key={c.type}
            onClick={() => onSelect({ type: c.type, name: c.name, thicknessMeters: c.thicknessMeters })}
            className={`text-left text-xs px-2 py-1 rounded border ${
              current?.type === c.type
                ? 'bg-blue-50 border-blue-400 font-medium'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ZoneSurfaceWizard() {
  const {
    project,
    selectedZoneId, selectedSurfaceId,
    selectZone, selectSurface,
    setZoneFloorConstruction, setZoneCeilingConstruction, setSurfaceConstruction,
  } = useProjectStore()
  const { constructions } = useLibraryStore()

  const zone    = selectedZoneId    ? (project.zones.find(z  => z.id === selectedZoneId)    ?? null) : null
  const surface = selectedSurfaceId ? (project.surfaces.find(s => s.id === selectedSurfaceId) ?? null) : null

  if (!zone && !surface) return null

  // ── Zone selected (floor plan polygon) ──

  if (zone) {
    return (
      <div className="panel flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Zóna: {zone.name}</h3>
          <button
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            onClick={() => selectZone(null)}
          >
            ×
          </button>
        </div>

        <ConstructionPicker
          label={`Podlaha — ${zone.areaM2} m²`}
          current={zone.floorConstruction}
          constructions={constructions}
          priority={FLOOR_CONSTRUCTION_PRIORITY}
          onSelect={(c) => setZoneFloorConstruction(zone.id, c)}
        />

        <div className="border-t border-gray-100" />

        <ConstructionPicker
          label={`Strop — ${zone.areaM2} m²`}
          current={zone.ceilingConstruction}
          constructions={constructions}
          priority={CEILING_CONSTRUCTION_PRIORITY}
          onSelect={(c) => setZoneCeilingConstruction(zone.id, c)}
        />
      </div>
    )
  }

  // ── Surface selected (elevation/section polygon) ──

  if (surface) {
    const drawing = project.drawings.find(d => d.id === surface.drawingId)
    const h = drawing?.floorHeightMeters ?? 3
    const totalEdgeArea = surface.edgeIds.reduce((sum, eid) => {
      const e = project.edges[eid]
      return sum + (e ? e.lengthMeters * h : 0)
    }, 0)

    return (
      <div className="panel flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{surface.name}</h3>
            {drawing && (
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                {drawing.name}
              </span>
            )}
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            onClick={() => selectSurface(null)}
          >
            ×
          </button>
        </div>

        {totalEdgeArea > 0 && (
          <div className="text-xs text-gray-500">
            Plocha obálky: <strong>{Math.round(totalEdgeArea * 100) / 100} m²</strong>
          </div>
        )}

        <ConstructionPicker
          label="Konstrukce plochy"
          current={surface.construction}
          constructions={constructions}
          priority={SURFACE_CONSTRUCTION_PRIORITY}
          onSelect={(c) => setSurfaceConstruction(surface.id, c)}
        />

        <p className="text-xs text-gray-400">
          Tato konstrukce platí pro celou plochu. Hrany plochy mohou mít vlastní typy pro detailní členění.
        </p>
      </div>
    )
  }

  return null
}
