// Main application layout
// Left: canvas | Right: panels (edge wizard, zones, library, results, export)

import { useRef, useState, lazy, Suspense } from 'react'
import ImageCanvas from './components/canvas/ImageCanvas'
import EdgeWizard from './components/panels/EdgeWizard'
import ZoneSurfaceWizard from './components/panels/ZoneSurfaceWizard'
import ZonePanel from './components/panels/ZonePanel'
import ConstructionLibrary from './components/panels/ConstructionLibrary'
import ResultsSummary from './components/results/ResultsSummary'
import ExportButton from './components/results/ExportButton'
import { useProjectStore } from './store/projectStore'


// Lazy-load Three.js so it doesn't bloat the initial bundle
const Model3D = lazy(() => import('./components/viewer/Model3D'))

export default function App() {
  const { project, resetProject, exportProjectFile, importProjectFile } = useProjectStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError]   = useState<string | null>(null)
  const [show3D, setShow3D]             = useState(false)

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const err  = importProjectFile(text)
      setImportError(err)
      if (!err) setTimeout(() => setImportError(null), 3000)
    }
    reader.readAsText(file)
    // Reset input so the same file can be re-imported
    e.target.value = ''
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
        <span className="font-bold text-gray-800 text-sm tracking-tight">EP Geometry Tool</span>
        {project.name && (
          <>
            <div className="w-px h-4 bg-gray-200" />
            <span className="text-sm text-gray-600 truncate max-w-xs">{project.name}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {importError && (
            <span className="text-xs text-red-500">{importError}</span>
          )}
          <button
            className="btn-secondary text-xs"
            title="Uložit projekt jako soubor (.epgeo.json)"
            onClick={exportProjectFile}
          >
            Uložit projekt
          </button>
          <button
            className="btn-secondary text-xs"
            title="Otevřít projekt ze souboru (.epgeo.json)"
            onClick={() => fileInputRef.current?.click()}
          >
            Otevřít projekt
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.epgeo.json"
            className="hidden"
            onChange={handleImport}
          />
          <div className="w-px h-4 bg-gray-200" />
          <button
            className="btn-secondary text-xs"
            onClick={() => setShow3D(true)}
            title="Zobrazit 3D náhled budovy"
          >
            3D náhled
          </button>
          <div className="w-px h-4 bg-gray-200" />
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              if (confirm('Resetovat celý projekt? Tato akce je nevratná.')) resetProject()
            }}
          >
            Nový projekt
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 gap-3 p-3 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 min-w-0">
          <ImageCanvas />
        </div>

        {/* Right sidebar */}
        <aside className="w-72 flex flex-col gap-3 overflow-y-auto">
          <EdgeWizard />
          <ZoneSurfaceWizard />
          <ZonePanel />
          <ConstructionLibrary />
          <ResultsSummary />
          <ExportButton />
        </aside>
      </main>
      {/* 3D model overlay – lazy loaded */}
      {show3D && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center text-white text-sm">
            Načítám 3D engine…
          </div>
        }>
          <Model3D onClose={() => setShow3D(false)} />
        </Suspense>
      )}
    </div>
  )
}
