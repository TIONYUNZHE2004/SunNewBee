"""The `route.compare` scene intent payload (demo polish B4), built from compare_routes' data.

The server fills it from the tool result recorded this turn (TurnRecord.compares); the model only
names the intent and the recommended route id, so no number in the payload is model-written.
"""

from __future__ import annotations

from .events import CompareEnd, CompareRoute, CompareSegment, RouteCompare, SceneIntent


def _end(world, place_id: str) -> CompareEnd:
    p = world.places.get(place_id)
    return CompareEnd(id=place_id, name=p.name if p else place_id)


def _route(r: dict | None) -> CompareRoute | None:
    if r is None:
        return None
    return CompareRoute(
        id=r["id"],
        status=r["status"],
        distance_m=r["distance_m"],
        est_minutes=r["est_minutes"],
        coordinates=[list(c[:2]) for c in (r.get("geometry") or {}).get("coordinates") or []],
        segments=[CompareSegment(edge_id=s["edge_id"], eval=s["eval"]) for s in r["segments"]],
    )


def compare_payload(world, d: dict) -> RouteCompare:
    """`d` is compare_routes' data as recorded (CompareResult.model_dump(mode="json") plus the
    call's from_id / to_id)."""
    return RouteCompare(
        from_place=_end(world, d["from_id"]),
        to_place=_end(world, d["to_id"]),
        profile=d["profile"],
        status=d["status"],
        same_path=d["same_path"],
        fastest=_route(d.get("fastest")),
        recommended=_route(d.get("recommended")),
        stop=d.get("stop"),
        reasons=d["reasons"],
        extra_minutes=d.get("extra_minutes"),
        unchecked=d.get("unchecked") or [],
        pois=d.get("pois") or [],
        vr=d.get("vr"),
        confirm_n=d.get("confirm_n"),
    )


def compare_for(rec, route_id: str | None) -> dict | None:
    """The compare this turn whose recommended route is `route_id` (the latest one); with no
    route id, the latest compare that has no recommended route (no_data / blocked)."""
    for d in reversed(rec.compares):
        rid = (d.get("recommended") or {}).get("id")
        if rid == route_id:
            return d
    return None


# The demo corridor (data/scripts/build_overlay.py DEMO_CORRIDOR, demo polish B5); the web's
# recorded compare fixtures are this intent (B6, packages/agent/tests/test_compare_fixtures.py).
DEMO = ("lakeside-mall", "osm-way-910487880", "wheelchair")
FIXTURES = (
    "apps/web/src/features/journey/fixtures/compare.elmina.json",
    "apps/web/e2e/fixtures/compare-intent.json",
)


def build_intent(world, from_id: str, to_id: str, profile: str) -> SceneIntent:
    """The route.compare intent a chat turn emits for this route question (the mock's
    compare_routes call with a fresh ticket store), as run.py attaches it."""
    from townshiplens_spatial import tools
    from townshiplens_spatial.vr_store import VerificationStore

    from .agent import route_summary

    ctx = tools.Ctx(world=world, vrs=VerificationStore(":memory:"))
    summary = route_summary(world, profile, from_id, to_id)
    res = tools.compare_routes(ctx, from_id, to_id, profile, question_summary=summary)
    d = {**res.data, "from_id": from_id, "to_id": to_id}
    rid = (d.get("recommended") or {}).get("id")
    return SceneIntent(kind="route.compare", route_id=rid, compare=compare_payload(world, d))


def main(argv: list[str] | None = None) -> None:
    import argparse
    from pathlib import Path

    from townshiplens_spatial.world import load_world

    from .settings import ROOT

    ap = argparse.ArgumentParser(description="Dump the demo corridor's route.compare intent")
    ap.add_argument("--world", type=Path, default=ROOT / "data/seed/elmina")
    ap.add_argument("--dump", type=Path, action="append", help="write here (repeatable)")
    args = ap.parse_args(argv)
    text = build_intent(load_world(args.world), *DEMO).model_dump_json(indent=2) + "\n"
    for path in args.dump or [ROOT / f for f in FIXTURES]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
