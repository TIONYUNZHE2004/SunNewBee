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

## Designs that inspired our code (no code copied)

| Source | Licence | Idea used | Where |
|---|---|---|---|
| [maitrix-org/llm-reasoners](https://github.com/maitrix-org/llm-reasoners) | Apache-2.0 | `WorldModel` / `SearchConfig` split and beam search over actions | `packages/spatial/.../twm.py` (state / actions / transition), `fixit.py` (beam search over intervention sets) |
| [projectmesa/mesa](https://github.com/projectmesa/mesa) | Apache-2.0 | "model owns agents" and the per-step data-collector pattern | `packages/spatial/.../rollout.py` (per-stage counts per persona) |
| [PrefectHQ/fastmcp](https://github.com/PrefectHQ/fastmcp) docs | Apache-2.0 | server and in-memory client usage (a dependency, pinned 4.0.9) | `packages/agent/.../mcp_server.py` |

Papers behind the design are listed in [docs/02-research/world-models-2026.md](docs/02-research/world-models-2026.md).
