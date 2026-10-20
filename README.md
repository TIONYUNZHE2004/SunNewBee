# Agent task board

> Branch `yunzhe/agent-board`. It holds only this board, shares no history with `main`, and is **never merged** into any other branch. Part of [Yunzhe's agent branch workflow](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/05-team/yunzhe-branch-workflow.md).

Every agent reads this branch to see the tasks, who works on each one, and the feedback between branches. Code and docs still go through the worker → control → `main` flow; only the board lives here.

```
README.md        how the board works (this file)
BOARD.md         index of every task and its status; only the control session edits it
tasks/T-NNN-<slug>.md   one file per task: header, goal, acceptance, log
```

## Fewer commits (Yunzhe, 20 Oct)

`main` has 1,212 commits; 131 of the last 566 were board logs from our agents. Rules:
1. **Board: one commit per round** (status + log lines together), at the round end. No "checkpoint", "start" or "idle" commits.
2. **Code: one commit per finished, tested step.** Docs, README and audit notes ride in the same commit as the code they describe.
3. **No evidence dumps in git** (probe JSON, live logs) unless the task asks for them; summarise in the task log.
4. **Our PRs into `main` use "Squash and merge"**: one commit per PR. Control then resets davinci to `main`.
5. Report to Yunzhe only at the end of a task, or when blocked.

## Talking to Yunzhe

Every reply and log entry follows "How to talk to Yunzhe" in `docs/05-team/yunzhe-branch-workflow.md`: answer first, short, about 70% ASD-STE100, one recommended option with its reason, label what is not verified.

## Who writes what

| File or part | Who edits it |
|---|---|
| `BOARD.md`, new task files, task headers (`Status`, `Owner`, `Branch`) | Control session only |
| Task `## Log` | Any agent, **append only** (never edit or delete an entry) |

## Status values

`open` (nobody yet) → `assigned` → `in-progress` → `review` (PR open into control) → `done` (merged into control). Also `blocked` (the log says why), `parked` (out of the current scope; kept for later) and `handoff` (owned outside Yunzhe's agents; tracked here only).

## Read the board

```bash
git fetch origin yunzhe/agent-board
git show origin/yunzhe/agent-board:BOARD.md
git show origin/yunzhe/agent-board:tasks/T-001-validator-fact-binding.md
```

## Write a log entry

Use a separate worktree **outside the repo folder**, so board files never mix with your code branch:

```bash
# once per session
git fetch origin yunzhe/agent-board
git worktree add -B yunzhe/agent-board /tmp/agent-board origin/yunzhe/agent-board

# every entry
cd /tmp/agent-board
git pull --rebase origin yunzhe/agent-board        # get the latest first
# append one line at the end of the task's ## Log:
#   - 2026-10-17 08:40 UTC · <agent> (<your code branch>) · <progress, finding, question or feedback>
git add tasks/<file>.md
git commit -m "board(T-NNN): <short summary>"
git push origin yunzhe/agent-board                   # rejected? pull --rebase again, then push
```

Use the real time from `date -u '+%Y-%m-%d %H:%M UTC'`. Feedback on someone else's task goes in **that task's** log, signed with your name.

`pull --rebase` only replays your own unpushed board commits on top of the latest board. Never force-push this branch.

## When to do what

| Who | When | Action |
|---|---|---|
| Every agent | Start of every session and before every task | Fetch and read `BOARD.md` and your task file |
| Worker | Starting a task | Log "started" and push the board |
| Worker | Finding, blocker or question | Log it and push the board straight away |
| Worker | Done | Run only the local checks that fit the change (workflow doc, "Checks"); push your branch and log "ready for PR" with the commit. Control opens the PR into control (local agents cannot create PRs). GitHub CI runs the full 7; control logs the PR link and CI result |
| Control | On every fetch | Read new log entries; update headers and `BOARD.md` |

## Rounds (so work survives usage limits)

Agents work in **rounds**. A timer starts each round; a round can be cut off by a usage limit at any time, so all state lives here, not in the agent's memory.

1. **Start:** `git fetch origin`, merge control into your branch, read `BOARD.md`, `SPEND.md` and your task logs (newest entries last).
2. **Work:** take the highest open item in your own tasks. One theme per round, about 45 minutes.
3. **End:** append `Round end: done <what>; next: <exact next step>; spend this round: US$<x>` to the task log, commit, push the board and your branch.
4. **Nothing left** in your tasks: append `Idle: waiting for <what>` and stop until the next round.

## Overnight (no human watching)

Yunzhe starts `scripts/overnight.sh` for each engineer. It resumes your latest session once per round with a fixed prompt, and waits 20 minutes after a quick failure (usage limit), then tries again.
- Finish each round with a pushed commit and a `Round end:` log line. The next round starts from the board, not from memory.
- Never ask a question and wait: no human answers until morning. Decide inside your decision rights, log the ruling, and go on. If blocked, log `Blocked: <why>` and take the next item.
- When no item is left, print `NOTHING LEFT` as the last line. The script then stops.
- Live model calls only within your SPEND.md limit; at most 10 questions per round.

## Codex on Yunzhe's PC (git access)

Start Codex from `~/hackathon`, not from inside its worktree: `cd ~/hackathon && codex`, then work in `SunNewBee-backend` with `git -C SunNewBee-backend …`. Codex's sandbox makes the top-level `.git` of the folder it starts in read-only (by design), so commits and fetches fail from inside the worktree. Remotes use SSH (`git@github.com:TIONYUNZHE2004/SunNewBee.git`); HTTPS logins do not work inside the sandbox.

## Testing without burning money

- Never "run 100 questions, fix one, run 100 again".
- Check facts with the engine first (free). Live rounds have **at most 10 questions**.
- Group failures by cause and fix the whole group **before** any re-test.
- Re-test only the failed questions plus 3-5 that passed. Check validator changes against saved answer logs first.
- A full answer-key live run happens only when Yunzhe asks.
- Append every live round to `SPEND.md`. At the hard stop in `SPEND.md`, stop live calls.

## Changes to tool output

A Backend change that alters what a tool or route returns also breaks or changes assistant answers. Before logging "ready for PR", the backend engineer also runs `uv run pytest packages/agent apps/api -q`, and the AI engineer acknowledges the contract note and adapts answers and tests. Control merges only PRs with green CI.

## One branch per engineer

Each engineer commits every task on its own single branch (`local/ai-engineer`, `local/backend-engineer`). Control keeps one open PR per engineer into control, and merges it only when GitHub CI is green.

## Merge conflicts

Two agents that append to the same log at once conflict at the end of the file during `pull --rebase`. Keep both entries, in time order, then `git rebase --continue`.
