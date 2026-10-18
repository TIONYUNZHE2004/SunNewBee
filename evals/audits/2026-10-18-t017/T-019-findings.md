# T-019 route answers against the path data (18 Oct 2026)

Model `anthropic/claude-haiku-5.5`, 10 route questions (round 2) and a re-test of 7 + 2
(rounds 3-4). Full answer logs: `round2-t019-openrouter.json`, `round3-…`, `round4-…` in this
folder. Path data: `plan_route` on the committed Elmina seed (engine only).

## Answer beside data (round 2, before the fixes)

| Id | Question (lang, profile) | Route data | Answer said | Mismatch | Cause |
|---|---|---|---|---|---|
| r01 | Surau Al Mahdi → Surau At Taqwa (EN, walking) | confirmed, 363.8 m: 352.0 m street, 11.8 m crossing, 0 m sidewalk, 1 unmarked crossing | "Route status: confirmed"; "runs along Jalan Metafasa U16/3 with no mapped sidewalk"; road note given | Status reads confirmed for a route 97 % on a road centre line | Status rule (T-020) |
| r02 | same, BM, wheelchair | partly unverified, 27 unknowns, same road metres | Road note and crossing note in BM; asked 10 of 27 | First attempt rejected: the model translated the crossing note | Validator (false reject) |
| r03 | Car Park B → Urban Park playground (中文, stroller) | confirmed on demo values, 440.6 m: 151.8 m street, 288.9 m footway | "可以推婴儿车走"; road stretch named; status line confirmed (demo) | Lead "可以" (yes) while 152 m is road with no sidewalk | Wording |
| r04 | Car Park B → Elmina Lakeside Mall (EN, wheelchair) | partly unverified, 445.9 m: 123.9 m street, 318.4 m footway, 3.6 m ramp, 7 unknowns | Partly unverified; road note; 7 of 7 asked | none | — |
| r05 | Elmina Lakeside Mall → Anadia Clinic (BM, walking) | partly unverified, 3387.5 m: 2033.7 m road (293.8 m major road), 932.5 m sidewalk, 8 crossings | Road note 2,034 m in BM; crossings in BM | First attempt rejected: translated crossing note | Validator (false reject) |
| r06 | Anadia Clinic → Skyhill Clinic HQ (中文, walking) | confirmed, 178.1 m: 96.7 m street, 81.4 m sidewalk | Answer and caveats in English; "Surface and wheelchair tags … come from OpenStreetMap" | English answer to a 中文 question; surface claim has no source | Wording |
| r07 | Lakeside Mall → Elmina Urban Park (EN, older adult) | partly unverified, 119.8 m footway, rest gap 120 m (limit 100 m) | Rest gap stated; "Yes, there is a mapped walking route" | Lead "Yes" on a partly unverified route | Wording |
| r08 | Lakeside Mall → Surau At Taqwa (EN, stroller) | partly unverified, 1379.5 m: 932.5 m sidewalk, 358.9 m footway, 0 m road, 9 crossings, 75 unknowns | Correct; two attempts rejected on "932 m" | Rejection not reproduced offline (every phrasing tried passes) | Validator (unexplained) |
| r09 | Car Park B → Urban Park toilet (BM, stroller) | confirmed on demo values, 382.1 m: 151.8 m street | "Laluan ini confirmed (nilai demo…)" mixed EN/BM; road stretch in BM | English status word inside BM | Wording |
| r10 | Surau Al Mahdi → Lakeside Mall (中文, wheelchair) | partly unverified, 1719.8 m: 352.0 m street, 932.5 m sidewalk, 8 crossings, 96 unknowns | "可以走" lead; entrance note in 中文 with the English copy beside it; NO road note | Road note missing; lead "可以" | Validator gap + wording |

Summary: 7 of 8 routes with road metres named the road stretch without being required to; 4 of
10 needed a rewrite, 3 of them false rejects of a translated note.

## Fixes (local/ai-engineer, 91f5b61, aeabc19, 93f088d)

- Fixed lines in BM / 中文 (staff checks, crossing, entrance, unchecked items, rest gap,
  closures, road note, demo status): `localize.py`, applied after the validator.
- `road_note` on the first route; validator, mock and template require it (prompt 5j).
- Translated notes accepted when they keep the subject words and every number; crossing
  sub-counts and profile limits ("needs width_m ≥ 0.9") count as tool values.
- Prompt: fixed notes stay in English (the app translates); no "Yes" / "Ya" / "Boleh" / "可以"
  lead on a partly unverified, blocked or data-gap route; flood guidance only with a scenario.

## Re-test (rounds 3-4, same questions)

| Id | Round 2 | After the fixes |
|---|---|---|
| r02 | 1 false reject | first attempt passed; all fixed lines in BM |
| r05 | 1 false reject | first attempt passed |
| r08 | 2 rejects | round 4: passed, "about 932 m follows mapped sidewalks" accepted |
| r10 | 1 false reject, road note missing | 1 false reject ("宽度至少0.9米", the wheelchair limit; fixed in 93f088d), then a 60 s timeout → template |
| r01, r03, r06 | passed | passed; r06 one honest reject ("3 minutes" for 2.5 min without "about") |

Open: provider latency was 2-3 times round 2 for the same tokens (r01 9.7 s → 20 s); long
routes (75-96 unknowns) hit `TURN_TIMEOUT_S=60` twice. r03's steps came back in English in a
中文 answer (model language slip; not fixed).

## Status proposal (for Yunzhe)

Superseded by T-020 (control, 18 Oct 15:04): routes on road centre lines are handled by the new
"Likely OK (estimated)" level instead of capping them at "partly unverified". The answer side is
ready: every route answer now carries "About N m follows road centre lines without a mapped
sidewalk", so a status of `likely_ok` or `confirmed` can never hide the road stretch.
