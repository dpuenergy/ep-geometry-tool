// EdgeHighlight – renders a highlighted overlay on the selected edge
// Shown on top of PolygonLayer inside the same Stage

import { Line, Circle } from 'react-konva'
import { useProjectStore } from '../../store/projectStore'

export default function EdgeHighlight() {
  const { project, selectedEdgeId } = useProjectStore()
  if (!selectedEdgeId) return null

  const edge = project.edges[selectedEdgeId]
  if (!edge) return null

  return (
    <>
      <Line
        points={[
          edge.points[0].x, edge.points[0].y,
          edge.points[1].x, edge.points[1].y,
        ]}
        stroke="#2563eb"
        strokeWidth={4}
        dash={[8, 4]}
      />
      <Circle x={edge.points[0].x} y={edge.points[0].y} radius={6} fill="#2563eb" />
      <Circle x={edge.points[1].x} y={edge.points[1].y} radius={6} fill="#2563eb" />
    </>
  )
}
