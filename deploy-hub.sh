#!/bin/bash
# Deploy ep-geometry-tool do dpu-hub (dpuhub.netlify.app/ep-geometry-tool/)

set -e

DPHUB="C:/Users/jakub/OneDrive - DPU REVIT s.r.o/DPU Energy - General/Nástroje/dpu-hub/ep-geometry-tool"

echo "→ Building with base /ep-geometry-tool/ ..."
MSYS_NO_PATHCONV=1 VITE_BASE_PATH="/ep-geometry-tool/" npm run build

echo "→ Copying to dpu-hub ..."
rm -rf "$DPHUB/assets"
cp -r dist/assets "$DPHUB/assets"
cp dist/index.html "$DPHUB/index.html"

echo "→ Committing and pushing dpu-hub ..."
cd "$DPHUB/.."
git add ep-geometry-tool/
git commit -m "feat: update ep-geometry-tool build"
git push

echo "✓ Hotovo – dpuhub.netlify.app/ep-geometry-tool/ se brzy aktualizuje"
