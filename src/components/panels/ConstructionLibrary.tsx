// ConstructionLibrary – view and edit construction types (name + default thickness)

import { useState } from 'react'
import { useLibraryStore } from '../../store/libraryStore'

export default function ConstructionLibrary() {
  const { constructions, updateName, updateThickness, reset } = useLibraryStore()
  const [editingName, setEditingName]           = useState<Record<string, string>>({})
  const [editingThickness, setEditingThickness] = useState<Record<string, string>>({})

  return (
    <div className="panel flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Typy konstrukcí</h3>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={reset}>
          Reset
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left py-1 font-medium">Název</th>
            <th className="text-right py-1 font-medium pr-1">Tl. (m)</th>
          </tr>
        </thead>
        <tbody>
          {constructions.map((c) => (
            <tr key={c.type} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-0.5 pr-1">
                <input
                  type="text"
                  className="input w-full text-xs"
                  value={editingName[c.type] ?? c.name}
                  onChange={e => setEditingName(prev => ({ ...prev, [c.type]: e.target.value }))}
                  onBlur={() => {
                    const val = editingName[c.type]
                    if (val !== undefined && val.trim()) updateName(c.type, val.trim())
                    setEditingName(prev => { const n = { ...prev }; delete n[c.type]; return n })
                  }}
                />
              </td>
              <td className="py-0.5 text-right">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input w-16 text-right text-xs"
                  value={editingThickness[c.type] ?? c.thicknessMeters}
                  onChange={e => setEditingThickness(prev => ({ ...prev, [c.type]: e.target.value }))}
                  onBlur={() => {
                    const raw = editingThickness[c.type]
                    if (raw !== undefined) {
                      const parsed = parseFloat(raw)
                      if (!isNaN(parsed) && parsed >= 0) updateThickness(c.type, parsed)
                    }
                    setEditingThickness(prev => { const n = { ...prev }; delete n[c.type]; return n })
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-gray-400">
        Tloušťky se používají k přepočtu AP/AEP z plochy polygonu na vnitřní plochu.
        Předpoklad: polygon je obtažen po vnějším líci stěn.
      </p>
    </div>
  )
}
