# Risk Register

> Update weekly in the Monday sync. **L** = likelihood, **I** = impact (H/M/L). Detailed technical risks live in the research docs; this is the project-level view.

| # | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | A team member doesn't accept the portal invite before the deadline | M | H | Do it on Wed 21 Oct; the leader checks each acceptance | Leader | open |
| R2 | Proposal rushed or misses criteria | M | H | Proposal outline mapped to criteria; internal review Thu 22 Oct | All | open |
| R3 | Google 3D Tiles quality poor at the site, or the SKU isn't enabled for students | M | M | Day-1 spike; fallback A (OSM/Overture + glTF); Cesium ion Community | FE | open |
| R4 | Tile licence breach (tracing, caching) | L | H | Display only; paths from OSM/survey; provenance per edge | FE/BE | open |
| R5 | No permission or time for a site visit | M | M | v0 data from public sources marked `reported`; visit public areas only; that honesty is part of our story | All | open |
| R6 | LLM produces unsupported claims in the demo | M | H | Validator + template fallback + demo cache + golden set in CI | AI | open |
| R7 | LLM API outage, quota or Wi-Fi failure on pitch day | M | H | `DEMO_MODE` cache, recorded video, hotspot | AI/FE | open |
| R8 | Scope creep (indoor nav, WhatsApp, splats…) | H | M | MVP spec is the scope; "Later" list; feature freeze Sun 8 Nov | All | open |
| R9 | Profile thresholds challenged as non-standard (MS 1184 is paywalled) | M | M | Label them as engineering defaults; ask mentors for MS 1184 access or a review | BE | open |
| R10 | User test recruiting fails (especially OKU participants) | M | M | Ask the campus disability unit and family early; report the sample honestly | All | open |
| R11 | PDPA or privacy concern raised by judges | L | M | Privacy-by-design section; no accounts; redaction; data-retention statement | AI | open |
| R12 | Free-tier hosting sleeps (cold start) during the demo | M | M | Cloud Run `min-instances=1` for demo day; Supabase keep-alive cron | BE | open |
| R13 | IP or data ownership unclear with SDP | L | M | Ask organisers (hackathon brief open questions); keep our code MIT/own repo | Leader | open |
| R14 | Team member unavailable (exams, illness) | M | H | Docs-first knowledge base (this repo); every lane has a backup reviewer | All | open |
| R15 | Statistics in the pitch are outdated or uncited | M | M | Use only numbers from the research docs with sources; avoid "aged nation 2030" | Pitch lead | open |
