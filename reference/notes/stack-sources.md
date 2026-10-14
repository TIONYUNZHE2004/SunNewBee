# Stack sources

Machine-readable list for the stack decision (2026-10-14). Format: `url | why | priority | est size`. Repo existence/size for items marked (unverified) was not checked this session; clone to `reference/repos/` on demand.

## Repos
- https://github.com/NASA-AMMOS/3DTilesRendererJS | 3d-tiles-renderer; `src/r3f/README.md` and `example/r3f` show TilesRenderer + GoogleCloudAuthPlugin + GlobeControls + attribution | 1 | medium (examples include assets; unverified)
- https://github.com/pmndrs/react-three-fiber | R3F v9 core, docs and examples | 1 | medium
- https://github.com/pmndrs/drei | drei helpers (controls, Html, Line, Text) | 2 | medium
- https://github.com/fastapi/full-stack-fastapi-template | official FastAPI template: uv, SQLModel/Postgres, auth, generated TS client from OpenAPI, CI; borrow patterns, do not fork wholesale | 1 | medium (unverified)
- https://github.com/jlowin/fastmcp | FastMCP server for exposing the tool registry (verify current repo location, now maintained under PrefectHQ/Prefect org possibly) | 1 | small (unverified)
- https://github.com/modelcontextprotocol/python-sdk | official MCP Python SDK, alternative to FastMCP | 2 | small
- https://github.com/assistant-ui/assistant-ui | chat UI primitives with custom runtimes; fallback if hand-rolled chat list is too slow to build | 2 | medium
- https://github.com/vercel/ai | Vercel AI SDK; `useChat` and data stream protocol reference (check Python-backend compatibility for v7) | 3 | large
- https://github.com/hey-api/openapi-ts | OpenAPI to TS client generator, TanStack Query plugin | 1 | medium (unverified)
- https://github.com/visgl/react-map-gl | MapLibre React bindings (`react-map-gl/maplibre`) | 2 | small
- https://github.com/maplibre/maplibre-gl-js | 2D fallback map engine and examples | 2 | large
- https://github.com/networkx/networkx | graph library; docs for `subgraph_view`, `shortest_path` with weight functions | 3 | large
- https://github.com/shadcn-ui/ui | component source and registry; a11y-minded primitives via Radix | 2 | large
- https://github.com/astral-sh/uv | workspace docs for the Python monorepo layout | 3 | large
- https://github.com/dequelabs/axe-core-npm | `@axe-core/playwright` for a11y CI checks | 2 | small

## Docs and pricing pages (not repos)
- https://developers.google.com/maps/documentation/tile/usage-and-billing | root-tile SKU, 10,000 root queries/day quota | 1 | n/a
- https://developers.google.com/maps/documentation/tile/policies | attribution, caching and use restrictions for 3D Tiles (not fetched; read before pitching) | 1 | n/a
- https://render.com/docs/free | Render free tier: 15 min spin-down, 750 h, 512 MB | 2 | n/a
- https://cloud.google.com/run/pricing | Cloud Run free tier and Singapore pricing (verify) | 1 | n/a
- https://developers.cloudflare.com/pages/platform/limits | Pages free limits | 2 | n/a
- https://fly.io/docs/about/discontinued-plans/ | Fly.io has no free tier for new orgs | 3 | n/a
- https://vercel.com/docs/plans/hobby | Vercel Hobby is non-commercial | 3 | n/a
- https://www.w3.org/TR/WCAG22/ | WCAG 2.2 criteria (target size 2.5.8, focus not obscured 2.4.11) | 2 | n/a
