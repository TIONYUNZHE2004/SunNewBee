# Yunzhe's agent branch workflow

> **Personal workflow, not team policy.** It applies only to Yunzhe's branches and AI agents. The team's rules stay in [dev-setup.md § 4](dev-setup.md) and [AGENTS.md](../../AGENTS.md). Where they disagree, the team rules win for `main`.

Several AI agents (Claude, GPT/Codex and others) work in parallel. Each agent works on its own branch. One control branch collects their work, resolves conflicts and tests it. It sends an update to `main` **only when Yunzhe says so**. A separate board branch carries the task list and the feedback between agents.

## Branches

```
main                              team branch (Jun Quan, shaoxian04, Yunzhe); changes arrive by PR only
 └── claude/sweet-davinci-29v7ne  CONTROL branch (Yunzhe's lead Claude session)
      ├── claude/kind-cannon-mormhi   worker: Claude session
      ├── codex/yunzhe-workflow       worker: Codex session
      └── <agent>/<branch>            any later worker

yunzhe/agent-board                BOARD branch: tasks and logs only; separate history, never merged anywhere
```

| Branch | Role | Who writes to it |
|---|---|---|
| `main` | Team trunk. CI runs on every push. | Team, by PR (squash merge, one approval; see dev-setup.md) |
| `claude/sweet-davinci-29v7ne` | Control: pull `main`, merge workers, resolve conflicts, test. PR to `main` only on Yunzhe's instruction | The control session only |
| `claude/kind-cannon-mormhi` | Worker | Its own Claude session only |
| `codex/yunzhe-workflow` | Worker | Its own Codex session only |
| `yunzhe/agent-board` | Board: `BOARD.md`, `README.md`, `tasks/` | Control edits the board and task headers; every agent appends to task logs. Never merged into control or `main` |
| `<agent>/<task>` (for example `codex/flood-copy`) | Worker | Its own agent only |

Active workers (keep this table current):

| Branch | Agent | Task | Status |
|---|---|---|---|
| `claude/kind-cannon-mormhi` | Cloud Claude worker | Finish T-001, then stop | T-002, T-003 merged (PR #8) |
| `codex/yunzhe-workflow` | Cloud Codex worker | T-015 answer-key refresh; checks other agents' PRs; no product code | T-008, T-011, T-012 merged (PR #7) |
| `local/ai-engineer` | Local Claude (`sophist-purring-aurora`) | T-013 scope gate, T-017 AI audit | Started 18 Oct |
| `local/backend-engineer` | Local Codex | T-016 backend audit, T-014 sidewalk vs road (with T-010) | Started 18 Oct |
| `claude/sweet-davinci-29v7ne` | Control | Merge green PRs, keep the board; T-007 on Yunzhe's instruction | — |

The board branch holds the current owner and status of every task; this table is only a summary.

## Product scope: B+ (17-18 Oct 2026)

Small field, highest accuracy. The resident assistant covers:

- **Access:** routes, place facts, nearby amenities, closures, tickets for gaps.
- **Flood evacuation:** indicative river stages, affected places, evacuation centres, routes under a stage.

It never refuses a question because of its wording. Routes and places anywhere in Elmina are answered; outside the **deep spot (Elmina Urban Park + Elmina Lakeside Mall frontage)** the answer says the facts come from OpenStreetMap only. The deep spot stays the accuracy target, measured on a human-checked answer key. Only clearly removed topics (waste, what-if, tipping point, rising river, fix-it, verify-next planner, Elmina Day) are refused. That code stays in the repo and the staff screens; agents do not extend it unless Yunzhe asks.

## Local agents on Yunzhe's computer

Each local agent works in its own git worktree, so agents never edit the same folder and Yunzhe's own folder keeps running `pnpm dev`.

| Agent | Folder | Branch | Its own ports |
|---|---|---|---|
| Local AI engineer (Claude) | `../SunNewBee-ai` | `local/ai-engineer` | `API_PORT=8011 WEB_PORT=5181` |
| Local backend engineer (Codex) | `../SunNewBee-backend` | `local/backend-engineer` | `API_PORT=8021 WEB_PORT=5191` |

- Each worktree has its own `.env` copy, `pnpm install` and `uv sync --all-packages --all-groups`.
- The worktree branches were created tracking control. Before the first push, run `git branch --unset-upstream`, then always push with `git push -u origin <own branch>`.
- Local agents do not run e2e (fixed ports 5273/8100 would clash); GitHub CI runs it on their PRs.
- Live OpenRouter budget per day: AI engineer up to US$2, backend engineer up to US$0.50. Rounds of at most 10 live questions; log model, turns and cost per round on the board.

## My scope (who owns what)

Team lanes as agreed (17 Oct 2026; paths from [dev-setup.md](dev-setup.md)): **Jun Quan = Backend**, **shaoxian04 = Frontend**, **Yunzhe = AI + docs/pitch/research**. Jun Quan also works in the AI lane, so AI changes can clash with his.

| Area | Paths | Owner | What my agents may do |
|---|---|---|---|
| **AI** (mine) | `packages/agent/**`, `evals/**`, AI docs (`docs/04-architecture/ai-*`, `docs/02-research/ai-*`) | Yunzhe (Jun Quan also active) | Change freely. First run `git log --oneline -10 origin/main -- packages/agent evals` to see Jun Quan's recent work, and name him in the PR to `main` when you change code he touched |
| **Docs, pitch, research** (mine) | `docs/02-research/`, `docs/03-product/`, `docs/06-pitch/`, `docs/04-architecture/` | Yunzhe | Change freely |
| Shared docs | `docs/superpowers/` (plans, logs), `docs/00-overview/decisions/` (ADRs), `README.md`, `AGENTS.md`, `CLAUDE.md` | Everyone | Logs are append-only. Ask Yunzhe before changing team rules (`AGENTS.md`, `CLAUDE.md`) or an ADR |
| Tool layer | `packages/spatial/src/townshiplens_spatial/tools.py` | Functions: Backend. Tool descriptions and schemas: AI ([roles.md](roles.md)) | Change descriptions freely; keep function changes minimal |
| **Backend** | `packages/spatial/**`, `apps/api/**`, `data/scripts/**`, `config/profiles/**`, `data/**` (backend merges) | Jun Quan | Allowed when a board task needs it (Yunzhe, 17 Oct). Keep it to what the task needs, follow the data-pipeline rules in AGENTS.md, and list every file in the PR under "Touches Backend" so Jun Quan can review it |
| **Frontend** | `apps/web/**` | shaoxian04 | Only the smallest change an AI feature needs (for example the mirrored `attributeCatalogue.ts`). List it in the PR under "Touches Frontend" |
| Generated | `packages/api-client/**` | Nobody edits by hand | Run `pnpm gen` and commit the result |

An AI feature often needs a small Backend or Frontend change (the road-crossings work touched `routing.py`, `models.py`, `import_osm.py` and `attributeCatalogue.ts`). That is allowed. Keep it minimal, keep the mirrored files in step, and list each touched file in the PR so its owner can review it.

## Flow

1. **Control pulls from the team.** Whenever `main` moves, control merges `origin/main` in. Pulling needs no instruction.
2. **A worker starts from control.** Before each task it merges `origin/claude/sweet-davinci-29v7ne` into its own branch, not `main`.
3. **A worker opens a PR into control,** never into `main`. CI runs on every PR, whatever its base (`ci.yml`: `pull_request: {}`).
4. **Control merges workers one at a time,** only PRs with green CI. It fixes conflicts on the control branch, not on the worker branch, and then runs only the checks that fit the conflict it resolved.
5. **Control waits for Yunzhe.** It opens a PR into `main` only when Yunzhe says so ("send to main"). It never opens one, or pushes toward `main`, on its own, even when everything is green. Yunzhe merges it.
6. **After that merge,** control merges `origin/main` back in (step 1), and workers merge control back in before they continue.

## Files every agent reads first

| File | Who | Why |
|---|---|---|
| `docs/05-team/yunzhe-branch-workflow.md` (this file) | Every agent | Branches, flow, rules |
| `BOARD.md`, `README.md` and your task file on branch `yunzhe/agent-board` (`git show origin/yunzhe/agent-board:BOARD.md`) | Every agent | Which tasks exist, who owns them, feedback between branches. The board branch is never merged into control or `main` |
| `AGENTS.md` | Every agent | Commands, architecture, honesty invariants, conventions |
| `CLAUDE.md` | Claude only (loads by itself) | Claude workflow, cost guardrails, gotchas |
| The README of the area you change: `apps/web/`, `apps/api/`, `packages/spatial/`, `packages/agent/`, `data/` | The agent working there | How that area works |
| `docs/05-team/dev-setup.md` | When setup fails | Local setup and the team's git rules |

## Control session: start of every task

Before it does anything else, including answering a question about the code or the branches, the control session:

1. Runs `git fetch origin` (and `git fetch --unshallow origin` once, if the clone is shallow).
2. Lists every worker branch with commits that control does not have (`git log --oneline HEAD..origin/<branch>`), and reports them, including new task-log entries on the board branch `yunzhe/agent-board`.
3. Merges `origin/main` if it moved, and merges what Yunzhe approves (only PRs with green CI), then starts the task. It does not send anything to `main` unless Yunzhe asks.

When it reports branch state, it says when it fetched ("as of 14:05 fetch"). A worker's push is invisible to control until the next fetch, so a report without a fetch time may be stale.

Once a worker has an open PR into control, the control session subscribes to it, so GitHub wakes it on the worker's pushes and CI results.

## When a worker is done

The worker commits, runs the local checks that fit the change, runs `git push -u origin <its branch>`, and opens or updates its PR into `claude/sweet-davinci-29v7ne`. GitHub CI then runs the full checks. When CI is green, the worker tells Yunzhe the PR link. Nothing reaches control until it is merged.

## Rules for every worker agent

Read these before the first change:

1. Read [AGENTS.md](../../AGENTS.md): commands, architecture, honesty invariants, conventions. Claude also reads [CLAUDE.md](../../CLAUDE.md).
2. Work only on your own branch. Never push to `main` or to the control branch.
3. Stay in your area (`apps/web`, `apps/api`, `packages/spatial`, `packages/agent`, `data/`, `docs/`). If you must touch another area, say so in the PR.
4. Merge, never rebase or force-push, on a branch that another agent uses.
5. Commit in Conventional style with a scope (`feat(web): …`, `fix(agent): …`, `docs: …`). Commit data regeneration separately from code.
6. Before you say "done", run the local checks that fit the change (see "Checks"), open or update the PR, and report the GitHub CI result. Report each check as PASS / FAIL / BLOCKED / NOT RUN.
7. Use the mock LLM (`LLM_PROVIDER=mock`) by default. OpenRouter is set up in the Claude and Codex environments: use it only when your task needs a live check, keep it to at most 10 live turns per task unless Yunzhe allows more, and log the model and turn count in the task log. Never `--record` the demo cache with a live model. Never print keys or `.env` values.
8. Keep the honesty invariants true (AGENTS.md table). The validator, mock and template change together.

## Checks: match them to the change

GitHub CI runs all 7 checks below on every PR, on GitHub's machines (`.github/workflows/ci.yml`). That costs no agent time or tokens, so agents do **not** repeat the full list locally.

| Change | Run locally | Full 7 checks |
|---|---|---|
| Docs or board only | Nothing | Not needed |
| While working on code | Only the tests for the files you touched, e.g. `uv run pytest packages/agent/tests/test_validate.py -q` | No |
| Before opening or updating a PR | Those tests and `pnpm lint`, plus the extra checks that apply (below) | GitHub CI on the PR. Read its result; if it is red, fix it |
| Control after merging into control | Nothing | CI on the control → `main` PR. Nothing reaches `main` without it passing |

Extra local checks, only when they apply:

- `validate.py`, `mock.py`, `template.py`, `run.py` or prompts changed: `pnpm golden`.
- An API model or route changed: `pnpm gen && git diff --exit-code packages/api-client`.
- `apps/web` changed: `pnpm --filter @tl/web exec vitest run <changed test files>` and `pnpm -r --if-present typecheck`; e2e only if a screen changed.

Run the full list locally only when CI cannot (CI is down) or Yunzhe asks. The full list, from the repo root with `set -o pipefail`:

1. `pnpm lint`
2. `uv run pytest -q`
3. `pnpm -r --if-present typecheck`
4. `pnpm -r --if-present test`
5. `pnpm gen && git diff --exit-code packages/api-client`
6. `pnpm golden`
7. `pnpm --filter @tl/web e2e`

## Resolving conflicts on the control branch

| File | Do this |
|---|---|
| `packages/api-client/*` (generated) | Take either side, then run `pnpm gen` and commit the result |
| `pnpm-lock.yaml`, `uv.lock` | Take either side, then run `pnpm install` / `uv sync --all-packages --all-groups` |
| `docs/superpowers/overnight-log.md` | Append-only: keep both sides, in time order |
| `data/seed/**` | Never merge by hand. Rebuild with the data scripts (AGENTS.md "Data pipeline") |
| Same logic changed on both sides | Stop and ask Yunzhe if either choice loses behaviour |

## Before comparing branch history

Cloud sessions clone the repo **shallow** (recent commits only). Ahead/behind counts, root commits and "shared history" checks are wrong on a shallow clone. Run this first:

```bash
git rev-parse --is-shallow-repository   # true means: fetch the full history first
git fetch --unshallow origin
```

(17 Oct: a shallow clone made `main` look restarted on 16 Oct. It was not. `backup/main-2026-10-16` is an older `main` and is fully inside `main`.)

## Prompt template for a new agent

```
You are a worker agent on TownshipLens. Read docs/05-team/yunzhe-branch-workflow.md, AGENTS.md and the board README (git show origin/yunzhe/agent-board:README.md) first.
Branch: your own branch. Before each task, merge origin/claude/sweet-davinci-29v7ne into it.
Task: T-<NNN> from the board (git show origin/yunzhe/agent-board:BOARD.md, then its task file). You may push to two branches only: your own code branch and yunzhe/agent-board (log entries only, as its README says). Log progress, findings and questions as you go.
Scope: product scope B (access + flood evacuation, deep spot). Read "Product scope" and "My scope" in the workflow doc; list any Backend or Frontend file you touch in the PR.
When done: run the local checks that fit the change (workflow doc, "Checks"), push your branch, update your PR into claude/sweet-davinci-29v7ne (not main), and report the GitHub CI result.
```

## Why this structure

- **One place to fix conflicts.** Agents do not see each other's work. If each one merged straight into `main`, the team would get the conflicts. Control takes them first.
- **One tested update for the team.** `main` gets one PR, and GitHub CI runs the full checks on it, not many small risky ones.
- **Agents stay simple.** Each agent knows one branch, one task and one target (control).
- **The control session knows everything.** Every worker's change passes through it, so the control session can answer for the whole of Yunzhe's work.
