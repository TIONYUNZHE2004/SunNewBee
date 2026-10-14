#!/usr/bin/env bash
# Download the reference papers (open-access PDFs) into reference/papers/<category>/.
# Annotated index: reference/README.md. Re-running skips files that already exist.
set -u
cd "$(dirname "$0")/papers"

PAPERS=(
  # category | filename | url
  # --- AI assistant: spatial-reasoning limits, grounding, evaluation
  "ai|2501.00316_MapEval.pdf|https://arxiv.org/pdf/2501.00316"
  "ai|2509.18173_TurnBack.pdf|https://arxiv.org/pdf/2509.18173"
  "ai|2606.22219_Lost-in-Aggregation.pdf|https://arxiv.org/pdf/2606.22219"
  "ai|2407.00379_GraphArena.pdf|https://arxiv.org/pdf/2407.00379"
  "ai|2507.07644_FloorplanQA.pdf|https://arxiv.org/pdf/2507.07644"
  "ai|2401.06730_Relying-on-the-Unreliable-uncertainty.pdf|https://arxiv.org/pdf/2401.06730"
  "ai|2406.12045_tau-bench.pdf|https://arxiv.org/pdf/2406.12045"
  "ai|2306.05685_LLM-as-a-Judge.pdf|https://arxiv.org/pdf/2306.05685"
  "ai|2309.15217_Ragas.pdf|https://arxiv.org/pdf/2309.15217"
  "ai|2404.16130_GraphRAG.pdf|https://arxiv.org/pdf/2404.16130"
  "ai|2410.05779_LightRAG.pdf|https://arxiv.org/pdf/2410.05779"
  "ai|2502.14301_SEA-HELM.pdf|https://arxiv.org/pdf/2502.14301"
  "ai|2210.03629_ReAct.pdf|https://arxiv.org/pdf/2210.03629"
  "ai|2307.12981_3D-LLM.pdf|https://arxiv.org/pdf/2307.12981"
  "ai|2311.12871_LEO-embodied-generalist.pdf|https://arxiv.org/pdf/2311.12871"
  "ai|2401.12168_SpatialVLM.pdf|https://arxiv.org/pdf/2401.12168"
  "ai|2406.01584_SpatialRGPT.pdf|https://arxiv.org/pdf/2406.01584"
  # --- Accessibility, routing, resident-agent simulation
  "access|2206.13677_Project-Sidewalk-global-scale.pdf|https://arxiv.org/pdf/2206.13677"
  "access|2304.03442_Generative-Agents.pdf|https://arxiv.org/pdf/2304.03442"
  "access|2411.10109_Generative-Agent-Simulations-1000-People.pdf|https://arxiv.org/pdf/2411.10109"
  "access|2504.09407_UXAgent.pdf|https://arxiv.org/pdf/2504.09407"
  "access|2310.02424_AXNav.pdf|https://arxiv.org/pdf/2310.02424"
  "access|2506.23306_GATSim.pdf|https://arxiv.org/pdf/2506.23306"
  "access|2510.09907_Agentic-Property-Based-Testing.pdf|https://arxiv.org/pdf/2510.09907"
  "access|2605.20191_Shiny-Stories-Hidden-Struggles-disability-LLM.pdf|https://arxiv.org/pdf/2605.20191"
  "access|2512.02275_Down-Syndrome-Stereotypes-LLM-Personas.pdf|https://arxiv.org/pdf/2512.02275"
  "access|Melnikov2022_shade-pedestrian-route-choice-SciRep.pdf|https://pure.uva.nl/ws/files/68289680/s41598_022_06383_5.pdf"
  "access|MDPI2025_bench-spacing-rest-points-Sustainability.pdf|https://www.mdpi.com/2071-1050/17/18/8251/pdf"
  "access|MDPI2025_impersonification-bias-survey-filling-Information.pdf|https://www.mdpi.com/2078-2489/16/11/931/pdf"
  # --- 3D data and rendering
  "3d|2308.04079_3D-Gaussian-Splatting.pdf|https://arxiv.org/pdf/2308.04079"
  "3d|2404.01133_CityGaussian.pdf|https://arxiv.org/pdf/2404.01133"
  "3d|2406.12080_Hierarchical-3DGS-very-large-datasets.pdf|https://arxiv.org/pdf/2406.12080"
  "3d|2403.17898_Octree-GS.pdf|https://arxiv.org/pdf/2403.17898"
  "3d|2503.11651_VGGT.pdf|https://arxiv.org/pdf/2503.11651"
  "3d|2509.13414_MapAnything.pdf|https://arxiv.org/pdf/2509.13414"
  "3d|2312.14132_DUSt3R.pdf|https://arxiv.org/pdf/2312.14132"
  "3d|2309.16650_ConceptGraphs.pdf|https://arxiv.org/pdf/2309.16650"
)

for entry in "${PAPERS[@]}"; do
  IFS='|' read -r cat file url <<<"$entry"
  mkdir -p "$cat"
  out="$cat/$file"
  if [ -s "$out" ]; then echo "skip  $out"; continue; fi
  if curl -fsSL -A "Mozilla/5.0 (TownshipLens research; student hackathon)" --max-time 120 -o "$out" "$url" \
     && head -c 5 "$out" | grep -q "%PDF"; then
    echo "ok    $out  $(du -h "$out" | cut -f1)"
  else
    echo "FAIL  $out  ($url)"; rm -f "$out"
  fi
  sleep 1   # be polite to arXiv
done
