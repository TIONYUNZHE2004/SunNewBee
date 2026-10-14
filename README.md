# TownshipLens

**A 3D world model of the township that residents and managers can ask anything, and trust the answer.**

Team SunNiuBi · [Sime Darby Property University Hackathon 2026](https://www.simedarbyproperty.com/universityhackathon) ("Township of Tomorrow") · **People** track

TownshipLens turns **City of Elmina** (Shah Alam) into a living 3D model with "lenses" on top. Residents ask how to reach a place ("Can I push a stroller from the mall car park to the playground without stairs?") and get a **verified** step-free route. Managers rehearse "what if the river rises?" and see which paths, facilities and residents get cut off, and where people can evacuate (indicative scenarios, never a forecast). An AI assistant answers only from checked data, says honestly what hasn't been verified, and turns every gap into a ranked task for the township team.

Lenses: **accessibility** (deep), **flood what-if** (deep), **recycling/waste** (thin); data-centre siting is roadmap only. Hero view: CesiumJS + Google photoreal 3D tiles, with a Mapbox lite view and a text/list view.

Site: **whole City of Elmina** in 3D, with deep verified detail at **Elmina Urban Park + Elmina Lakeside Mall frontage**.

| Date | Milestone |
|---|---|
| 23 Oct 2026 | Proposal submission |
| 28 Oct 2026 | Top 10 announced |
| 11 Nov 2026 | Final submission |
| 14 Nov 2026 | Top 10 pitch day |
| 3 Dec 2026 | Final presentation & awards |

## Repository

| Path | What |
|---|---|
| [`docs/`](docs/README.md) | **Knowledge base: start here.** Brief, research, product spec, architecture, team plan, pitch |
| [`reference/`](reference/README.md) | Papers (PDF), cloned reference repos (gitignored, use `reference/clone-repos.sh`), source notes |
| `apps/`, `packages/`, `config/`, `data/`, `evals/` | Code (to be scaffolded, see [docs/05-team/dev-setup.md](docs/05-team/dev-setup.md)) |

## Quick start
1. `cp .env.example .env` (optional: add keys; everything works without them)
2. `pnpm install && uv sync --all-packages`
3. `pnpm dev` → web http://localhost:5173 · API http://localhost:8000/docs
