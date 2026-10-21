# Demo storyboards prototype

> Status: throwaway visual prototype, 21 Oct 2026. Standalone page, not part of `apps/web`.
> It runs on a made-up clay block, and every number on it is a placeholder.

This page checks that the two 45-second 3D demos tell a consistent story before the spec is written:
- **Navigation (wheelchair):** split screen with the fastest route and the recommended step-free route side by side. Along the way it shows info tags, a greeting from a simulated resident, an unchecked stretch with a survey ticket flying to the Tickets chip, and a reasons card. Unchecked facts never count for or against a route.
- **Building (management):** a hypothetical tower going from hoarding to handover, with these beats:
  - a hoarding impact card and a lorry route that passes a school;
  - floors rising, a crane and lorries;
  - public holidays shown as ticks, with only Hari Raya called out;
  - monsoon rain;
  - move-in;
  - an impact brief and the list of 40 simulated residents, with one resident opened.

## Run it

```bash
cd docs/03-product/prototypes/demo-storyboards && python -m http.server 5191 --bind 127.0.0.1
# open http://127.0.0.1:5191/index.html
```

Three.js 0.186.1 loads from jsDelivr, so the page needs network access. The test hook is `window.__demo.seek(seconds)`, `.play()`, `.set("nav"|"bld")`.
