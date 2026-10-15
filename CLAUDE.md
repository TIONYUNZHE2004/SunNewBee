# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The shared, tool-agnostic project instructions live in AGENTS.md: commands, architecture, honesty invariants, conventions, data pipeline and secrets. They are imported here so Claude Code and other agents follow one source of truth. Edit AGENTS.md for anything every agent should know. Keep this file for Claude Code–specific workflow.

@AGENTS.md

## Claude Code workflow in this repo

- **Verify before claiming done.** Run the CI-equivalent checklist from AGENTS.md with `set -o pipefail`.
  - Report each check as PASS / FAIL / BLOCKED / NOT RUN.
  - Say when a result is mock-backed (mock LLM, tiny fixture) rather than live.
  - "Implemented", "tested", "pushed" and "deployed" are different states; say which one applies.
- **Browser checks:**
  - UI changes should be checked in the built-in browser via `preview_start`. `.claude/launch.json` (tracked) defines `townshiplens-dev` (`pnpm dev`), `townshiplens-dev-mock` (`LLM_PROVIDER=mock`) and `townshiplens-dev-demo` (`+ DEMO_MODE=true`), all on :5173.
  - Prefer `get_page_text` / `read_page` over screenshots.
  - Every 3D page load fetches billable Google tiles, so use the List view when 3D isn't the point.
  - A preview server can keep running during e2e, because Playwright uses its own ports (5273/8100).
- **Cost guardrails:**
  - Default to `LLM_PROVIDER=mock`.
  - Run a live OpenRouter smoke test only when asked or clearly needed, keep it to a few turns, and say so.
  - Never `--record` the demo cache with a live model (the CLI refuses without `--allow-live`).
- **Library docs:** look up current docs before using an API you aren't sure of. Pinned versions matter here: PydanticAI 2.56, FastAPI 0.143, Cesium 1.146 / Resium 1.27, Mapbox GL 3.33, Vite 8, Tailwind 4, vitest 5, Playwright 1.64.
- **Parallel work uses git worktrees** under `../SunNiuBi-wt/<lane>` (branches `lane/be`, `lane/fe`, `lane/ai`, `lane/data`, `lane/fe-manage`).
  - Subagents commit on their lane branch and never push to `main`.
  - The coordinator merges with `--no-ff`, runs the full checklist, then pushes.
  - Subagent-driven-development ledgers, briefs and review packages live in `.superpowers/sdd/<plan>/` (gitignored). Trust the ledger plus `git log` over memory after a context reset.
- **Plans and logs:**
  - Implementation plans: `docs/superpowers/plans/`, e.g. `2026-10-15-mvp-p0-increment-1.md` with Tasks 15–36.
  - Spec: `docs/superpowers/specs/2026-10-15-platform-walking-skeleton-design.md`.
  - Status: `docs/03-product/mvp-spec.md`.
  - Append notable decisions as rulings ("Ruling: what — why — cost if wrong") to the plan's ledger, and log long runs in `docs/superpowers/overnight-log.md` using real `date` timestamps.
- **Hooks and permissions:** if a git push or remote change is blocked by the harness, report it; don't work around it. The GitHub remote has moved: pushes print a "moved" notice and redirect to `TIONYUNZHE2004/SunNewBee`.

## Gotchas seen in this repo

- `uv sync --all-groups` without `--all-packages` silently uninstalls the workspace packages, giving `ModuleNotFoundError: townshiplens_spatial`.
- Staging an untracked file before `git merge` can make the merge abort ("Merge with strategy ort failed"). Stage explicit paths (never `git commit -am`) so unrelated edits aren't swept in.
- The Cesium viewer runs with `requestRenderMode`: anything that changes the scene must call `viewer.scene.requestRender()`. Tile loads are wired to `loadProgress` / `allTilesLoaded`. Changing a read-only `<Viewer>` prop under HMR recreates the viewer and logs harmless `scene` TypeErrors. Reload before judging the console.
- Cesium static assets must land at `/cesium/<Dir>/…` (`vite-plugin-static-copy` with `rename.stripBase: 4`). `pnpm --filter @tl/web build` fails if they don't.
- Ground polylines over Google tiles are pickable via `scene.drillPick` (with an 8 px window). Place markers take priority, so a click near a dense cluster opens a place card instead of "Why this path?".
- The local `.data/<site>.db` persists verification requests between runs. Delete it (with the server stopped) for a clean demo.
