// ExportButton – export validation + CSV / gbXML downloads

import { useProjectStore } from '../../store/projectStore'
import { exportCsv, exportZonesCsv } from '../../utils/csvExport'
import { exportGbXml } from '../../utils/gbxmlExport'
import { validateProject } from '../../utils/validation'

export default function ExportButton() {
  const { project } = useProjectStore()

  const issues  = validateProject(project)
  const errors  = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')
  const blocked  = errors.length > 0

  return (
    <div className="panel flex flex-col gap-2">
      <h3 className="font-semibold text-sm">Export</h3>

      {/* Validation messages */}
      {errors.length > 0 && (
        <div className="flex flex-col gap-1">
          {errors.map((e, i) => (
            <div key={i} className="text-xs bg-red-50 text-red-700 rounded px-2 py-1.5 flex gap-1.5">
              <span className="shrink-0">✕</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="text-xs bg-yellow-50 text-yellow-700 rounded px-2 py-1.5 flex gap-1.5">
              <span className="shrink-0">⚠</span>
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {!blocked && issues.length === 0 && (
        <div className="text-xs bg-green-50 text-green-700 rounded px-2 py-1.5 flex gap-1.5">
          <span>✓</span>
          <span>Projekt je připraven k exportu.</span>
        </div>
      )}

      {/* Export buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          className="btn-primary text-xs"
          disabled={blocked}
          title={blocked ? errors[0].message : undefined}
          onClick={() => exportCsv(project)}
        >
          CSV (konstrukce)
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={blocked}
          title={blocked ? errors[0].message : undefined}
          onClick={() => exportZonesCsv(project)}
        >
          CSV (zóny)
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={blocked}
          title={blocked ? errors[0].message : undefined}
          onClick={() => exportGbXml(project)}
        >
          gbXML v0.37
        </button>
      </div>
    </div>
  )
}
