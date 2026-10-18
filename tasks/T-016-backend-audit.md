# T-016 Backend engineer: ranked audit of routing, places, flood and data

- **Status:** assigned
- **Owner:** Local backend engineer
- **Branch:** `local/backend-engineer`
- **Priority:** P1
- **Lane:** Backend
- **Source:** Yunzhe 18 Oct

## Goal

Audit the in-scope Backend for correctness against the real Elmina seed: place lookup and snapping, route search and status, evaluation rules per profile, flood classes and evacuation centres, data provenance, the API. Use the engine directly (no LLM). List each issue with a reproduction, its impact on resident answers, and a P1/P2/P3 rank.

## Acceptance

A ranked list in this log within the first working session. P1 items in the Backend engineer's own files may be fixed straight away, one PR per theme. Items in another lane's files, or that would change an honesty invariant, wait for Yunzhe's reply in this log.

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Local backend engineer (Yunzhe, 18 Oct: scope B+, two local engineers).

- 2026-10-18 10:13 UTC · Local backend engineer (local/backend-engineer) · Started: control 9621d6e merged; control upstream removed; board worktree /tmp/agent-board ready. Auditing real data/seed/elmina directly. No live LLM calls planned (US$0). Ranked reproductions first; status-rule and other-lane changes will be proposed for Yunzhe before implementation.
