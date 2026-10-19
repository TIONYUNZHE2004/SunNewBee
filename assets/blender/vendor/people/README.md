# Vendor people sources (resident-journey Phase C)

Only `.glb` files are committed. Each is recorded in `../vendor.json` (sha256, URL, licence, download date) and in `CREDITS.md`. Downloaded 2026-10-19.

## Candidates evaluated

| Candidate | Licence | Fetchable without login | Rig | Bones | Tris | Clips | Verdict |
|---|---|---|---|---|---|---|---|
| Kenney Mini Characters 1.0 (12 people, wheelchairs, cane, crutch, aids) | CC0 | yes (direct zip on kenney.nl) | skinned, 2 skins | 7 per skin | 790-880 | 32: `idle`, `walk`, `sprint`, `sit`, `crouch`, `emote-*`, `wheelchair-*`, `holding-*` and more | **Chosen** for hero base and crowd bodies. Chibi proportions already; far under the 60-bone budget |
| Kenney Blocky Characters 2.0 (18 people) | CC0 | yes | none (animation by node transforms, no skin) | 0 | about 72 | same names | Rejected: not skinned; too blocky for a face and tudung |
| Quaternius Universal Base Characters / Universal Animation Library | CC0 | **no**: itch.io "name your own price" checkout, no direct URL | humanoid rig, 120+ clips | not stated | not stated | many | Not fetched: needs an itch.io account/checkout. Revisit if the owner downloads it by hand |
| Poly Pizza CC0 | CC0 per model | not reachable: the Blender MCP search failed (Blender not connected); the site is JS-driven | varies | | | | Not used |

Hero budget: at most 60 bones; the Mini Characters body has 7, so the hero build can add head, tudung and hand bones.
The Mini Characters texture is one colormap; `import_vendor` samples it into vertex roles (so `role_map` is empty).
Clip names are Kenney's (`walk`, `idle`, `sit`); the spec's `sit_down`, `sit_idle`, `stand_up`, `look` clips are authored in the hero build.

## Props

- **Wheelchair:** Kenney `wheelchair.glb` (656 tris, no rig), committed as `mini-wheelchair`.
- **Walker (rollator) and stroller:** no clean CC0 source was found or reachable. Decision: model both by Blender script (tubes, wheels, grips) in `assets/blender/tl_assets/characters/`. No third-party credit is needed for them.

## Conversion

The sources are already GLB, so no FBX conversion script is needed. The FBX/OBJ copies in the Kenney zip are not committed.
