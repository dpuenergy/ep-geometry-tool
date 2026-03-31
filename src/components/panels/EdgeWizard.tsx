// EdgeWizard – panel for assigning construction type to an edge
// Plan edges:             step 1 only (construction type) → auto-complete
// Elevation/section edges: step 1 + step 2 (openings from elevation view)

import { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useLibraryStore } from '../../store/libraryStore'
import {
  Construction, ConstructionType, Opening,
  DrawingViewType, DRAWING_VIEW_LABELS, VIEW_CONSTRUCTION_PRIORITY,
} from '../../types'
import { round2, netWallArea } from '../../utils/geometry'

const STEP_LABELS = ['1. Konstrukce', '2. Výplně']

// Returns drawing floor height + viewType for the selected edge
function useEdgeContext(edgeId: string | null): {
  height: number
  viewType: DrawingViewType
  drawingId: string | null
  isPlanEdge: boolean
} {
  const { project } = useProjectStore()
  if (!edgeId) return { height: 3, viewType: 'plan', drawingId: null, isPlanEdge: false }
  const zone    = project.zones.find(z  => z.edgeIds.includes(edgeId))
  const surface = project.surfaces.find(su => su.edgeIds.includes(edgeId))
  const drawingId = zone?.drawingId ?? surface?.drawingId ?? null
  const drawing = drawingId ? project.drawings.find(d => d.id === drawingId) : null
  return {
    height:      drawing?.floorHeightMeters ?? 3,
    viewType:    drawing?.viewType ?? 'plan',
    drawingId:   drawingId,
    isPlanEdge:  !!zone,
  }
}

interface OpeningFormState {
  type: 'window' | 'door'
  area: string
  count: string
}

const emptyOpeningForm = (): OpeningFormState => ({
  type:  'window',
  area:  '',
  count: '1',
})

export default function EdgeWizard() {
  const {
    project, selectedEdgeId,
    setEdgeConstruction, addOpening, removeOpening, confirmNoOpenings,
    linkEdges, selectEdge,
  } = useProjectStore()
  const { constructions } = useLibraryStore()

  const [step, setStep]               = useState<1 | 2>(1)
  const [selectedType, setSelectedType] = useState<ConstructionType | null>(null)
  const [customThickness, setCustomThickness] = useState<string>('')
  const [openingForm, setOpeningForm]   = useState<OpeningFormState>(emptyOpeningForm())
  const [showOpeningForm, setShowOpeningForm] = useState(false)

  const edgeId = selectedEdgeId
  const edge   = edgeId ? project.edges[edgeId] : null
  const { height: drawingHeight, viewType, isPlanEdge } = useEdgeContext(edgeId)

  if (!edge) {
    return (
      <div className="panel text-xs text-gray-400 italic leading-relaxed">
        Klikněte na <strong className="text-gray-500">hranu</strong> polygonu pro přiřazení konstrukce stěny.
        <br />
        Klikněte <strong className="text-gray-500">dovnitř</strong> polygonu pro přiřazení podlahy a stropu.
      </div>
    )
  }

  const safeEdge = edge

  // Sort constructions by relevance for the view type
  const priority = VIEW_CONSTRUCTION_PRIORITY[viewType]
  const sortedConstructions = [...constructions].sort(
    (a, b) => priority.indexOf(a.type) - priority.indexOf(b.type)
  )

  const grossArea = round2(safeEdge.lengthMeters * drawingHeight)
  const netArea   = round2(netWallArea(safeEdge.lengthMeters, drawingHeight, safeEdge.openings))

  // ── Step 1 handlers ────────────────────────────────────────────────────────

  const libConstruction = constructions.find(c => c.type === selectedType)

  function handleTypeSelect(type: ConstructionType) {
    setSelectedType(type)
    setCustomThickness('') // reset override when type changes
  }

  function handleStep1Confirm() {
    if (!selectedType) return
    const name = libConstruction?.name ?? selectedType
    const defaultThickness = libConstruction?.thicknessMeters ?? 0
    const thicknessMeters  = customThickness !== '' ? parseFloat(customThickness) : defaultThickness
    const construction: Construction = {
      type: selectedType,
      name,
      thicknessMeters: isNaN(thicknessMeters) ? defaultThickness : thicknessMeters,
    }
    setEdgeConstruction(safeEdge.id, construction)
    if (isPlanEdge) {
      // Plan edge: done after step 1
      selectEdge(null)
      setStep(1)
      setSelectedType(null)
    } else {
      setStep(2)
    }
  }

  // ── Step 2 handlers ────────────────────────────────────────────────────────

  function handleAddOpening() {
    const area  = parseFloat(openingForm.area)
    const count = parseInt(openingForm.count, 10)
    if (isNaN(area) || isNaN(count) || area <= 0 || count < 1) return
    const opening: Omit<Opening, 'id'> = { type: openingForm.type, area, count }
    addOpening(safeEdge.id, opening)
    setOpeningForm(emptyOpeningForm())
    setShowOpeningForm(false)
  }

  function handleConfirmNoOpenings() {
    confirmNoOpenings(safeEdge.id)
    selectEdge(null)
    setStep(1)
    setSelectedType(null)
    setCustomThickness('')
  }

  function handleConfirmWithOpenings() {
    confirmNoOpenings(safeEdge.id)
    selectEdge(null)
    setStep(1)
    setSelectedType(null)
    setCustomThickness('')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="panel flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Hrana: {safeEdge.id.slice(0, 8)}</h3>
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            {DRAWING_VIEW_LABELS[viewType]}
          </span>
          {isPlanEdge && (
            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Půdorys</span>
          )}
        </div>
        <button
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          onClick={() => selectEdge(null)}
        >
          ×
        </button>
      </div>

      {/* Edge info */}
      <div className="text-xs text-gray-500 space-y-0.5">
        <div>Délka: <strong>{edge.lengthMeters} m</strong></div>
        {edge.construction && (
          <div>
            Konstrukce: <strong>{edge.construction.name}</strong>
            {edge.construction.thicknessMeters > 0 && (
              <span className="text-gray-400 ml-1">· tl. {edge.construction.thicknessMeters} m</span>
            )}
          </div>
        )}
        {!isPlanEdge && (
          <>
            <div>Hrubá plocha: <strong>{grossArea} m²</strong></div>
            <div>Čistá plocha: <strong>{netArea} m²</strong></div>
          </>
        )}
        <div>
          Stav:{' '}
          <span className={
            edge.status === 'complete' ? 'text-green-600' :
            edge.status === 'warning'  ? 'text-yellow-600' : 'text-red-500'
          }>
            {edge.status === 'complete' ? '✓ Hotovo'
              : edge.status === 'warning' ? '⚠ Čekají výplně'
              : '✗ Bez konstrukce'}
          </span>
        </div>
      </div>

      {/* Step tabs – only shown for elevation/section edges */}
      {!isPlanEdge && (
        <div className="flex gap-1">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => setStep((i + 1) as 1 | 2)}
              className={`flex-1 text-xs py-1 rounded border ${
                step === i + 1
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-500 border-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── STEP 1 ── */}
      {(step === 1 || isPlanEdge) && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-600">Vyberte typ konstrukce:</p>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {sortedConstructions.map((c) => (
              <button
                key={c.type}
                onClick={() => handleTypeSelect(c.type)}
                className={`text-left text-xs px-2 py-1.5 rounded border ${
                  selectedType === c.type
                    ? 'bg-blue-50 border-blue-400 font-medium'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Thickness input – shown when a type is selected */}
          {selectedType && (
            <div className="flex items-center gap-2 mt-1 border-t border-gray-100 pt-2">
              <label className="text-xs text-gray-600 whitespace-nowrap">Tloušťka stěny:</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-20 text-xs"
                placeholder={String(libConstruction?.thicknessMeters ?? 0)}
                value={customThickness}
                onChange={e => setCustomThickness(e.target.value)}
              />
              <span className="text-xs text-gray-400">m</span>
              {customThickness === '' && libConstruction && (
                <span className="text-xs text-gray-400">
                  (výchozí: {libConstruction.thicknessMeters} m)
                </span>
              )}
            </div>
          )}

          <button
            className="btn-primary mt-1"
            disabled={!selectedType}
            onClick={handleStep1Confirm}
          >
            {isPlanEdge ? '✓ Potvrdit' : 'Dále →'}
          </button>

          {isPlanEdge && (
            <p className="text-xs text-gray-400 mt-1">
              Výplně se zadávají z pohledu/řezu, ne z půdorysu.
            </p>
          )}

          {/* Cross-view pairing – only for elevation/section edges */}
          {!isPlanEdge && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <p className="text-xs text-gray-500 mb-1">Spárovat s hranou v půdorysu:</p>
              <select
                className="input w-full text-xs"
                value={safeEdge.linkedEdgeId ?? ''}
                onChange={e => linkEdges(safeEdge.id, e.target.value || null)}
              >
                <option value="">— nepárovat —</option>
                {project.zones
                  .filter(z => {
                    const d = project.drawings.find(d => d.id === z.drawingId)
                    return d?.viewType === 'plan'
                  })
                  .flatMap(z =>
                    z.edgeIds.map(eid => {
                      const e = project.edges[eid]
                      if (!e) return null
                      return (
                        <option key={eid} value={eid}>
                          {z.name} – {e.construction?.name ?? 'bez konstrukce'} ({e.lengthMeters} m)
                        </option>
                      )
                    }).filter(Boolean)
                  )
                }
              </select>
              {safeEdge.linkedEdgeId && (
                <p className="text-xs text-blue-600 mt-1">
                  🔗 Spárováno: {project.edges[safeEdge.linkedEdgeId]?.construction?.name ?? 'stěna bez názvu'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2 – only for elevation/section edges ── */}
      {step === 2 && !isPlanEdge && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-600">Obsahuje tato plocha okna nebo dveře?</p>

          {/* Existing openings */}
          {edge.openings.length > 0 && (
            <div className="flex flex-col gap-1">
              {edge.openings.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between text-xs bg-gray-50 px-2 py-1 rounded"
                >
                  <span>
                    {o.count}× {o.type === 'window' ? 'okno' : 'dveře'} {o.area} m²
                    <span className="text-gray-400 ml-1">
                      (celkem {round2(o.area * o.count)} m²)
                    </span>
                  </span>
                  <button
                    className="text-red-400 hover:text-red-600"
                    onClick={() => removeOpening(edge.id, o.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add opening form */}
          {showOpeningForm ? (
            <div className="border border-gray-200 rounded p-2 flex flex-col gap-1.5">
              <div className="flex gap-2">
                <label className="text-xs text-gray-600 w-16">Typ:</label>
                <select
                  className="input flex-1 text-xs"
                  value={openingForm.type}
                  onChange={(e) =>
                    setOpeningForm((f) => ({ ...f, type: e.target.value as 'window' | 'door' }))
                  }
                >
                  <option value="window">Okno</option>
                  <option value="door">Dveře</option>
                </select>
              </div>
              <div className="flex gap-2">
                <label className="text-xs text-gray-600 w-16">Plocha (m²):</label>
                <input
                  type="number" step="0.01" min="0" className="input flex-1"
                  value={openingForm.area}
                  onChange={(e) => setOpeningForm((f) => ({ ...f, area: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <label className="text-xs text-gray-600 w-16">Počet:</label>
                <input
                  type="number" step="1" min="1" className="input flex-1"
                  value={openingForm.count}
                  onChange={(e) => setOpeningForm((f) => ({ ...f, count: e.target.value }))}
                />
              </div>
              <div className="flex gap-1">
                <button className="btn-primary flex-1 text-xs" onClick={handleAddOpening}>
                  Přidat
                </button>
                <button
                  className="btn-secondary flex-1 text-xs"
                  onClick={() => setShowOpeningForm(false)}
                >
                  Zrušit
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-secondary text-xs"
              onClick={() => setShowOpeningForm(true)}
            >
              + Přidat okna / dveře
            </button>
          )}

          <div className="flex gap-1 mt-1">
            <button
              className="btn-primary flex-1 text-xs"
              onClick={handleConfirmWithOpenings}
              disabled={edge.openings.length === 0}
            >
              ✓ Potvrdit s výplněmi
            </button>
            <button
              className="btn-secondary flex-1 text-xs"
              onClick={handleConfirmNoOpenings}
            >
              Žádné výplně
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
