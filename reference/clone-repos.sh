#!/usr/bin/env bash
# Shallow-clone the reference repos into reference/repos/<category>/<name>.
# reference/repos/ is gitignored: re-run this script on any machine to recreate it.
# Usage: bash reference/clone-repos.sh            (all)
#        bash reference/clone-repos.sh 3d ai      (only some categories)
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
  "stack|https://github.com/fastapi/full-stack-fastapi-template"
  "stack|https://github.com/assistant-ui/assistant-ui"
  "stack|https://github.com/hey-api/openapi-ts"
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
