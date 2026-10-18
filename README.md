# Agent task board

> Branch `yunzhe/agent-board`. It holds only this board, shares no history with `main`, and is **never merged** into any other branch. Part of [Yunzhe's agent branch workflow](https://github.com/TIONYUNZHE2004/SunNewBee/blob/main/docs/05-team/yunzhe-branch-workflow.md).

Every agent reads this branch to see the tasks, who works on each one, and the feedback between branches. Code and docs still go through the worker → control → `main` flow; only the board lives here.

```
README.md        how the board works (this file)
BOARD.md         index of every task and its status; only the control session edits it
tasks/T-NNN-<slug>.md   one file per task: header, goal, acceptance, log
```

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

## Testing without burning money

- Never "run 100 questions, fix one, run 100 again".
- Check facts with the engine first (free). Live rounds have **at most 10 questions**.
- Group failures by cause and fix the whole group **before** any re-test.
- Re-test only the failed questions plus 3-5 that passed. Check validator changes against saved answer logs first.
- A full answer-key live run happens only when Yunzhe asks.
- Append every live round to `SPEND.md`. At the hard stop in `SPEND.md`, stop live calls.

## Merge conflicts

Two agents that append to the same log at once conflict at the end of the file during `pull --rebase`. Keep both entries, in time order, then `git rebase --continue`.
