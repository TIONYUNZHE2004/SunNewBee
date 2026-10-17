# Agent task board

> Part of [Yunzhe's agent branch workflow](../yunzhe-branch-workflow.md). Personal workflow, not team policy.

One folder that every agent reads. It lists the tasks, who works on each one, and the feedback between branches.

```
docs/05-team/agent-board/
├── README.md        how the board works (this file)
├── BOARD.md         index of every task and its status; only the control session edits it
└── tasks/
    └── T-NNN-<slug>.md   one file per task: header, goal, acceptance, log
```

## Who writes what

| File or part | Who edits it | Where |
|---|---|---|
| `BOARD.md` | Control session only | Control branch |
| New task file | Control session only | Control branch |
| Task header (`Status`, `Owner`, `Branch`) | Control session only | Control branch |
| Task `## Log` | Any agent, **append only** (never edit or delete an entry) | Its own branch |

A worker never edits `BOARD.md` or a task header. It reports through the log; control updates the header and the board when it merges.

## Status values

`open` (nobody yet) → `assigned` → `in-progress` → `review` (PR open into control) → `done` (merged into control). Also `blocked` (says why in the log) and `handoff` (owned outside Yunzhe's lanes; tracked here only).

## Log entry format

Add one entry at the end of `## Log`:

```
- 2026-10-17 08:40 UTC · <agent> (<branch>) · <what happened, finding, question or feedback>
```

Use the real time from `date -u '+%Y-%m-%d %H:%M UTC'`. Feedback on someone else's task goes in **that task's** log, signed with your name.

## Reading other branches without merging

A log entry on another branch is visible as soon as that branch is pushed. Nobody has to merge it first:

```bash
git fetch origin
# which branches changed the board, compared with yours
for b in $(git branch -r | grep -v HEAD); do
  n=$(git diff --name-only HEAD...$b -- docs/05-team/agent-board | wc -l)
  [ "$n" -gt 0 ] && echo "$b: $n board file(s) changed"
done
# read one task as it is on another branch
git show origin/<branch>:docs/05-team/agent-board/tasks/<file>.md
```

## When to do what

| Who | When | Action |
|---|---|---|
| Every agent | Start of every session and before every task | `git fetch origin`, read `BOARD.md` on control, run the loop above |
| Worker | Starting a task | Append "started" to its log, commit, push its branch |
| Worker | Finding, blocker or question | Append to the log, commit, push (do not wait until the end) |
| Worker | Done | Append the result and check results, push, open a PR into control |
| Control | On every fetch | Read new log entries on all branches; update headers and `BOARD.md` after merging |

## Merge conflicts

Two branches that append to the same log at once conflict at the end of the file. Keep both entries, in time order. Only control edits headers and `BOARD.md`, so those never conflict.
