# World-model reuse research (2026-10-16)

Scope: open-source code to copy or depend on for the Township World Model (state / events / transition / rollouts / planner / VOI), plus PydanticAI and Cesium snippets.
Clones live in `reference/repos/world-models/` (shallow, `--depth 1`). Sizes are on-disk after clone. Licences checked via GitHub API on 2026-10-16.

## 0. Bottom line

1. **Do not adopt a heavy ABM/pedestrian framework.** Our "agents" are residents routed over an existing tri-state graph; `packages/spatial` (`routing.py`, `sim.py::_journey`, `run_evacuation`) already does the per-agent decision. Write a ~150-line numpy/stdlib rollout engine (section 6) and borrow only *patterns* from Mesa.
2. **Copy the MCTS skeleton from llm-reasoners** (`mcts.py` + the `WorldModel` / `SearchConfig` / `Dynamics` ABCs in `base.py`). Its `State`/`Action`/`step`/`reward`/`is_terminal` contract is exactly our world-model contract. Apache-2.0, needs only numpy + tqdm. Replace the LLM `get_actions` with "LLM proposes N candidate interventions, validated against the action schema".
3. **Use FastMCP (`fastmcp` PyPI)** to expose the 10 tools. PydanticAI 2.x can also consume it in-process via `MCPToolset(fastmcp_server)`, so one tool registry serves our agent and external MCP clients.
4. **Streaming:** `agent.run_stream(...).stream_output()` yields partial `FinalAnswer` snapshots even with `ToolOutput`. It conflicts with our validator-gated honesty rule; see 4.1 for the safe pattern.
5. **VOI needs no library.** With tri-state claims it is a small exact computation over our own graph (section 5): flip one UNKNOWN claim to PASS/FAIL, re-evaluate affected routes, weight by prior.
6. **Cesium animation:** precomputed arrays + `PointPrimitiveCollection` updated in a single `clock.onTick` is far cheaper than 200 Entities with `SampledPositionProperty` (section 7).

## 1. Agent-based / pedestrian simulation

| Repo | Licence | Size | Verdict |
|---|---|---|---|
| projectmesa/mesa (cloned) | Apache-2.0 | 3.5 MB clone (repo 16 MB) | inspire-only (or optional depend) |
| projectmesa/mesa-geo (cloned) | Apache-2.0 | 0.7 MB | inspire-only |
| PedestrianDynamics/jupedsim | NOASSERTION per GitHub (LGPL-3.0 per upstream; verify) | ~500 MB repo; not cloned | reject (C++ core, continuous space) |
| AgentTorch/AgentTorch | AGPL-3.0 | 142 MB; not cloned | reject (AGPL, PyTorch) |
| tsinghua-fib-lab/AgentSociety | Apache-2.0 | 371 MB; not cloned | inspire-only (read the paper/README for LLM-agent loop ideas) |
| camel-ai/oasis | Apache-2.0 | 207 MB; not cloned | reject (social-media sim, not spatial) |
| google-deepmind/concordia | Apache-2.0 | 60 MB; not cloned | inspire-only (Game-Master pattern: an LLM narrates, an engine holds state) |
| Vadere, MATSim | n/a / GPL / Java | n/a | reject (Java, heavy). MATSim's *plans/iterations* idea is the only relevant bit |

### Mesa 4.0.0a0 (`reference/repos/world-models/mesa`)
- Requires Python >=3.12; deps numpy, pandas, tqdm, scipy (pythran on macOS). That is heavy-ish just for scheduling.
- Worth reading, not copying:
  - `mesa/mesa/model.py::Model` (generic over Agent and Scenario; `step()` at line ~322): shows the clean "model owns agents + time + RNG" shape. Our `WorldState` should own population + RNG seed so rollouts are reproducible.
  - `mesa/mesa/agentset.py::AgentSet` (`shuffle_do`, `select`, `groupby`): the "apply method to all agents in random order" idiom for a tick.
  - `mesa/mesa/datacollection.py`: model for per-tick reporters (counts evacuated / stuck / blocked per tick). We want exactly these series for the UI chart.
  - `mesa/mesa/examples/basic/schelling/{model,agents}.py` and `examples/advanced/epstein_civil_violence`: smallest end-to-end examples of agent + step + collector.
- Fit: OK on 3.13, but its value is scheduling and collection that we can write in about 60 lines against `World`. Recommendation: **inspire-only**; revisit only if we need `mesa.batchrunner` style parameter sweeps.

### mesa-geo (`reference/repos/world-models/mesa-geo`)
- `mesa_geo/geospace.py::GeoSpace` (487 lines) and `geoagent.py`: geopandas/shapely based, agents are GeoJSON-ish features. Needs geopandas + shapely + rasterio. We have our own geo layer, so **inspire-only**. `mesa_geo/raster_layers.py` is a useful reference if we ever rasterise flood depth per tick.

### JuPedSim
- Python bindings over a C++ core (continuous-space collective-dynamics models, geometry polygons, wheels per platform). Right for building evacuation studies on floor plans, wrong for a graph with tri-state edges. Reject. If a reviewer asks "why not a pedestrian-dynamics engine": we model route feasibility under uncertainty, not crowd physics; flows are an *advisory* layer.

## 2. LLM planning / world-model frameworks

### maitrix-org/llm-reasoners (cloned; Apache-2.0; 137 MB on disk, mostly `examples/` and docs; repo API size 62 MB; last push 2025-06, so stable but unmaintained)
Files worth copying (all under `reference/repos/world-models/llm-reasoners/reasoners/`):
- `base.py` (343 lines): ABCs `Dynamics` (`init_state`, `step(state, action) -> state | (state, aux)`, `is_terminal`), `WorldModel(Dynamics)`, `SearchConfig` (`get_actions`, `fast_reward`, `reward`), `SearchAlgorithm.__call__(world_model, search_config)`. **Copy lines ~93-175.** Drop the `LanguageModel`/`GenerateOutput` classes.
- `algorithm/mcts.py` (344 lines): `MCTSNode`, `MCTS` with `w_exp`, `depth_limit`, `n_iters`, `cum_reward`, `calc_q`, `simulate_strategy`, `output_strategy` (`max_reward`, `follow_max`, ...), `uct_with_fast_reward`. Pure python + numpy + tqdm. Copy the whole file, strip the `pickle`/visualiser imports and the unused `MCTSAggregation`.
- `algorithm/beam_search.py` and `algorithm/greedy.py` / `dfs.py`: same interface, cheaper. **Beam search is the better default** for our branching (about 5-12 interventions, depth 2-3, each `step` is a deterministic sim that costs milliseconds to seconds). MCTS only pays off when rollouts are stochastic.
- `examples/RAP/`: reference for "LLM as both proposer and world model". We use the LLM only as *proposer*; the simulator is the world model. That is the honest version of RAP.
Adapter sketch for our code:
```python
class TownshipDynamics(WorldModel):
    def init_state(self): return self.world_state            # frozen/copy-on-write World + stage + closures
    def step(self, s, a):  s2 = apply_action(s, a); return s2, {"kpis": rollout(s2, n=200, seed=7)}
    def is_terminal(self, s): return len(s.applied) >= self.budget
class TownshipConfig(SearchConfig):
    def get_actions(self, s): return candidate_actions(s)     # legal, schema-checked; LLM proposals merged in
    def fast_reward(self, s, a): return (heuristic(s, a), {})  # cheap graph metric, no rollout
    def reward(self, s, a, kpis, **_): return (-kpis["unreachable_pct"] - 0.1*kpis["mean_extra_m"] - cost(a), {})
```
Key rule: the LLM never scores. It may only add to `get_actions`; every score comes from `rollout`. That preserves the "LLM never computes facts" invariant.
- Recommendation: **copy** `base.py` ABCs + `mcts.py` + `beam_search.py` into `packages/spatial/.../planner/` (add the licence header and a line in the recorded-sources file).

### Others (not cloned)
- LATS (andyzoujm/language-agent-tree-search): repo not found at the guessed URL; same algorithm as MCTS above. Reject.
- DSPy: prompt optimiser; not needed for a forced-`final_answer` agent. Reject for now.
- `pydantic-graph` (part of PydanticAI, MIT): typed state-machine graphs with `BaseNode.run(ctx) -> NextNode | End`, state persistence. Good fit for a *planner/executor* pipeline (propose -> validate -> simulate -> score -> explain) so each stage is a node with typed state and a Mermaid diagram for the demo. Use if we want the planner visible as a flow; otherwise a plain async function is enough. Recommendation: **depend (already installed)**, optional.
- Search turned up no ready-made "LLM proposes interventions, simulator scores them" library. The nearest are papers (arXiv 2608.23622 "LLM Agents Perform Controlled Experiments Using Simulation Models", arXiv 2603.19649 PolicySim, which uses a contextual bandit). Treat them as design references only; I did not read them in full.

## 3. FastMCP (cloned; Apache-2.0; 92 MB on disk, repo 60 MB; very active, pushed today; Python >=3.10)
URL https://github.com/PrefectHQ/fastmcp (formerly jlowin/fastmcp).
- Worth reading: `examples/echo.py`, `examples/simple_echo.py`, `examples/mount_example.py`, `examples/in_memory_proxy_example.py`, `examples/tags_example.py` (tag tools, e.g. `read_only`), `docs/` for ASGI mounting.
- Recommendation: **depend** (`fastmcp` PyPI). Expose each of `townshiplens_spatial.tools.TOOLS` plus the new `simulate` / `plan` / `voi` tools. See 4.3.

## 4. PydanticAI snippets (docs via ctx7, `/websites/pydantic_dev_ai`, checked 2026-10-16; our pin is 2.56)

### 4.1 Stream the structured final answer as it is generated
Docs (core-concepts/output): `run_stream()` + `stream_output()` yields **accumulated snapshots, not deltas**; unfinished fields may be missing. `debounce_by` (default 0.1 s) groups chunks.
```python
async with agent.run_stream(msg, deps=deps, message_history=hist, usage=rec.usage) as result:
    sent = ""
    async for partial in result.stream_output(debounce_by=0.05):   # partial: FinalAnswer (or dict-like) snapshot
        text = (partial.summary if hasattr(partial, "summary") else partial.get("summary", ""))
        if text.startswith(sent) and len(text) > len(sent):
            yield TextDelta(text=text[len(sent):]);  sent = text
    final = await result.get_output()
```
Lower-level variant that never raises mid-stream:
```python
async for message in result.stream_response(debounce_by=0.01):
    try:
        partial = await result.validate_response_output(message, allow_partial=message.state == "incomplete")
    except ValidationError:
        continue
```
Caveats for us (important):
- Our `run.py` uses `agent.run(...)` with an output-tool validator that raises `ModelRetry`. Partial snapshots are **pre-validation**; the model may emit "safe" or an uncited claim, get retried, and the user has already seen it.
- Safe options, in order: (a) keep `run()` and *replay* the validated `summary` as word-sized `text.delta` events with small sleeps (looks streamed, zero honesty risk, trivial change in `_answer_events`); (b) stream partials flagged `provisional: true`, run `validate.py` on the finished answer, and emit a `text.replace` / `error` event if rejected; (c) run the validator on each sentence boundary of the partial and stop streaming at the first failure.
- Recommended for the hackathon: (a) now, (b) if time allows. With `ToolOutput`, tool-call streaming works only on providers that stream tool-call args (OpenRouter generally does; the mock does not, so keep (a) as the mock/template path).
- `run_stream` ends the run at the first output; for tool events during the turn use `agent.iter()` or `run_stream_events()`; our `rec.queue` already does this, so keep it.

### 4.2 Multi-turn memory
```python
from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_core import to_jsonable_python

r1 = await agent.run(q1, deps=deps)
hist = r1.new_messages()                                   # this run only; all_messages() = whole conversation
r2 = await agent.run(q2, deps=deps, message_history=hist)  # NB: system prompt is not regenerated when history is non-empty

blob = to_jsonable_python(r2.all_messages())               # store in SQLite per session_id
hist = ModelMessagesTypeAdapter.validate_python(blob)
```
Notes for us: store `all_messages()` as JSON keyed by `session_id` next to the VR tables in `.data/<site>.db`; cap with a `history_processors=[keep_last_n]` or summarise old turns. Privacy rule: never persist raw user text into VRs (PDPA); session memory is a separate table with a TTL, and should keep tool returns (evidence ids) so follow-ups like "and with a wheelchair?" can reuse the same route/scenario. The validator's `TurnRecord` must stay *per turn*: evidence ids from earlier turns must not count as "returned this turn".
Also `instructions=` (re-sent every run) is preferable to `system_prompt=` for multi-turn.

### 4.3 Expose tools via MCP
Server side (FastMCP, one registry for both uses):
```python
from fastmcp import FastMCP
from townshiplens_spatial.tools import TOOLS            # existing 10 tools

mcp = FastMCP("townshiplens-world-model")
for name, fn in TOOLS.items():                          # fn(world, **args) -> dict; wrap to bind the loaded World
    mcp.tool(name=name, tags={"read_only"})(bind_world(fn))

@mcp.tool
def simulate(actions: list[dict], scenario_id: str, n: int = 200, seed: int = 7) -> dict: ...

if __name__ == "__main__":
    mcp.run(transport="stdio")                           # Claude Desktop / Claude Code; or transport="http"
```
Mount into FastAPI (`/mcp`): `mcp_app = mcp.http_app(path="/")`, then `FastAPI(lifespan=mcp_app.lifespan)` and `app.mount("/mcp", mcp_app)` (see `fastmcp/docs` deployment/ASGI page; if the lifespan is already custom, combine the two). I verified the in-process pattern below in the PydanticAI docs; the mount recipe is from FastMCP docs I have not run.
Client side (PydanticAI 2.x uses `MCPToolset`, built on the FastMCP client; the old `MCPServerStreamableHTTP` classes are the legacy path):
```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset
toolset = MCPToolset(mcp)                                 # in-process, no network hop
# or MCPToolset("http://localhost:8000/mcp")
agent = Agent(model, toolsets=[toolset], output_type=ToolOutput(FinalAnswer, name="final_answer"))
```
Gotcha: our tools append to `TurnRecord` (for the validator) and push SSE events via `ctx.deps`; MCP-served tools have no PydanticAI `RunContext`. Keep the PydanticAI tool wrappers (they record evidence) and have the MCP wrappers call the same pure functions. Do not route our own agent through MCP.
Tests: `pydantic-evals` (same docs site, `Dataset`/`Case`/`Evaluator`) could replace the golden-question runner's scoring; not investigated further; inspire-only.

## 5. Value of information (staff "which fact to verify first")
Libraries found (none cloned; all optional and unnecessary):
- `voiage` (PyPI; EVPI/EVSI, health-economics origin), `bayesdesign` (grid-based EIG), Pyro `contrib.oed.eig` (needs PyTorch), `optbayesexpt` (NIST, instrument control). Version/maintenance not verified. **Reject all**: they assume a parametric likelihood; ours is discrete.
- Roll your own (exact, small):
```python
def voi(world, claim, prior_pass=0.6, tasks=default_tasks(world)):
    """Expected reduction in 'unsure' route outcomes if staff verified `claim`."""
    base = score(world, tasks)                                   # e.g. count of partly_unverified/no_data routes
    w_pass, w_fail = flipped(world, claim, "pass"), flipped(world, claim, "fail")   # sim.py::_flipped already exists
    exp = prior_pass * score(w_pass, tasks) + (1 - prior_pass) * score(w_fail, tasks)
    return (base - exp) * resident_weight(claim)                 # / verification cost (distance, ticket age)
```
`sim.py::_flipped(world, element_id, attribute, profile_id)` and `_pass_value` are the existing hooks. Only evaluate edges that appear on some UNKNOWN-status best route (prune the candidate set to tens). Use the `reported`/`contested` status to set `prior_pass` (reported-yes 0.8, contested 0.5). Present as a ranked ticket list; label it "indicative prioritisation".

## 6. Rollout engine design notes (what to build instead of Mesa)
- State = immutable-ish `WorldState(world, stage_id, closures, added_assets, population)`; `apply(state, action) -> state` is pure; actions are a pydantic discriminated union (`RiverRise`, `ClosePath`, `AddRamp`, `VerifyFact`, `MoveResidents`). Serialise to SSE for the UI timeline.
- Rollout: for each resident `(origin, profile, destination)` call the existing router on the current state; produce a polyline (`[(lon, lat, t_s)]`) by walking edge lengths at profile speed; on stage change at tick `t`, re-route those still en route (this is the dynamic part). Seeded `random.Random(seed)`; output per-tick KPIs (arrived, stuck, rerouted, unknown-crossing).
- Cache routes by `(origin, dest, profile, graph_version)`; 200 agents x a few re-routes is cheap with networkx/our graph.
- Evacuation reference data to compare: Mesa `epstein_civil_violence` for agent loop shape only.

## 7. Cesium: animating ~200 agents cheaply in `requestRenderMode`
Facts to rely on: with `requestRenderMode: true` Cesium draws only when something requests it; if `viewer.clock.shouldAnimate` is true, it renders every frame, so the cheapest design is one clock tick handler mutating a small primitive collection, and turning `shouldAnimate` off when the rollout ends (then one `requestRender()`). Please verify the per-frame behaviour in 1.146 with a quick FPS test; I did not run it.

Preferred: primitives, no Entities (Entities cost per-entity property evaluation + GeometryUpdater).
```ts
// build once per rollout; tracks: {t: Float64Array, lon: Float64Array, lat: Float64Array}[]  (t in seconds from start)
const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
const pts = tracks.map(() => points.add({ position: Cesium.Cartesian3.ZERO, pixelSize: 6,
                                            color: Cesium.Color.CYAN, disableDepthTestDistance: 1e7 }));
const scratch = new Cesium.Cartesian3();
function sample(tr, t, i) {               // binary search interval, then lerp
  let lo = 0, hi = tr.t.length - 1;
  if (t <= tr.t[0]) return [tr.lon[0], tr.lat[0]];
  if (t >= tr.t[hi]) return [tr.lon[hi], tr.lat[hi]];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; (tr.t[m] <= t ? (lo = m) : (hi = m)); }
  const f = (t - tr.t[lo]) / (tr.t[hi] - tr.t[lo]);
  return [tr.lon[lo] + f * (tr.lon[hi] - tr.lon[lo]), tr.lat[lo] + f * (tr.lat[hi] - tr.lat[lo])];
}
let t0 = performance.now(), speed = 20;                    // 20x sim time
viewer.clock.shouldAnimate = true;                         // keeps frames coming
const remove = viewer.clock.onTick.addEventListener(() => {
  const t = ((performance.now() - t0) / 1000) * speed;
  tracks.forEach((tr, i) => {
    const [lon, lat] = sample(tr, t, i);
    Cesium.Cartesian3.fromDegrees(lon, lat, 2, undefined, scratch);
    pts[i].position = scratch;                              // setter copies
  });
  if (t > endT) { viewer.clock.shouldAnimate = false; remove(); viewer.scene.requestRender(); }
});
```
Notes: 200 agents x binary search is microseconds per frame. For ground-clamped agents over Google tiles use a fixed 2 m height (no `clampToGround`/`sampleTerrain` per frame). Colour agents by status (`confirmed` / `partly_unverified` / `stuck`) by setting `pts[i].color` only on status change. Over 5k agents switch to `Primitive` with `PointPrimitive` + `scene.requestRender` throttle, or a custom shader; not needed here. Pause/scrub = store `t` in zustand and render once with `requestRender()`.

Alternative (declarative, good for recording/export): CZML or `SampledPositionProperty`:
```ts
const czml = [{ id: "document", version: "1.0", clock: { interval: `${start}/${end}`, currentTime: start, multiplier: 20, shouldAnimate: true } },
  ...agents.map(a => ({ id: a.id, availability: `${start}/${end}`,
     position: { epoch: start, cartographicDegrees: a.flat /* [t,lon,lat,h, t,lon,lat,h, ...] */, interpolationAlgorithm: "LINEAR" },
     point: { pixelSize: 6, color: { rgba: a.rgba }, disableDepthTestDistance: 1e7 } }))];
viewer.dataSources.add(Cesium.CzmlDataSource.load(czml));
```
Works out of the box with the clock/timeline widget and requestRenderMode (the clock drives renders), roughly 200 entities is fine; per-frame cost grows with entity count, so stay below ~500. Server can emit the CZML directly from the rollout (`GET /rollouts/{id}.czml`), so the same rollout renders in the stylised, Google and (via GeoJSON-T) Mapbox views.
Mapbox/deck.gl: deck.gl `TripsLayer` (`getPath`, `getTimestamps`, `currentTime`, `trailLength`) is the standard pattern for the lite renderer; I could not fetch its repo metadata through the API (`deck-gl/deck.gl` returned not found with the guessed slug; the project is `visgl/deck.gl`, MIT). Mapbox GL alone: update a GeoJSON `circle` source in `requestAnimationFrame`. List view: show the KPI table only.
Entity clustering (`EntityCluster`) is for static billboards; do not use it for moving agents.

## 8. Recommendations table

| Item | Action |
|---|---|
| llm-reasoners `base.py`, `mcts.py`, `beam_search.py` | **copy** into planner package, keep Apache header, record in sources file |
| FastMCP | **depend** (`fastmcp`), expose tool registry, mount at `/mcp` |
| pydantic-graph | **depend** (optional), use for propose->simulate->score pipeline |
| PydanticAI streaming / history | use 4.1(a) replay now, 4.2 history table per session |
| Mesa 4.0.0a0 / mesa-geo | inspire-only (DataCollector idea, model-owns-agents idiom) |
| JuPedSim, AgentTorch (AGPL), OASIS, MATSim, Vadere | reject |
| AgentSociety, Concordia | inspire-only |
| VOI libraries | reject; roll our own (section 5) |
| Cesium | primitives + clock tick (section 7); CZML for export |

## 9. Sources
- https://github.com/maitrix-org/llm-reasoners (Apache-2.0)
- https://github.com/projectmesa/mesa (Apache-2.0), https://github.com/projectmesa/mesa-geo (Apache-2.0)
- https://github.com/PrefectHQ/fastmcp (Apache-2.0)
- https://github.com/PedestrianDynamics/jupedsim, https://github.com/AgentTorch/AgentTorch (AGPL-3.0), https://github.com/tsinghua-fib-lab/AgentSociety, https://github.com/camel-ai/oasis, https://github.com/google-deepmind/concordia (not cloned)
- PydanticAI docs https://pydantic.dev/docs/ai/core-concepts/output, /core-concepts/message-history, /mcp/client, /api/pydantic-ai/mcp (via Context7 `/websites/pydantic_dev_ai`)
- Papers: https://arxiv.org/pdf/2608.23622, https://arxiv.org/pdf/2603.19649 (titles only; not read)

REPO|world-models|https://github.com/projectmesa/mesa
REPO|world-models|https://github.com/projectmesa/mesa-geo
REPO|world-models|https://github.com/maitrix-org/llm-reasoners
REPO|world-models|https://github.com/PrefectHQ/fastmcp
