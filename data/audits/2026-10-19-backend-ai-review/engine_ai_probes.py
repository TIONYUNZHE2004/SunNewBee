# ruff: noqa: E402
"""Deterministic review probes; use the AI snapshot described in report.json. No paid calls."""

import asyncio
import json
import sys
import tempfile
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from townshiplens_agent import agent, demo, template, validate
from townshiplens_agent.events import ChatRequest
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.redact import redact
from townshiplens_agent.run import run_turn
from townshiplens_agent.scope import outside_scope
from townshiplens_agent.settings import AgentSettings
from townshiplens_spatial import flood, routing, tools
from townshiplens_spatial.access import assess_access
from townshiplens_spatial.models import Claim, Closure, EvacCentre
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from data.scripts.import_osm import split_ways

TINY = ROOT / "packages/spatial/tests/fixtures/tiny"
SEED = ROOT / "data/seed/elmina"
findings = []


def report(name, **evidence):
    findings.append({"name": name, **evidence})
    print(name, json.dumps(evidence, ensure_ascii=False)[:1400], flush=True)


def context(world=None):
    return tools.Ctx(world or load_world(TINY), VerificationStore(":memory:"))


async def main():
    print("AI source", agent.__file__, flush=True)
    # Current staff facts must replace recorded answers.
    ctx = context()
    req = ChatRequest(
        message="Can I push a stroller from Car Park B to the playground?", profile="stroller"
    )
    settings = AgentSettings(
        _env_file=None, llm_provider="mock", assistant_scope="all", demo_mode=False
    )
    events = [e async for e in run_turn(ctx, req, settings)]
    with tempfile.TemporaryDirectory() as folder:
        demo.save(
            demo.key(req), events, demo.make_meta(req, events, ctx.world.site.id), Path(folder)
        )
        for edge in ctx.world.edges.values():
            ctx.world.refresh_claim(
                edge.id,
                "width_m",
                Claim(
                    value=0.1,
                    status="verified",
                    evidence_type="field_survey",
                    verified_at=date.today().isoformat(),
                ),
            )
        fresh = routing.plan_route(ctx.world, "park-b", "playground", "stroller")
        replay_settings = settings.model_copy(update={"demo_mode": True, "demo_dir": Path(folder)})
        replay = [e async for e in run_turn(ctx, req, replay_settings)]
        drawn = [
            e.intent.route_status
            for e in replay
            if e.type == "scene.intent" and e.intent.kind == "route.highlight"
        ]
        report(
            "stale_demo_after_staff_update",
            engine=fresh.status,
            replay_status=drawn,
            model=replay[-1].model,
            world_version=ctx.world.version,
        )
    # Place closure consistency.
    ctx = context()
    ctx.world.set_closures(
        [
            Closure(
                id="audit-closed-place",
                element_id="playground",
                reason="works",
                starts_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        ]
    )
    result = tools.plan_route(ctx, "park-b", "playground", "stroller", file_vrs=False)
    report(
        "closed_destination_still_routable",
        status=result.data["status"],
        routes=len(result.data["routes"]),
        warnings=result.warnings,
    )
    # Rest constraints in centre summaries without full routes.
    world = load_world(TINY)
    rows = flood.centres_reachability(world, None, "older_adult_rest", "park-b", top_routes=0)
    mismatches = []
    for row in rows:
        if not row.reachable:
            continue
        fresh = routing.plan_route(
            world, "park-b", "__centre__" + row.centre.id, "older_adult_rest"
        )
        if row.route_status != fresh.status:
            mismatches.append(
                {
                    "centre": row.centre.id,
                    "summary": row.route_status,
                    "route": fresh.status,
                    "rest_limit_met": fresh.routes[0].rest_limit_met,
                    "max_gap_m": fresh.routes[0].max_gap_between_rest_m,
                }
            )
    report("centre_summary_ignores_rest_limit", mismatches=mismatches)
    for label, node in [("origin", "n-a"), ("near", "n-b"), ("far", "n-d")]:
        world.centres[label] = EvacCentre(
            id=label,
            name=label,
            coord=world.node_coords[node],
            node_id=node,
            source="osm_candidate",
        )
    normal_rows = flood.centres_reachability(world, None, "older_adult_rest", "park-b")
    far = next(r for r in normal_rows if r.centre.id == "far")
    planned = routing.plan_route(world, "park-b", "__centre__far", "older_adult_rest")
    report(
        "default_three_preview_rest_mismatch",
        summary=far.route_status,
        route=planned.status,
        rest_limit_met=planned.routes[0].rest_limit_met,
        max_gap_m=planned.routes[0].max_gap_between_rest_m,
    )
    # Known OSM physical obstacle ignored by the access rules.
    edge = world.edges["seg-ab"].model_copy(deep=True)
    edge.type = "sidewalk"
    edge.claims = {}
    edge.osm_tags = {
        "highway": "footway",
        "footway": "sidewalk",
        "surface": "concrete",
        "smoothness": "impassable",
    }
    a = assess_access(edge, world.profiles["wheelchair"])
    report("impassable_surface_estimated_ok", level=a.level, rule=a.rule_id, tags=a.tags_used)
    # Claims without a date can count as fresh staff verification indefinitely.
    edge.claims = {
        k: Claim(value=v, status="verified", evidence_type="field_survey", verified_by="staff-a")
        for k, v in [("width_m", 1.5), ("incline_pct", 2), ("step_count", 0)]
    }
    edge.osm_tags = {"highway": "footway", "footway": "sidewalk"}
    a = assess_access(edge, world.profiles["wheelchair"])
    report(
        "undated_verified_facts_never_expire",
        level=a.level,
        rule=a.rule_id,
        dates=[c.verified_at for c in edge.claims.values()],
    )
    # Missing raw node IDs create a false junction at a grade-separated crossing.
    ways = [
        {
            "id": 1,
            "tags": {"highway": "footway", "bridge": "yes", "layer": "1"},
            "geometry": [
                {"lon": 0, "lat": 0},
                {"lon": 0.001, "lat": 0.001},
                {"lon": 0.002, "lat": 0.002},
            ],
        },
        {
            "id": 2,
            "tags": {"highway": "residential", "layer": "0"},
            "geometry": [
                {"lon": 0, "lat": 0.002},
                {"lon": 0.001, "lat": 0.001},
                {"lon": 0.002, "lat": 0},
            ],
        },
    ]
    segs = split_ways(ways)
    ends = [{s["from"], s["to"]} for s in segs]
    junction = set.intersection(*ends)
    with_ids = [{**way, "nodes": [10 * i + j for j in range(3)]} for i, way in enumerate(ways)]
    source_segments = split_ways(with_ids)
    source_junctions = set.intersection(*[{s["from"], s["to"]} for s in source_segments])
    report(
        "grade_separated_ways_joined_by_coordinate",
        junctions=sorted(junction),
        source_junctions=sorted(source_junctions),
        segments=len(segs),
    )
    # Wrong profile in a model tool call is not bound to request.profile.
    ctx = context()
    rec = TurnRecord()
    req = ChatRequest(message="Find a nearby toilet for my wheelchair", profile="wheelchair")
    deps = agent.Deps(ctx=ctx, rec=rec, request=req)
    data = await agent.call_tool(
        deps, "nearby_amenities", origin_id="park-b", amenity="toilet", max_walk_m=150
    )
    correct = tools.nearby_amenities(ctx, "park-b", "toilet", 150, "wheelchair")
    report(
        "amenity_default_ignores_ui_wheelchair",
        omitted_profile_rows=[r["id"] for r in data["data"]] if "data" in data else data,
        wheelchair_rows=[r["id"] for r in correct.data],
    )
    # Latest pushed AI gate, real seed estimate.
    ctx = context(load_world(SEED))
    rec = TurnRecord()
    req = ChatRequest(message="Can I use a wheelchair on this route?", profile="wheelchair")
    deps = agent.Deps(ctx=ctx, rec=rec, request=req)
    await agent.call_tool(
        deps,
        "plan_route",
        from_id="osm-node-12001705555",
        to_id="osm-node-12001743124",
        profile="wheelchair",
    )
    rid = next(iter(rec.routes))
    base = template.template_answer(rec, req.message)
    probes = {}
    for text in [
        "This route is step-free.",
        "This route is wheelchair accessible.",
        "Staff checked this whole route.",
        "This route has no steep sections.",
    ]:
        ans = base.model_copy(update={"summary": text})
        probes[text] = validate.validate_answer(ans, rec)
    report("estimated_route_validator_baits", route_status=rec.route_status[rid], probes=probes)
    # Distances bind to category, not exact place identity.
    ctx = context(load_world(SEED))
    rec = TurnRecord()
    deps = agent.Deps(ctx=ctx, rec=rec, request=ChatRequest(message="route", profile="default"))
    await agent.call_tool(deps, "find_place", query="Surau Rentak Perdana")
    await agent.call_tool(
        deps,
        "plan_route",
        from_id="osm-way-910405528",
        to_id="osm-way-910378231",
        profile="default",
    )
    rid = next(iter(rec.routes))
    r = rec.routes[rid]
    base = template.template_answer(rec, "route")
    origin = ctx.world.places[r["from_place"]].name
    dest = ctx.world.places[r["to_place"]].name
    ans = base.model_copy(
        update={
            "summary": f"From Surau Rentak Perdana to {dest}, the route is {r['distance_m']} m."
        }
    )
    report(
        "wrong_place_same_category_distance_accepted",
        actual_origin=origin,
        claimed_origin="Surau Rentak Perdana",
        destination=dest,
        summary=ans.summary,
        errors=validate.validate_answer(ans, rec),
    )
    # Real-seed census for documented limitations and ignored tags.
    world = ctx.world
    report(
        "seed_survey_and_surface_census",
        edges=len(world.edges),
        places=len(world.places),
        centres=Counter(c.source for c in world.centres.values()),
        smoothness=Counter(e.osm_tags.get("smoothness", "missing") for e in world.edges.values()),
        verified_levels=sum(
            assess_access(e, world.profiles["wheelchair"]).level == "verified"
            for e in world.edges.values()
        ),
    )
    report(
        "personal_data_redaction_formats",
        samples={
            s: redact(s)
            for s in [
                "My phone is +60 (12) 345-6789",
                "My IC is 900101 14 5678",
                "My phone is 012-345 6789",
            ]
        },
    )
    report(
        "scope_refuses_valid_access_wording",
        probes={
            s: outside_scope(s)
            for s in [
                "I imagine walking from Car Park B to the playground. Is there a route?",
                "Can I walk from the recycling centre to the mall?",
                "Which wheelchair route avoids the rubbish beside the path?",
                "Can I get to the mall if the path is closed?",
            ]
        },
    )
    Path("/tmp/tl-mean-audit-results.json").write_text(
        json.dumps(
            {
                "backend": "e059295 + merge origin control 801f986",
                "ai_snapshot": "bbc98b4",
                "findings": findings,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


asyncio.run(main())
