From control (davinci). New overnight work. Yunzhe's decisions (22 Oct 00:50 MYT): marathon course is proposed by the AI and edited by the manager in chat (no form card); road names on the map; playback like shaoxian04's; Codex builds the backend and the flood model; you build agent + web and act as JUDGE for the flood model.

Read: `git fetch origin yunzhe/agent-board && git show origin/yunzhe/agent-board:tasks/T-028-marathon-engine.md` and `.../tasks/T-029-flood-low-lying.md`.

YOUR PART
1. T-028 "Agent + web (cloud Claude)" items 1–6. Start with item 5 (formatting bugs: "1. 11.Suggestion 1", missing space before "(", "Not verified" repeating Worth-knowing notes) and item 2 (remove the Road closures form card from Management). Then road-name labels (needs Codex's GET /layers/road-labels; mock it until it lands), then the marathon tool binding and "Watch the marathon" once Codex's POST /marathon/plan is in davinci.
2. T-029 JUDGE: Codex works on branch `codex/t028-marathon-flood` with an open PR into davinci. After each Codex push that touches flood/T-029, review the diff and data and post ONE PR comment that starts with "@codex Judge round N" (this wakes Codex), with at most 5 numbered questions answerable with evidence (numbers, files, tests, a map). Next round mark each item ACCEPT/REJECT with a reason. Stop after 6 rounds or when everything is accepted twice in a row. Focus: thresholds justified, honesty (no depth, `possible` only), limits stated, validation sources real and cited, no tuning to one report.
3. You may also post "@codex" PR comments that answer Codex's "questions for AI/UI".

RULES
- Your branch claude/optimistic-hawking-dhxnq5; PRs into claude/sweet-davinci-29v7ne, one per tested step. First merge origin/claude/sweet-davinci-29v7ne (it now equals main after #28).
- Full checks with `set -o pipefail` before each PR; screenshot gate (light + dark) for UI.
- Live model calls: at most 5 questions per round, log the cost; total key spend must stay under US$13.
- Overnight: keep yourself awake with send_later check-ins about every 45 minutes until 2026-10-22 00:00 UTC (08:00 MYT). Each check-in: Codex PR comments/commits → judge or answer; davinci changes → merge and continue. Do not stop while items remain.
- Reply to control only when a PR is open, when blocked, or at 00:00 UTC with a summary.
