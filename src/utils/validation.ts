// Project export validation
// Returns arrays of blocking errors and non-blocking warnings.

import { Project } from '../types'

export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { zones, surfaces, edges, drawings } = project

  const planDrawings = drawings.filter(d => d.viewType === 'plan')

  // ── Blocking errors ─────────────────────────────────────────────────────────

  if (zones.length === 0) {
    issues.push({ level: 'error', message: 'Projekt neobsahuje žádné zóny. Nakreslete alespoň jednu zónu v půdorysu.' })
  }

  const planDrawingsWithScale = planDrawings.filter(d => d.scale !== null)
  if (planDrawings.length > 0 && planDrawingsWithScale.length === 0) {
    issues.push({ level: 'error', message: 'Žádný půdorys nemá nastavené měřítko. Bez měřítka nelze generovat 3D souřadnice.' })
  }

  // ── Warnings ─────────────────────────────────────────────────────────────────

  // Plan drawings without scale (some zones will be skipped in gbXML)
  const noScaleDrawings = planDrawings.filter(d => d.scale === null && zones.some(z => z.drawingId === d.id))
  if (noScaleDrawings.length > 0) {
    const names = noScaleDrawings.map(d => `„${d.name}"`).join(', ')
    issues.push({ level: 'warning', message: `Půdorysy bez měřítka: ${names}. Jejich zóny budou vynechány z gbXML.` })
  }

  // Plan edges without construction (default to ExteriorWall silently)
  const planZones = zones.filter(z => {
    const d = drawings.find(dr => dr.id === z.drawingId)
    return d?.viewType === 'plan'
  })
  const planEdgeIds = new Set(planZones.flatMap(z => z.edgeIds))
  const noConstrCount = [...planEdgeIds].filter(eid => !edges[eid]?.construction).length
  if (noConstrCount > 0) {
    issues.push({ level: 'warning', message: `${noConstrCount} hran půdorysu nemá přiřazenou konstrukci — budou exportovány jako „Obvodová stěna".` })
  }

  // Elevation surfaces without plan edge link (openings won't be attributed)
  const elevSurfaces = surfaces.filter(s => {
    const d = drawings.find(dr => dr.id === s.drawingId)
    return d?.viewType !== 'plan'
  })
  const unlinkedSurfaces = elevSurfaces.filter(s => !s.linkedPlanEdgeId)
  if (unlinkedSurfaces.length > 0) {
    issues.push({ level: 'warning', message: `${unlinkedSurfaces.length} ploch pohledu není propojeno s hranou půdorysu. Výplně otvorů z těchto ploch nebudou v gbXML přiřazeny ke správné stěně.` })
  }

  // Incomplete edges (construction assigned but openings not confirmed)
  const incompleteCount = Object.values(edges).filter(e => e.status !== 'complete').length
  if (incompleteCount > 0) {
    issues.push({ level: 'warning', message: `${incompleteCount} hran není dokončeno (chybí potvrzení výplní). Export je přesto možný.` })
  }

  return issues
}
