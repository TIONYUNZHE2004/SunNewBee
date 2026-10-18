# T-019 Audit route answers against the path data; fix overclaiming wording

- **Status:** assigned
- **Owner:** Local AI engineer
- **Branch:** `local/ai-engineer`
- **Priority:** P1 (before the 23 Oct proposal)
- **Lane:** AI (`packages/agent`)
- **Source:** Yunzhe's map screenshots, 18 Oct (walking, wheelchair, driving views)

## Goal

Yunzhe's live test: Surau Al Mahdi → Surau At Taqwa says "Route status: confirmed" and "No known barrier", but 352 of 364 m follow a road centre line with no mapped sidewalk. Also the BM answer kept one English line ("Asked the township team to check 6 of the 6 unchecked items").

1. Audit 10 route answers (at most 10 live questions; mix walking/wheelchair/stroller, EN/BM/中文, deep spot and outside) and compare every sentence with the route data (types, road metres, sidewalk, crossings, unknowns). Log mismatches by cause.
2. Propose how answers state a route that mostly follows roads without sidewalks (Yunzhe has not yet decided whether such routes cap at "partly unverified"; write the proposal, do not change status rules).
3. Translate every fixed caveat and staff-check line in BM and 中文.

## Acceptance

Findings logged with the answer text and the route data side by side; translation fix committed with tests; status proposal written for Yunzhe. Spend logged in SPEND.md.

## Log

- 2026-10-18 14:59 UTC · control (claude/sweet-davinci-29v7ne) · Created from Yunzhe's map review and assigned to Local AI engineer.
- 2026-10-18 15:05 UTC · Local AI engineer (local/ai-engineer) · Started on local/ai-engineer (control 8d20778 merged). Order: (3) translate fixed caveat and staff-check lines in BM/中文 (free, deterministic); (1) engine facts for 10 route questions, then one live round of at most 10; (2) proposal for road-without-sidewalk wording (status rules: superseded by T-020's likely_ok level, so wording only).
- 2026-10-18 16:05 UTC · Local AI engineer (local/ai-engineer) · Ready for PR: local/ai-engineer bbc98b4 (control merged). Answer: route answers now always state the road stretch, and BM/中文 answers no longer keep English fixed lines. Audit: 10 live route questions + 9 re-test, US$0.0732 (SPEND.md). Side-by-side table (answer vs path data, cause per row) and re-test: evals/audits/2026-10-18-t017/T-019-findings.md. Main results: 7/8 road routes named the road stretch unprompted, r10 did not → road_note now required (validator + mock + template, prompt 5j); 3/10 rewrites were false rejects of translated notes → accepted now; all fixed lines translated after the check (localize.py). Re-test: r02/r05 first-try pass; r08 pass; r10 one false reject (wheelchair limit 0.9 m, fixed) then a 60 s timeout. Status proposal: superseded by T-020 likely_ok; the road caveat stays on every such route either way. Checks (mock): uv run pytest -q PASS 2018 / 33 skipped; pnpm lint PASS; pnpm golden PASS 23/23; e2e NOT RUN (CI). Touches data: 10 Elmina demo entries re-recorded with the mock (5822e7c). Open: provider latency 2-3× today; long routes (75-96 unknowns) can hit TURN_TIMEOUT_S=60 — Recommended: keep 60 s for now and trim long unknown lists in the model payload (AI lane) if it repeats. Hand-off backend (small): the road warning ends 'sidewalk access is not verified'; Recommended wording 'not checked yet' to match the product's terms.
