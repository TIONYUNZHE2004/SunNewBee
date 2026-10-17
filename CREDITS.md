# Credits: copied code and reused designs

The team lead ruled on 16 Oct 2026 that any licence is acceptable for this hackathon (see the "Dependencies and copied code" rule in [AGENTS.md](AGENTS.md)).

Every piece of code copied from another repository is listed here with:
- its source URL;
- its licence;
- the files it came from;
- where it now lives.

Designs that only *inspired* our own code are listed separately, so reviewers can tell the two apart.

Direct dependencies (pinned in `pyproject.toml` and `package.json` files) carry their own licences and are not repeated here.

## Copied code

| Source | Licence | Copied from | Lives in | Notes |
|---|---|---|---|---|
| *(none yet)* | | | | |

## Third-party assets

3D models taken from other sources for the Three.js city (`assets/blender/vendor/`, recorded in `assets/blender/vendor/vendor.json`). Only `.glb` sources are committed, never `.blend`. Each is normalised by `tl_assets.props.import_vendor` (materials become vertex roles, images are dropped) and packed into `apps/web/public/city/`.

| Asset | Source URL | Author | Licence | Files | Lives in |
|---|---|---|---|---|---|
| *(none yet)* | | | | | |

## Designs that inspired our code (no code copied)

| Source | Licence | Idea used | Where |
|---|---|---|---|
| [maitrix-org/llm-reasoners](https://github.com/maitrix-org/llm-reasoners) | Apache-2.0 | `WorldModel` / `SearchConfig` split and beam search over actions | `packages/spatial/.../twm.py` (state / actions / transition), `fixit.py` (beam search over intervention sets) |
| [projectmesa/mesa](https://github.com/projectmesa/mesa) | Apache-2.0 | "model owns agents" and the per-step data-collector pattern | `packages/spatial/.../rollout.py` (per-stage counts per persona) |
| [PrefectHQ/fastmcp](https://github.com/PrefectHQ/fastmcp) docs | Apache-2.0 | server and in-memory client usage (a dependency, pinned 4.0.9) | `packages/agent/.../mcp_server.py` |
| [camel-ai/oasis](https://github.com/camel-ai/oasis) | Apache-2.0 | The Reddit "hot" score (`sign·log10(likes) + age/45000`, re-expressed in simulated minutes), the feed of hot-ranked posts per agent, and engine events injected into the feed (`ManualAction`) | `packages/spatial/.../day/spotlight.py` (`hot`, `rank`, `notices`); `packages/agent/.../day_voice.py` (`feed` rounds) |
| [tsinghua-fib-lab/AgentSociety](https://github.com/tsinghua-fib-lab/AgentSociety) | Apache-2.0 | Whole-day plans as segments (the v2 daily-guidance "story"); gravity destination choice (1/d² among the nearest); move along a route and interpolate at constant speed (MobilitySpace); 5-minute steps | `packages/spatial/.../day/schedule.py`, `engine.py`; `apps/web/.../day/dayModel.ts` |
| [666ghj/MiroFish](https://github.com/666ghj/MiroFish) | AGPL-3.0 (ideas only, no code) | Spotlight personas with a voice, activity-gated agents per round, a feed of posts and replies, interviews with simulated agents, and a report whose numbers come only from the run's aggregates | `packages/spatial/.../day/spotlight.py`, `voices.py`; `packages/agent/.../day_voice.py` |

Papers behind the design are listed in [docs/02-research/world-models-2026.md](docs/02-research/world-models-2026.md).
