#!/usr/bin/env bash
# Shallow-clone the reference repos into reference/repos/<category>/<name>.
# reference/repos/ is gitignored: re-run this script on any machine to recreate it.
# Usage: bash reference/clone-repos.sh            (all)
#        bash reference/clone-repos.sh 3d ai      (only some categories: 3d access ai flood stack world-models simulation)
set -u
cd "$(dirname "$0")/repos"

REPOS=(
  # category | url
  "3d|https://github.com/NASA-AMMOS/3DTilesRendererJS"
  "3d|https://github.com/pmndrs/react-three-fiber"
  "3d|https://github.com/pmndrs/drei"
  "3d|https://github.com/reearth/resium"
  "3d|https://github.com/maplibre/maplibre-gl-js"
  "3d|https://github.com/visgl/react-map-gl"
  "3d|https://github.com/OvertureMaps/overturemaps-py"
  "3d|https://github.com/tordanik/OSM2World"
  "3d|https://github.com/ThatOpen/engine_components"
  "3d|https://github.com/ThatOpen/engine_web-ifc"
  "3d|https://github.com/sparkjsdev/spark"
  # --- 3D / map additions after the township pivot (CesiumGS/cesium (~1.2 GB) and mapbox/mapbox-gl-js (~670 MB shallow) are too big to clone: read their APIs via npm/ctx7)
  "3d|https://github.com/visgl/react-google-maps"
  "3d|https://github.com/protomaps/PMTiles"
  "3d|https://github.com/opengeospatial/geoparquet"
  "access|https://github.com/OpenSidewalks/OpenSidewalks-Schema"
  "access|https://github.com/nbolten/unweaver"
  "access|https://github.com/networkx/networkx"
  "access|https://github.com/joonspk-research/generative_agents"
  "access|https://github.com/microsoft/soundscape"
  "ai|https://github.com/anthropics/anthropic-sdk-python"
  "ai|https://github.com/pydantic/pydantic-ai"
  "ai|https://github.com/promptfoo/promptfoo"
  "ai|https://github.com/modelcontextprotocol/modelcontextprotocol"
  "ai|https://github.com/modelcontextprotocol/python-sdk"
  "ai|https://github.com/jlowin/fastmcp"
  "ai|https://github.com/UKGovernmentBEIS/inspect_ai"
  "ai|https://github.com/aisingapore/sealion"
  # --- Flood / disaster lens (flood-sources.md, priority 1-2). SFINCS/hydromt_sfincs/pyflwdir are priority 3 (pilot path): not cloned.
  "flood|https://github.com/mdbartos/pysheds"
  "flood|https://github.com/gboeing/osmnx"
  "flood|https://github.com/jblindsay/whitebox-tools"
  "flood|https://github.com/rasterio/rasterio"
  "stack|https://github.com/fastapi/full-stack-fastapi-template"
  "stack|https://github.com/assistant-ui/assistant-ui"
  "stack|https://github.com/hey-api/openapi-ts"
  # --- World models (2026-10-16): notes/world-models-repos.md
  # --- Agent-based township simulation (Elmina Day, 17 Oct 2026): MiroFish-style swarm + city-scale LLM agents
  "simulation|https://github.com/666ghj/MiroFish"
  "simulation|https://github.com/tsinghua-fib-lab/AgentSociety"
  "simulation|https://github.com/camel-ai/oasis"
  "world-models|https://github.com/projectmesa/mesa"
  "world-models|https://github.com/projectmesa/mesa-geo"
  "world-models|https://github.com/maitrix-org/llm-reasoners"
  "world-models|https://github.com/PrefectHQ/fastmcp"
)

want=("$@")
for entry in "${REPOS[@]}"; do
  cat="${entry%%|*}"; url="${entry#*|}"; name="$(basename "$url")"
  if [ ${#want[@]} -gt 0 ] && [[ ! " ${want[*]} " =~ " ${cat} " ]]; then continue; fi
  mkdir -p "$cat"
  if [ -d "$cat/$name/.git" ]; then echo "skip  $cat/$name (exists)"; continue; fi
  if git clone --quiet --depth 1 --single-branch "$url" "$cat/$name" 2>/dev/null; then
    echo "ok    $cat/$name  $(du -sh "$cat/$name" | cut -f1)"
  else
    echo "FAIL  $cat/$name  ($url)"
  fi
done
