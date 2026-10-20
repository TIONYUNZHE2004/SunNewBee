You are the AI engineer for TownshipLens (repo TIONYUNZHE2004/SunNewBee), a hackathon app (demo 23 Oct 2026): a 3D "township world model" of City of Elmina with an honest AI assistant (PydanticAI agent in packages/agent; the validator in validate.py checks every stated fact against this turn's tool results). Residents ask about routes and flood scenarios; managers plan. Core promise: answers come only from checked data; every gap is shown as a gap.

START
1. Base your work on branch `claude/sweet-davinci-29v7ne` (control branch; equals main after PR #16). Work on your own branch.
2. Read AGENTS.md and CLAUDE.md, packages/agent (agent.py, run.py, scope.py, validate.py, mock.py, template.py, settings.py).
3. Read the board tasks without checking out the branch: `git fetch origin yunzhe/agent-board && git show origin/yunzhe/agent-board:tasks/T-023-management-panel-scope.md` (and T-024, T-025), and README.md "Fewer commits".
4. Setup: `pnpm install && uv sync --all-packages --all-groups`. Default `LLM_PROVIDER=mock`.

TASK 0: finish the rescued name-search work (do this first, small)
- Branch `rescue/ai-t022-live` (commit 920d338) holds uncommitted work of the old local AI engineer after its live round 6 (`evals/audits/2026-10-18-t017/round6-t022-openrouter.json`): a CJK spacing fix in `packages/spatial/src/townshiplens_spatial/place_search.py` ("subang走" -> "subang 走"), a guard against one loose word matching a name, ordered ids in `route_binding.fuzzy_mentions`, and an unfinished `single=` parameter on `named_places`.
- Live round 6 still failed on: "从SK TAMAN BKT SUBANG走到surau at takwa怎么走？" (cannot_answer) and "Tell me about tmn bukit subang" (cannot_answer). Cherry-pick or re-apply the useful parts, finish them, and add one test per failing question (mock). Do not commit the 4,900-line round6 JSON; summarise it in your PR.

TASK 1: T-023 management panel answers like the resident panel
- Today `ASSISTANT_SCOPE` (settings.py, default access_flood) is global, so the management panel refuses what-if, rollout, verify-next and ticket-impact questions.
- Add `panel: "resident" | "management"` (default resident) to ChatRequest; the API passes it; management requests get every tool and no topic refusal; resident requests keep today's scope. No tool can answer → "I can't answer that from our data" (+ a ticket for a data gap), never "out of scope".
- The web side needs one field in the management panel's chat request: add it in apps/web (`features/assistant` or the management screen) and list the file in your PR for shaoxian04.
- Mock, template and validator change together. `pnpm gen` and commit packages/api-client.

TASK 2: T-024 wording (after the backend removes +4/+5 m)
- Answers about river rise use only +1/+2/+3 m, name flooded places and cut-off places from the backend's `flooded_places` / `cut_off_places`, add "Flash floods from heavy rain are not shown." Never "safe", never a depth. Validator: reject a cut-off or flooded claim that the tool did not return.

TASK 3: T-025 event answers (after the backend's `simulate_event` tool lands in claude/sweet-davinci-29v7ne)
- Management: "What if we close Persiaran X for a marathon 7-11 am?" calls `simulate_event` and reports trips affected, places cut off, top detour roads and the suggestions, each with its number, plus "estimate from mapped roads and sample trips, not traffic counts".
- Resident: during an event window, route answers name the event closure and give the detour.

RULES
- Lanes: you own packages/agent (and the one apps/web field above). Do not edit packages/spatial or apps/api beyond the ChatRequest field; ask in the PR if you need more.
- Honesty invariants in AGENTS.md stay true. Never present demo/placeholder values as verified.
- Re-record the Elmina demo cache with the mock when answers change: `ASSISTANT_SCOPE=all TURN_TIMEOUT_S=600 LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --record "<question>" --profile <p>`.
- Live model calls: at most one round of 10 questions at the very end, only if OPENROUTER_API_KEY is available; report the cost.
- Commits: one commit per finished, tested step; no checkpoint or log-only commits; docs ride with code.
- Before done, run with `set -o pipefail`: `pnpm lint`, `uv run pytest -q`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm gen && git diff --exit-code packages/api-client`, `pnpm golden`.

DONE
Push your branch and open a PR into `claude/sweet-davinci-29v7ne` (not main). PR description: what changed for residents and managers, check results (PASS/FAIL per command), files outside your lane, anything left. Do not write the board; control copies your summary there.
