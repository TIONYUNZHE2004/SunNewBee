# API Contract (v0)

> The **contract between the three lanes**. FastAPI's generated `openapi.json` is the machine source of truth; this doc is the human-readable design and must be updated **in the same PR** as any contract change. Stack context: [stack-decision.md](stack-decision.md). Data shapes: [world-model-schema.md](world-model-schema.md).
>
> Conventions: JSON over HTTPS · coordinates are **WGS84 `[lon, lat]`** (GeoJSON order) · times are ISO-8601 with the `+08:00` offset · IDs are short readable strings (`ent-hall-main`, `seg-0042`, `vr-0017`) · errors use RFC 9457 `application/problem+json`.

## 1. Canonical tool names

The same names are used for the LLM tools, the MCP server, the simulator and the REST endpoints, so logs read the same everywhere.

| Tool | Purpose | REST mirror |
|---|---|---|
| `find_place` | Resolve fuzzy text ("car park B", "dewan", "hall toilet") → candidate places | `GET /places?q=` |
| `get_place_details` | All attributes + provenance + evidence for one place/entrance | `GET /places/{id}` |
| `plan_route` | Route between two places for a profile, with a status classification | `POST /routes` |
| `find_nearby` | Amenities of a given type near a place or route | `GET /places/{id}/nearby?type=` |
| `get_closures` | Active and upcoming closures for a place, an edge or the whole site | `GET /closures?active_at=` |
| `create_verification_request` | Record a knowledge gap (deduplicated + upvoted) | `POST /verification-requests` |

The AI may only call these six tools. Adding a tool needs an ADR plus at least 3 new golden questions.

## 2. Resident endpoints (public)

### `GET /site`
Site metadata for the frontend bootstrap.
```json
{
  "id": "site-01",
  "name": "<facility name>",
  "township": "<township>",
  "center": [101.0, 3.0],
  "bbox": [100.99, 2.99, 101.01, 3.01],
  "scene": { "type": "google_3d_tiles | gltf | osm_extrusion", "url": "…", "attribution": "…" },
  "profiles": ["default", "stroller", "wheelchair", "older_adult_rest"],
  "data_as_of": "2026-11-04T10:00:00+08:00"
}
```

### `GET /graph?profile=stroller`
The whole site graph as a GeoJSON FeatureCollection, for the overlay. Each feature has `properties.kind` (`place | entrance | segment | amenity`) and `properties.status_for_profile` (`ok | unknown | blocked | closed | n/a`).

### `GET /places?q=hall&kind=entrance`
→ `{ "results": [ { "id", "name", "kind", "aliases", "score", "geometry" } ] }`

### `GET /places/{id}`
→ a `Place` with `attributes[]`, where each attribute is `{ key, value, state: "yes|no|unknown", source_type, verified_at, evidence_ids[], stale: bool }`.

### `POST /routes`
Request:
```json
{ "from": "park-b", "to": "hall", "profile": "stroller", "at": "2026-11-14T10:00:00+08:00", "alternatives": 2 }
```
Response:
```json
{
  "routes": [
    {
      "id": "rt-8f2c",
      "status": "partly_unverified",
      "distance_m": 230,
      "est_minutes": 4,
      "segments": ["seg-0003", "seg-0011", "seg-0042"],
      "unknowns": [
        { "element_id": "seg-0042", "attribute": "max_slope", "why_it_matters": "stroller profile requires slope ≤ 1:12" }
      ],
      "blocked_alternatives": [
        { "via": "seg-0020", "reason": "has_steps=yes (3 steps), verified 2026-11-04" }
      ],
      "rest_points": [ { "place_id": "bench-04", "at_m": 120 } ],
      "max_gap_between_rest_m": 140,
      "geometry": { "type": "LineString", "coordinates": [[101.0, 3.0], [101.0001, 3.0002]] },
      "evidence_ids": ["ev-012", "ev-019"]
    }
  ],
  "target_entrance": "ent-hall-main"
}
```
`status` ∈ `confirmed | partly_unverified | blocked | no_data`. Rules: [world-model-schema.md § Route classification](world-model-schema.md).

### `GET /evidence/{id}` → metadata · `GET /evidence/{id}/image` → JPEG

### `POST /chat` (SSE stream)
Request: `{ "session_id": "anon-uuid", "message": "…", "profile": "stroller", "lang_hint": "auto", "context": { "selected_place_id": null } }`

The response is `text/event-stream`. Event vocabulary (a Pydantic union, exported to TS):

| Event | Data | Frontend behaviour |
|---|---|---|
| `text.delta` | `{ id, delta }` | Append to the assistant bubble |
| `tool.call` | `{ id, name, args }` | Show a chip, e.g. "Checking step-free routes…" |
| `tool.result` | `{ id, summary }` | Mark the chip done |
| `scene.highlight` | `{ route_id?, place_ids?, geojson, style: "route|focus" }` | Draw the highlight and fly the camera |
| `citation` | `{ ref, element_id, attribute, state, verified_at, source_type, evidence_id? }` | Render an evidence card; `ref` matches `[1]`-style markers in the text |
| `uncertainty` | `{ level: "none|partial|high", items: [ { element_id, attribute, note } ] }` | Show an amber banner with the list |
| `verification.requested` | `{ request_id, element_id, attribute, created: bool }` | Show "We've asked the team to check this" |
| `error` | `{ code, message }` | Show a retry option |
| `done` | `{ message_id, usage? }` | Close the stream |

> Earlier docs used the name `map action`. **Map actions = `scene.highlight` events.**

### `POST /feedback`
`{ message_id, helpful: bool, note? }`: thumbs up/down on an answer.

### `POST /reports` (resident "report an issue")
`{ element_id?, location?: [lon, lat], text, photo? }` → creates a VR with `source_type=resident_report`. **Never auto-applied.**

## 3. Staff endpoints (auth required)

| Method & path | Purpose |
|---|---|
| `POST /auth/login` | Named staff account → httpOnly JWT cookie |
| `GET /verification-requests?status=open&sort=demand` | VR queue |
| `GET /verification-requests/{id}` | Detail: triggering questions, element, current value, history |
| `POST /verification-requests/{id}/resolve` | `{ action: "verify|correct|reject", value?, state?, evidence_ids[], note }` |
| `PATCH /elements/{id}/attributes/{key}` | Direct attribute edit (writes provenance + audit) |
| `POST /evidence` (multipart) | Upload a photo → `ev-…` (EXIF stripped server-side) |
| `POST /closures` · `DELETE /closures/{id}` | Time-bounded closure on an element |
| `GET /analytics/questions?window=7d` | Recurring question clusters |
| `GET /analytics/kpis` | % journeys confirmed, open VRs, median time-to-resolve, stale facts |
| `POST /simulations` | Start a persona batch run `{ personas[], tasks: "auto"|[...] }` |
| `GET /simulations/{id}` | Report: outcomes per journey, top gaps, explanations |
| `GET /audit?element_id=` | Change history |

## 4. Verification request shape

```json
{
  "id": "vr-0017",
  "element_id": "seg-0042",
  "attribute": "max_slope",
  "reason": "unknown_needed_for_route | stale | conflict | resident_report",
  "status": "open | in_progress | resolved | rejected",
  "demand": 4,
  "triggers": [ { "type": "chat|simulation|report", "ref": "msg-…|sim-…", "at": "…" } ],
  "created_at": "…", "resolved_at": null, "resolution": null
}
```
Dedupe key: `(element_id, attribute, status=open)`. A repeat trigger increments `demand` and appends to `triggers`.

## 5. Versioning and mocking rules

1. Backend publishes a **stub** for every endpoint (returning fixture data from `packages/fixtures/`) before implementing it.
2. Breaking change → announce in chat, bump `info.version`, regenerate the client in the same PR.
3. The frontend never hand-writes request types; it uses the generated client only.
4. The SSE event union is the one place frontend and AI must agree. Changes need a 👍 from both.
