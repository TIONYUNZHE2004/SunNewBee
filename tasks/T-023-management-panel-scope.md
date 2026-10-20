# T-023 Management panel answers like the resident panel

- **Status:** assigned · **Owner:** cloud AI worker · **Priority:** P1 · **Lane:** AI (+ one request field in apps/api)
- **Source:** Yunzhe, 20 Oct: "don't limit management questions; work like the resident panel"

## Problem (fact)
`ASSISTANT_SCOPE` is one global setting (`packages/agent/.../settings.py`, default `access_flood`). The management panel shares it, so what-if, rollout, verify-next and ticket-impact questions are refused as "out of scope".

## Fix
1. `ChatRequest` gets `panel: "resident" | "management"` (default resident). The management panel sends it.
2. Management requests run with every tool and no topic refusal. Resident requests keep scope B+.
3. A question no tool can answer gets "I can't answer that from our data", plus a ticket when it is a data gap. Never "out of scope".
4. Mock, template and validator change together; re-record the affected demo entries with the mock; `pnpm gen`.

## Acceptance
Management: "What happens to residents as the river rises?", "Which facts should staff verify first?", "What if we build a ramp at the steps?" all answer with tool evidence. Resident: same questions behave as today.

## Log
- 2026-10-20 16:05 UTC · control · Created.
- 2026-10-20 17:52 UTC · control · Done by cloud AI worker, PR #18 merged into davinci (56950f8). `panel` field on chat requests (web sends the mode store value); management gets every tool and "I can't answer that from our data" instead of a refusal. STEP 0 key check PASS; live round 10 questions, about US$0.047. Note: the panel field is not authenticated, so anyone can ask management-style questions; the tools are read-only or file tickets, so the risk is low.
