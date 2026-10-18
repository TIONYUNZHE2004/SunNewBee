import math

from data.scripts import report_fallbacks as rf

KX, KY = rf.metres_per_degree(rf.HERO_CENTRE)
SPEC = rf.spec_by_id()


def ring(pts):
    cx, cy = rf.HERO_CENTRE
    out = [[cx + x / KX, cy + y / KY] for x, y in pts]
    return [*out, out[0]]


def rect(x0, y0, w, d):
    return ring([(x0, y0), (x0 + w, y0), (x0 + w, y0 + d), (x0, y0 + d)])


def feat(fid, arch, r, height=8.5, front=None):
    props = {"id": fid, "display_height_m": height}
    if arch:
        props["archetype"] = arch
    if front is not None:
        props["front_deg"] = front
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Polygon", "coordinates": [r]},
    }


def test_fits():
    f = feat("a", "link_intermediate", rect(0, 0, 6.4, 15.5))
    assert rf.classify(f, SPEC["link_intermediate"]) == "fit"


def test_l_shape_is_fill():
    pts = [(0, 0), (6.4, 0), (6.4, 5), (3, 5), (3, 15.5), (0, 15.5)]
    f = feat("a", "link_intermediate", ring(pts))
    assert rf.classify(f, SPEC["link_intermediate"]) == "fill"


def test_too_deep_is_sz():
    f = feat("a", "link_intermediate", rect(0, 0, 6.4, 40))
    assert rf.classify(f, SPEC["link_intermediate"]) == "sz"


def test_missing_archetype_and_asset():
    assert rf.classify(feat("a", None, rect(0, 0, 6.4, 15.5)), None) == "no_archetype"
    assert rf.classify(feat("a", "nope", rect(0, 0, 6.4, 15.5)), None) == "no_asset"


def test_row_end_unit_in_histogram():
    feats = [
        feat("r0", "link_intermediate", rect(0, 0, 6.4, 15.5)),
        feat("r1", "link_intermediate", rect(6.4, 0, 6.4, 15.5)),
        feat("r2", "link_intermediate", rect(12.8, 0, 8.8, 15.5)),
    ]
    rows = rf.analyse(feats, SPEC)
    by_id = {r.id: r for r in rows}
    assert by_id["r0"].reason == "fit"
    assert by_id["r1"].reason == "fit"
    assert by_id["r2"].reason == "sx"
    assert by_id["r2"].row_end
    assert math.isclose(by_id["r2"].obb_w, 8.8, abs_tol=0.05)
    assert rf.end_width_histogram(rows) == {8.0: 1}
