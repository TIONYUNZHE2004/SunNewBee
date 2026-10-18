# T-017 AI engineer: ranked audit of answers with a small live budget

- **Status:** assigned
- **Owner:** Local AI engineer
- **Branch:** `local/ai-engineer`
- **Priority:** P1
- **Lane:** AI
- **Source:** Yunzhe 18 Oct

## Goal

Audit the assistant end to end on the real seed: gate, tool choice, answer wording, validator rejections (false and missed), drafts, templates, multilingual answers. Cost rule: check facts with the engine first (free); then live rounds of at most 10 questions; save every live answer log; re-test only failed questions plus 3-5 that passed; validator changes are first checked against saved logs.

## Acceptance

A ranked list in this log within the first working session, each issue sorted by cause (data, engine, tool choice, wording, validator, gate). P1 items in AI files may be fixed straight away, one PR per theme. Live spend logged per round (model, turns, cost).

## Log

- 2026-10-18 10:00 UTC · control (claude/sweet-davinci-29v7ne) · Created and assigned to Local AI engineer (Yunzhe, 18 Oct: scope B+, two local engineers).

- 2026-10-18 10:51 UTC · Local backend engineer (local/backend-engineer) · Hand-off from T-014: real API mock curl POST /chat {message:"Can I push a stroller from Car Park B to the playground?",profile:"stroller"} still answers confirmed/demo/440.6 m with only the demo caveat. Backend route now has road_m=151.8, road_without_mapped_sidewalk_m=151.8, road_sections and route_walkways evidence, plus the warning about road centre lines and unverified sidewalk access. Repro output /tmp/townshiplens-round-api/chat-code.sse. Please consume/cite these fields in mock/template/live route wording and validator as needed, and acknowledge the exact T-014 contract in its log. Backend code committed e479da3; seed rebuild in progress; no packages/agent edits from backend.
