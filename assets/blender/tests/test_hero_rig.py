"""Pure tests for the hero rig (C-T3): bones, skin weights, IK, clip timing, manifest."""

import math

import pytest
from tl_assets.characters import manifest, parts, props, rig


def test_bone_budget_and_hierarchy():
    for v in rig.VARIANTS:
        bones = rig.bones(v)
        names = [b.name for b in bones]
        assert len(bones) <= rig.MAX_BONES
        assert len(set(names)) == len(names)
        assert names == list(rig.BONE_NAMES)  # one skeleton contract for every variant
        seen: set[str] = set()
        for b in bones:  # parents come first
            assert b.parent is None or b.parent in seen, b.name
            seen.add(b.name)
    skirt = [n for n in rig.BONE_NAMES if n.startswith("skirt_")]
    assert 2 <= len(skirt) <= 4


def _all_vertices():
    for group, _role, (pv, _f) in parts.hero_parts("tpose"):
        for v in pv:
            yield group, v


def test_weights_normalised_and_capped():
    names = set(rig.BONE_NAMES)
    deform = {b.name for b in rig.bones() if b.deform}
    for group, v in _all_vertices():
        w = rig.vertex_weights(group, v)
        assert 1 <= len(w) <= rig.MAX_INFLUENCES
        assert sum(w.values()) == pytest.approx(1.0)
        assert set(w) <= names and set(w) <= deform


def test_seams_share_one_field():
    """Cape over torso and baju hem over kain take the same weights where they overlap, and the
    seams are not rigid per-shell 1.0 weights (H9: no gap at neck, shoulder or hem)."""
    for z in (0.40, 0.45, 0.60, 0.78):
        p = (0.1, -0.15, z)
        assert rig.vertex_weights("torso", p) == pytest.approx(rig.vertex_weights("kain", p))
    p = (0.0, 0.18, 0.75)
    assert rig.vertex_weights("tudung_cape", p) == pytest.approx(rig.vertex_weights("torso", p))
    top = rig.vertex_weights("tudung_cape", (0.0, 0.0, 1.06))
    assert top.get("neck", 0) > 0.2 and top.get("head", 0) > 0.1
    hip = rig.vertex_weights("kain", (0.0, -0.18, 0.44))
    assert max(hip.values()) < 0.9  # blended across the hip line
    cuff = rig.vertex_weights("arm_L", (0.555, 0.0, 0.865))
    assert 0 < cuff.get("hand_L", 0) < 1


def test_two_bone_reaches_and_clamps():
    mid, end = rig.two_bone((0, 0, 0), (0.3, 0, 0), 0.2, 0.2, (0, 0, 1))
    assert math.dist(end, (0.3, 0, 0)) < 1e-9
    assert math.dist(mid, (0, 0, 0)) == pytest.approx(0.2)
    assert math.dist(mid, end) == pytest.approx(0.2)
    assert mid[2] > 0  # bends towards the pole
    _mid, end = rig.two_bone((0, 0, 0), (1.0, 0, 0), 0.2, 0.2, (0, 0, 1))
    assert end[0] == pytest.approx(0.4, abs=1e-4)


def test_clip_timing():
    for v in rig.VARIANTS:
        d = rig.durations(v)
        assert set(d) == set(rig.CLIPS)
        assert d["sit_down"] <= 1.5 and d["stand_up"] <= 1.5


@pytest.mark.parametrize("variant", rig.VARIANTS)
def test_loops_are_seamless(variant):
    for clip in rig.LOOPS:
        dur = rig.durations(variant)[clip]
        a, b = rig.clip_pose(variant, clip, 0.0), rig.clip_pose(variant, clip, dur)
        assert a.hips == pytest.approx(b.hips, abs=1e-9)
        assert a.leg_L.ankle == pytest.approx(b.leg_L.ankle, abs=1e-9)
        assert a.arm_L.pos == pytest.approx(b.arm_L.pos, abs=1e-9)
        for k in a.rot:
            assert a.rot[k] == pytest.approx(b.rot[k], abs=1e-9)
        # the wheelchair wheel turns half a turn per cycle: six spokes, so it looks the same
        assert (b.wheel - a.wheel) % (math.tau / 6) == pytest.approx(0.0, abs=1e-9)


def test_stand_up_mirrors_sit_down():
    for v in rig.VARIANTS:
        d = rig.durations(v)["sit_down"]
        assert rig.clip_pose(v, "stand_up", 0.0) == rig.clip_pose(v, "sit_down", d)
        assert rig.clip_pose(v, "stand_up", d).hips == pytest.approx(
            rig.clip_pose(v, "idle", 0.0).hips, abs=0.003
        )


def test_walk_stance_slides_at_stride_per_cycle():
    for v in ("walker", "stroller", "none"):
        dur, stride = rig.WALK_DURATION[v], rig.STRIDE[v]
        y0 = rig.walk_pose(v, 0.1 * dur).leg_L.ankle[1]
        y1 = rig.walk_pose(v, 0.4 * dur).leg_L.ankle[1]
        assert y1 - y0 == pytest.approx(stride * 0.3)  # stance: back at stride / duration
        assert rig.walk_pose(v, 0.25 * dur).leg_L.ankle[2] == pytest.approx(rig.ANKLE_Z)


def test_legs_reach_their_targets():
    """No straight-leg pops: every ankle target is inside the leg's reach in every clip."""
    for v in rig.VARIANTS:
        for clip in rig.CLIPS:
            dur = rig.durations(v)[clip]
            for i in range(31):
                p = rig.clip_pose(v, clip, dur * i / 30)
                for leg, x in ((p.leg_L, rig.LEG_X), (p.leg_R, -rig.LEG_X)):
                    hip = (x + p.hips[0], p.hips[1], rig.HIP_Z + p.hips[2])
                    assert math.dist(hip, leg.ankle) <= rig.THIGH + rig.SHIN, (v, clip, i)


def test_sit_pose_rests_on_the_bench():
    p = rig.sit_pose("walker")
    hip_z = rig.HIP_Z + p.hips[2]
    assert abs(hip_z - rig.SEAT_Z) * 1.5 <= 0.05  # H7, displayed
    assert p.hips[1] > rig.SEAT_EDGE_Y  # over the seat, behind its front edge
    assert p.leg_L.ankle[1] < rig.SEAT_EDGE_Y  # feet hang in front of the seat


def test_props_triangle_budget():
    from tl_assets.characters import geom

    for name, fn in (
        ("stroller", props.stroller_parts),
        ("wheelchair", props.wheelchair_parts),
        ("wheels", props.wheelchair_wheels),
    ):
        tris = sum(geom.tri_count(f) for _g, _r, (_v, f) in fn())
        assert tris < 4200, name
    body = parts.measure(parts.hero_parts("tpose"))["tris"]
    wc = sum(
        geom.tri_count(f)
        for _g, _r, (_v, f) in props.wheelchair_parts() + props.wheelchair_wheels()
    )
    assert 6000 <= body + wc <= 15000  # H3 LOD0 with the heaviest prop


def test_manifest_build():
    stats = {
        v: {
            "lods": [{"node": "hero__LOD0", "tris": 9000, "maxM": 40.0}],
            "clips": {
                c: {"duration": rig.durations(v)[c], "loop": c in rig.LOOPS} for c in rig.CLIPS
            },
            "sit": {"hips": [0.0, 0.28, 0.48]},
        }
        for v in rig.VARIANTS
    }
    m = manifest.build(stats, dict.fromkeys(rig.VARIANTS, 1000), "2026-10-19")
    assert m["clips"] == list(rig.CLIPS)
    assert m["variants"]["walker"]["profile"] == "older_adult_rest"
    assert m["variants"]["walker"]["sitHips"] == [0.0, 0.48, -0.28]
    assert m["bench"] == {"seatY": rig.SEAT_Z, "frontEdgeZ": -rig.SEAT_EDGE_Y}
