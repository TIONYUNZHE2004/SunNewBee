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
  # --- Flood / disaster lens (priority 1-2 in reference/notes/flood-sources.md; each URL checked with curl -sIL on 2026-10-15)
  "flood|2109.11712_Flood-mapping-traffic-signs-route-optimisation.pdf|https://arxiv.org/pdf/2109.11712"
  "flood|2609.16963_Transport-resilience-heavy-rainfall.pdf|https://arxiv.org/pdf/2609.16963"
  "flood|Hawker2022_FABDEM-ERL.pdf|https://iopscience.iop.org/article/10.1088/1748-9326/ac4d4f/pdf"
  "flood|Pregnolato2017_depth-disruption-road-transport.pdf|https://research-information.bris.ac.uk/ws/files/191868409/Full_text_PDF_final_published_version_.pdf"
  "flood|ISPRS2023_Bonn-interactive-evacuation-tool-dxv.pdf|https://repos.hcu-hamburg.de/bitstream/hcu/965/1/isprs-archives-XLVIII-1-W2-2023-437-2023.pdf"
  "flood|ISPRS2019_3D-buildings-flood-simulation-Cesium.pdf|https://isprs-archives.copernicus.org/articles/XLII-2-W11/669/2019/isprs-archives-XLII-2-W11-669-2019.pdf"
  "flood|DefraEA_FD2320-flood-hazard-ratings-note.pdf|https://n-somerset.gov.uk/sites/default/files/2024-08/CD%20K10%20Supplementary%20Note%20on%20Flood%20Hazard%20Ratings.pdf"
  "flood|CIDB2023_draft-CIS-flood-risk-assessment-Malaysia.pdf|https://www.cidb.gov.my/wp-content/uploads/2023/10/DRAFT-CIS-FOR-FLOOD-RISK-ASSESSMENT-IN-MALAYSIA.pdf"
  # --- SDP and Malaysia context (reports, policy). Large reports are gitignored.
  "context|SDP_Integrated-Annual-Report-2025.pdf|https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20IAR2025%20%28Website%29.pdf"
  "context|SDP_Sustainability-Report-2025.pdf|https://www.simedarbyproperty.com/sites/default/files/2026-04/SDP%20SR2025%20%28Website%29.pdf"
  "context|UNICEF-SDP_Inclusive-Playground-Toolkit-2022.pdf|https://www.unicef.org/malaysia/media/2071/file/Best%20Business%20Practice:%20Inclusive%20Playground%20Toolkit%20(FULL).pdf"
  "context|DOSM_Current-Population-Estimates-2026.pdf|https://www.dosm.gov.my/uploads/release-content/file_20260730111244.pdf"
  "context|SDP_AGM-2026-QA.pdf|https://www.simedarbyproperty.com/sites/default/files/2026-07/f%29%20Appendix%205%20-%20Question%20and%20Answer_clean_v2.pdf"
  "context|SDP_Integrated-Annual-Report-2024.pdf|https://www.simedarbyproperty.com/sites/default/files/2025-06/INTEGRATED-ANNUAL-REPORT-2024.pdf"
  "context|SDP_Sustainability-Report-2024.pdf|https://www.simedarbyproperty.com/sites/default/files/2025-05/SR2024.pdf"
  "context|SDP_Q1-2026-results-release.pdf|https://www.simedarbyproperty.com/sites/default/files/2026-05/20260526%20-%20For%20Immediate%20Release%20-%20Sime%20Darby%20Property%E2%80%99s%20Q1%20Y-o-Y%20Profit%20Up%20by%2032%25%5B96%5D.pdf"
  "context|Kenanga_SDP-4Q25-research-note.pdf|https://www.kenanga.com.my/wp-content/uploads/2026/02/SIMEPROP-260227-4Q25-RN-Kenanga.pdf"
  "context|SDP_Bandar-Bukit-Raja-booklet.pdf|https://www.simedarbyproperty.com/bandar-bukit-raja/booklet.pdf"
  "context|OneAsiaLawyers_PDPA-2024-amendments.pdf|https://oneasia.legal/en/wp-content/themes/standard_black_cmspro/img/EN_09-2024-Amendments-to-Personal-Data-Protection-Act-2024_20241124.pdf"
  # --- World models (ai/world-model research sprint, 2026-10-16): notes/world-models-{ml,llm,urban,repos}.md
  "world-models|1207.4710_Canadian-Traveler-Variants-Complexity.pdf|https://arxiv.org/pdf/1207.4710"
  "world-models|1803.10122_World-Models-Ha-Schmidhuber.pdf|https://arxiv.org/pdf/1803.10122"
  "world-models|1911.08265_MuZero.pdf|https://arxiv.org/pdf/1911.08265"
  "world-models|2004.10589_ABM-Pedestrian-Flood-Mobility.pdf|https://arxiv.org/pdf/2004.10589"
  "world-models|2301.04104_DreamerV3.pdf|https://arxiv.org/pdf/2301.04104"
  "world-models|2304.11477_LLM-P.pdf|https://arxiv.org/pdf/2304.11477"
  "world-models|2305.14078_LLM-MCTS.pdf|https://arxiv.org/pdf/2305.14078"
  "world-models|2305.14992_RAP-Reasoning-via-Planning.pdf|https://arxiv.org/pdf/2305.14992"
  "world-models|2402.12275_WorldCoder.pdf|https://arxiv.org/pdf/2402.12275"
  "world-models|2405.15383_GIF-MCTS.pdf|https://arxiv.org/pdf/2405.15383"
  "world-models|2406.06485_LLM-Text-World-Simulators.pdf|https://arxiv.org/pdf/2406.06485"
  "world-models|2406.12360_UrbanLLM-Activity-Planning.pdf|https://arxiv.org/pdf/2406.12360"
  "world-models|2406.13945_CityBench.pdf|https://arxiv.org/pdf/2406.13945"
  "world-models|2406.13948_CityGPT-Urban-Spatial-Cognition.pdf|https://arxiv.org/pdf/2406.13948"
  "world-models|2410.21286_OpenCity.pdf|https://arxiv.org/pdf/2410.21286"
  "world-models|2411.02385_Video-Gen-vs-World-Model-Physical-Law.pdf|https://arxiv.org/pdf/2411.02385"
  "world-models|2411.06559_WebDreamer.pdf|https://arxiv.org/pdf/2411.06559"
  "world-models|2501.03575_Cosmos-WFM-Platform.pdf|https://arxiv.org/pdf/2501.03575"
  "world-models|2502.08691_AgentSociety.pdf|https://arxiv.org/pdf/2502.08691"
  "world-models|2506.09985_V-JEPA2.pdf|https://arxiv.org/pdf/2506.09985"
  "world-models|2506.21805_CitySim-LLM-Agent-Simulation.pdf|https://arxiv.org/pdf/2506.21805"
  "world-models|2507.00914_Urban-LLM-Agents-Survey.pdf|https://arxiv.org/pdf/2507.00914"
  "world-models|2509.24527_Dreamer4.pdf|https://arxiv.org/pdf/2509.24527"
  "world-models|2510.04542_Code-World-Models-General-Game-Playing.pdf|https://arxiv.org/pdf/2510.04542"
  "world-models|2601.03905_Agents-World-Model-Tool-Foresight.pdf|https://arxiv.org/pdf/2601.03905"
  "world-models|2606.09032_Text-World-Models-Survey.pdf|https://arxiv.org/pdf/2606.09032"
  "world-models|2606.20545_Current-World-Models-Lack-Persistent-State.pdf|https://arxiv.org/pdf/2606.20545"
  "world-models|2606.30639_Self-Evolving-World-Models.pdf|https://arxiv.org/pdf/2606.30639"
  "world-models|2607.06401_Definition-and-Roadmap-for-World-Models.pdf|https://arxiv.org/pdf/2607.06401"
  "world-models|2609.37009_LLM-Agent-Evacuation-Moving-Threat.pdf|https://arxiv.org/pdf/2609.37009"
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
