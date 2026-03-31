// PolygonLayer – renders zones (plan) and surfaces (elevation/section) for the active drawing
// Zone fill color is driven by ZoneType. Edge colors: red = incomplete, yellow = warning, green = complete.

import { Line, Circle, Text } from 'react-konva'
import { useProjectStore } from '../../store/projectStore'
import { Zone, Surface, Edge } from '../../types'

const EDGE_COLORS: Record<Edge['status'], string> = {
  incomplete: '#ef4444',  // red-500
  warning:    '#eab308',  // yellow-500
  complete:   '#22c55e',  // green-500
}

const FILL_ALPHA = 0.12

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

interface PolygonShapeProps {
  id: string
  points: Zone['points'] | Surface['points']
  edgeIds: string[]
  label: string
  isSelected: boolean
  fillColor: string
  onEdgeClick: (edgeId: string) => void
  onFillClick?: (id: string) => void
}

function PolygonShape({ id, points, edgeIds, label, isSelected, fillColor, onEdgeClick, onFillClick }: PolygonShapeProps) {
  const { project } = useProjectStore()
  const flatPoints = points.flatMap((p) => [p.x, p.y])

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length

  return (
    <>
      {/* Fill – clickable to select zone/surface polygon */}
      <Line
        points={flatPoints}
        closed
        fill={hexToRgba(isSelected ? '#3b82f6' : fillColor, isSelected ? 0.18 : FILL_ALPHA)}
        stroke={isSelected ? '#3b82f6' : 'transparent'}
        strokeWidth={isSelected ? 1 : 0}
        onClick={onFillClick ? (e) => { e.cancelBubble = true; onFillClick(id) } : undefined}
      />

      {/* Edges with status colors */}
      {edgeIds.map((edgeId) => {
        const edge = project.edges[edgeId]
        if (!edge) return null
        const color = EDGE_COLORS[edge.status]
        return (
          <Line
            key={edgeId}
            points={[edge.points[0].x, edge.points[0].y, edge.points[1].x, edge.points[1].y]}
            stroke={color}
            strokeWidth={3}
            hitStrokeWidth={12}
            onClick={(e) => {
              e.cancelBubble = true
              onEdgeClick(edgeId)
            }}
          />
        )
      })}

      {/* Vertex dots */}
      {points.map((p, idx) => (
        <Circle key={idx} x={p.x} y={p.y} radius={3} fill="#374151" />
      ))}

      {/* Label */}
      <Text
        x={cx - 30}
        y={cy - 8}
        text={label}
        fontSize={11}
        fill="#1f2937"
        width={60}
        align="center"
      />
    </>
  )
}

export default function PolygonLayer() {
  const { project, selectedEdgeId, selectedZoneId, selectedSurfaceId, selectEdge, selectZone, selectSurface } = useProjectStore()
  const { activeDrawingId } = project
  const activeDrawing = project.drawings.find(d => d.id === activeDrawingId)
  const viewType = activeDrawing?.viewType ?? 'plan'

  if (viewType === 'plan') {
    const activeZones = project.zones.filter(z => z.drawingId === activeDrawingId)
    return (
      <>
        {activeZones.map((zone: Zone) => {
          const isSelected = zone.edgeIds.includes(selectedEdgeId ?? '') || selectedZoneId === zone.id
          const zoneType = project.zoneTypes.find(zt => zt.id === zone.zoneTypeId)
          const fillColor = zoneType?.color ?? '#6b7280'
          return (
            <PolygonShape
              key={zone.id}
              id={zone.id}
              points={zone.points}
              edgeIds={zone.edgeIds}
              label={zone.name}
              isSelected={isSelected}
              fillColor={fillColor}
              onEdgeClick={selectEdge}
              onFillClick={selectZone}
            />
          )
        })}
      </>
    )
  }

  // elevation / section
  const activeSurfaces = project.surfaces.filter(s => s.drawingId === activeDrawingId)
  return (
    <>
      {activeSurfaces.map((surface: Surface) => {
        const isSelected = surface.edgeIds.includes(selectedEdgeId ?? '') || selectedSurfaceId === surface.id
        return (
          <PolygonShape
            key={surface.id}
            id={surface.id}
            points={surface.points}
            edgeIds={surface.edgeIds}
            label={surface.name}
            isSelected={isSelected}
            fillColor="#6b7280"
            onEdgeClick={selectEdge}
            onFillClick={selectSurface}
          />
        )
      })}
    </>
  )
}
