# Yunzhe's agent branch workflow

> **Personal workflow, not team policy.** It applies only to Yunzhe's branches and AI agents. The team's rules stay in [dev-setup.md § 4](dev-setup.md) and [AGENTS.md](../../AGENTS.md). Where they disagree, the team rules win for `main`.

Several AI agents (Claude, GPT/Codex and others) work in parallel. Each agent works on its own branch. One control branch collects their work, resolves conflicts and sends one tested update to `main`.

## Branches

```
main                              team branch (Jun Quan, shaoxian04, Yunzhe); changes arrive by PR only
 └── claude/sweet-davinci-29v7ne  CONTROL branch (Yunzhe's lead Claude session)
      ├── claude/kind-cannon-mormhi   worker: Claude session (AI investigation docs)
      ├── <agent>/<task>              worker: one branch per agent task
      └── ...
```

| Branch | Role | Who writes to it |
|---|---|---|
| `main` | Team trunk. CI runs on every push. | Team, by PR (squash merge, one approval; see dev-setup.md) |
| `claude/sweet-davinci-29v7ne` | Control: merge, resolve conflicts, test, then PR to `main` | The control session only |
| `claude/kind-cannon-mormhi` | Worker | Its own Claude session only |
| `<agent>/<task>` (for example `codex/flood-copy`) | Worker | Its own agent only |

Active workers (keep this table current):

| Branch | Agent | Task | Status |
|---|---|---|---|
| `claude/kind-cannon-mormhi` | Claude (other session) | AI investigation, model comparison and failover, road crossings | Running. Carries old history; pull with `--squash` only (see below). Last pulled: `79eb6ef` (17 Oct) |

## Flow

1. **Control starts from the team.** Merge `origin/main` into the control branch before work is handed out.
2. **A worker starts from control.** It creates its branch from `claude/sweet-davinci-29v7ne`, not from `main`.
3. **A worker opens a PR into control,** never into `main`. CI runs on every PR, whatever its base (`ci.yml`: `pull_request: {}`).
4. **Control merges workers one at a time.** After each merge it runs the full checklist (below). It fixes conflicts on the control branch, not on the worker branch.
5. **Control opens one PR into `main`** when the checklist passes. The team reviews and squash-merges it.
6. **After that merge,** control merges `origin/main` back in, and workers merge control back in before they continue.

## Rules for every worker agent

Read these before the first change:

1. Read [AGENTS.md](../../AGENTS.md): commands, architecture, honesty invariants, conventions. Claude also reads [CLAUDE.md](../../CLAUDE.md).
2. Work only on your own branch. Never push to `main` or to the control branch.
3. Stay in your area (`apps/web`, `apps/api`, `packages/spatial`, `packages/agent`, `data/`, `docs/`). If you must touch another area, say so in the PR.
4. Merge, never rebase or force-push, on a branch that another agent uses.
5. Commit in Conventional style with a scope (`feat(web): …`, `fix(agent): …`, `docs: …`). Commit data regeneration separately from code.
6. Before you say "done", run the checklist and report each step as PASS / FAIL / BLOCKED / NOT RUN.
7. Use the mock LLM (`LLM_PROVIDER=mock`). Never print `.env` values.
8. Keep the honesty invariants true (AGENTS.md table). The validator, mock and template change together.

## Checklist (same as CI)

Run from the repo root with `set -o pipefail`:

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

## Old history: pull `kind-cannon` with `--squash`

`main` was restarted on 16 Oct 2026 with new history. It shares no commit with `backup/main-2026-10-16`. The old history holds about 166 MiB of files that are not in `main`, including about 127 MiB of research PDFs (`reference/papers/**/*.pdf`, now in `.gitignore`).

`claude/kind-cannon-mormhi` contains that old history. A normal merge would bring all of it back into control and then into `main`. So control takes its **content only**:

```bash
git fetch origin claude/kind-cannon-mormhi
git merge --squash origin/claude/kind-cannon-mormhi   # stages the changes, adds no old commits
git commit -m "docs(ai): bring in kind-cannon work (squashed)"
```

Repeat the same command for later updates. Content that is already on control usually merges cleanly, because both sides hold the same change.

To fix this permanently, the `kind-cannon` session can restart its branch from `origin/main` and copy its own files across. New workers that start from control never have this problem.

## Prompt template for a new agent

```
You are a worker agent on TownshipLens. Read docs/05-team/yunzhe-branch-workflow.md and AGENTS.md first.
Branch: create <agent>/<task> from origin/claude/sweet-davinci-29v7ne.
Task: <one task, one area>.
When done: run the checklist, report PASS/FAIL per step, push your branch and open a PR into claude/sweet-davinci-29v7ne (not main).
```

## Why this structure

- **One place to fix conflicts.** Agents do not see each other's work. If each one merged straight into `main`, the team would get the conflicts. Control takes them first.
- **One tested update for the team.** `main` gets one PR that already passed the full checklist, not many small risky ones.
- **Agents stay simple.** Each agent knows one branch, one task and one target (control).
- **The control session knows everything.** Every worker's change passes through it, so the control session can answer for the whole of Yunzhe's work.
