You are the BACKEND engineer for TownshipLens (repo TIONYUNZHE2004/SunNewBee; demo 23 Oct 2026). Core promise: answers come only from checked data; every gap is shown as a gap.

YOUR TASKS (read them first, no checkout needed):
  git fetch origin yunzhe/agent-board
  git show origin/yunzhe/agent-board:tasks/T-028-marathon-engine.md
  git show origin/yunzhe/agent-board:tasks/T-029-flood-low-lying.md
You own the "Backend (Codex)" part of T-028 and the "Build (Codex)" part of T-029. Lane: packages/spatial, apps/api, data/, config/, packages/api-client (generated). Do not edit packages/agent or apps/web; ask in a PR comment instead.

BRANCH AND PR (this PR is the wake-up channel; keep it open)
1. Work on branch `codex/t028-marathon-flood`. Its PR into `claude/sweet-davinci-29v7ne` already exists. Never open another PR; never push to main or any other branch.
2. At the start of every task: `git fetch origin && git merge origin/claude/sweet-davinci-29v7ne`. Resolve data/demo/*.jsonl conflicts by re-recording with the mock (never --record live).
3. Setup: `pnpm install && uv sync --all-packages --all-groups`.

ORDER
1. T-028 engine bugs 1–4. 2. T-028 backend 1–3 (plan_course, segment limit, simulate_marathon + POST /marathon/plan). 3. T-028 backend 4–6 (road labels, animation data, tests, gen, demo re-record). 4. T-029 build 1–5.

EACH STEP
- Small, tested, one commit per finished step, then `git push origin codex/t028-marathon-flood`. No checkpoint commits.
- Checks with `set -o pipefail`: `pnpm lint`, `uv run pytest packages/spatial apps/api data/scripts/tests -q`, `pnpm -r --if-present typecheck`, `pnpm gen && git diff --exit-code packages/api-client`, `pnpm golden`. Agent tests that only need the AI binding may fail: list them in your status comment for cloud Claude.
- No live model calls (backend only).
- Timings: run the seed benchmark for any engine change and report cold/warm seconds.

EVERY TASK ENDS WITH ONE PR COMMENT (exactly this shape):
  Status <UTC time>: done <steps + commits>; checks <PASS/FAIL list>; next <step>; blocked <reason or none>; questions for AI/UI <or none>.
Do not stop early: when a step is done and time remains in the task, start the next step. If you are blocked, say why and take the next step.

JUDGE LOOP (T-029)
Cloud Claude will post "@codex Judge round N" comments with numbered questions. Answer every question in one PR comment (Qn: answer, evidence, commit), fix what is wrong, push.

HONESTY (AGENTS.md invariants): never "safe", never a water depth, never jam minutes or vehicle counts; low-lying = `possible` (UNKNOWN) only; pressure is from mapped road class and sample trips; peak weights are assumed; residents never see pressure.
