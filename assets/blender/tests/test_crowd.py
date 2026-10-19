"""Pure tests for the crowd (C-T6): bodies, outfits, looks (P1, P2), budgets (P4), rig and clips."""

import math
import re

import pytest
from tl_assets.characters import crowd, crowd_looks, crowd_rig, geom

BODY_IDS = ("child", "school_age", "adult_man", "adult_woman", "older_man", "older_woman")


def _tris(parts) -> int:
    return sum(geom.tri_count(f) for _g, _r, (_v, f) in parts)


def _roles(parts) -> set[str]:
    out = set()
    for _g, role, (pv, pf) in parts:
        for f in pf:
            c = tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3))
            out.add(crowd.role_at(role, c))
    return out


# --- P1: bodies --------------------------------------------------------------------------------


def test_six_base_bodies_with_distinct_proportions():
    assert tuple(crowd.BODIES) == BODY_IDS
    b = crowd.BODIES
    assert b["child"].height < b["school_age"].height < b["adult_woman"].height
    assert b["adult_woman"].height < b["adult_man"].height
    # bigger heads on the young (chibi family, same as the hero's 2.4-2.8)
    assert b["child"].head_ratio < b["school_age"].head_ratio < b["adult_man"].head_ratio
    for k in ("adult_man", "adult_woman", "older_man", "older_woman"):
        assert 2.4 <= b[k].head_ratio <= 2.8, k
    assert b["older_man"].stoop > 0 and b["older_woman"].stoop > 0
    for k in ("child", "school_age", "adult_man", "adult_woman"):
        assert b[k].stoop == 0
    shapes = {(x.height, x.head_ratio, x.stoop, x.shoulder_w, x.hip_w) for x in b.values()}
    assert len(shapes) == 6


@pytest.mark.parametrize("body", BODY_IDS)
def test_measured_head_ratio_matches_the_body(body):
    for outfit in crowd.BODY_OUTFITS[body]:
        m = crowd.measure(crowd.person_parts(body, outfit, 0))
        assert m["head_ratio"] == pytest.approx(crowd.BODIES[body].head_ratio, abs=0.3), outfit
        assert m["min_z"] == pytest.approx(0.0, abs=0.005)


# --- P2: outfits and looks ---------------------------------------------------------------------


def test_every_body_has_three_local_outfits():
    for body in BODY_IDS:
        assert len(crowd.BODY_OUTFITS[body]) >= 3, body
    cats = {crowd.OUTFITS[o].category for outs in crowd.BODY_OUTFITS.values() for o in outs}
    assert {
        "baju_kurung",
        "baju_melayu",
        "school_shirt",
        "school_pinafore",
        "office",
        "casual",
    } <= cats


def test_outfit_pairings_are_culturally_complete():
    for oid, o in crowd.OUTFITS.items():
        if o.category in ("baju_kurung", "school_pinafore"):
            assert o.headwear == "tudung", oid
            assert o.sleeves == "long" and o.skirt == "ankle", oid
        if o.category == "baju_melayu":
            assert o.headwear == "songkok" and o.sleeves == "long" and o.samping, oid
        if o.category == "school_shirt":
            assert o.legs == "trousers", oid


@pytest.mark.parametrize("body", BODY_IDS)
def test_tudung_covers_hair_ears_and_neck(body):
    lay = crowd.layout(crowd.BODIES[body])
    for oid in crowd.BODY_OUTFITS[body]:
        o = crowd.OUTFITS[oid]
        parts = crowd.person_parts(body, oid, 0)
        roles = _roles(parts)
        if o.headwear == "tudung":
            assert "hair" not in roles, oid
            groups = {g for g, _r, _m in parts}
            assert {"hood", "cape"} <= groups, oid
            # no skin between the chin and the shoulders (the neck), front or back
            for g, role, (pv, pf) in parts:
                for f in pf:
                    c = tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3))
                    if crowd.role_at(role, c) == "skin" and g not in ("face", "hand_L", "hand_R"):
                        assert not (lay.shoulder_z < c[2] < lay.chin), (oid, g, c)
            # the head behind the face opening sits inside the hood (hair and ears covered)
            hood = [v for g, _r, (pv, _f) in parts if g == "hood" for v in pv]
            assert max(v[1] for v in hood) > lay.head_c[1] + lay.head_r[1], oid
        if o.sleeves == "long":
            for g, role, (pv, pf) in parts:
                if g.startswith("arm_"):
                    for f in pf:
                        c = tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3))
                        assert crowd.role_at(role, c) != "skin", (oid, g)
        if o.skirt == "ankle":
            skirt = [v for g, _r, (pv, _f) in parts if g == "skirt" for v in pv]
            assert min(v[2] for v in skirt) < 0.06, oid


def test_looks_count_and_coverage():
    looks = crowd_looks.LOOKS
    assert len(looks) >= 24
    assert len({lk.id for lk in looks}) == len(looks)
    keys = {(lk.body, lk.outfit, lk.prop, tuple(sorted(lk.palette.items()))) for lk in looks}
    assert len(keys) == len(looks)
    for body in BODY_IDS:
        outs = {lk.outfit for lk in looks if lk.body == body}
        assert outs == set(crowd.BODY_OUTFITS[body]), body
        assert len(outs) >= 3
    assert {lk.prop for lk in looks if lk.prop} == set(crowd.PROPS)
    for lk in looks:
        assert lk.outfit in crowd.BODY_OUTFITS[lk.body], lk.id
        assert set(lk.palette) == set(crowd.ROLES), lk.id
        for v in lk.palette.values():
            assert re.fullmatch(r"#[0-9a-f]{6}", v), (lk.id, v)


def _lum(hex_: str) -> float:
    r, g, b = (int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def test_school_uniform_colours_read_as_uniforms():
    for lk in crowd_looks.LOOKS:
        cat = crowd.OUTFITS[lk.outfit].category
        if cat == "school_shirt":
            assert _lum(lk.palette["top"]) > 0.85, lk.id  # white shirt
            assert _lum(lk.palette["bottom"]) < 0.25, lk.id  # dark trousers
        if cat == "school_pinafore":
            assert _lum(lk.palette["top"]) > 0.85, lk.id  # white blouse
            assert _lum(lk.palette["headwear"]) > 0.85, lk.id  # white tudung
        if crowd.OUTFITS[lk.outfit].headwear == "songkok":
            assert _lum(lk.palette["headwear"]) < 0.12, lk.id  # black songkok


# --- P4: budgets -------------------------------------------------------------------------------


@pytest.mark.parametrize("lod", (0, 1))
def test_look_triangle_budgets(lod):
    for lk in crowd_looks.LOOKS:
        n = _tris(crowd.person_parts(lk.body, lk.outfit, lod))
        if lk.prop:
            n += _tris(crowd.prop_parts(lk.body, lk.prop, lod))
        assert n <= crowd.LOD_MAX_TRIS[lod], (lk.id, lod, n)
        assert n >= crowd.LOD_MAX_TRIS[lod] * 0.4, (lk.id, lod, n)  # not a blob


def test_roles_are_known():
    for body in BODY_IDS:
        for oid in crowd.BODY_OUTFITS[body]:
            for lod in (0, 1):
                assert _roles(crowd.person_parts(body, oid, lod)) <= set(crowd.ROLES)
    for body in BODY_IDS:
        for p in crowd.PROPS:
            assert _roles(crowd.prop_parts(body, p, 0)) <= set(crowd.ROLES)


def test_role_uv_round_trips():
    for i, r in enumerate(crowd.ROLES):
        assert crowd.role_from_u(crowd.role_u(r)) == r
        assert crowd.role_u(r) == pytest.approx((i + 0.5) / len(crowd.ROLES))


# --- rig ---------------------------------------------------------------------------------------


def test_bones_budget_and_one_skeleton():
    names = None
    for body in BODY_IDS:
        bones = crowd_rig.bones(body)
        assert len(bones) <= crowd_rig.MAX_BONES == 20
        seen: set[str] = set()
        for b in bones:
            assert b.parent is None or b.parent in seen, b.name
            seen.add(b.name)
        if names is None:
            names = [b.name for b in bones]
        assert [b.name for b in bones] == names
    assert {"hips", "spine", "chest", "head", "thigh_L", "shin_R", "upper_arm_L", "hand_R"} <= set(
        names
    )


@pytest.mark.parametrize("body", BODY_IDS)
def test_weights_normalised_and_capped(body):
    deform = {b.name for b in crowd_rig.bones(body) if b.deform}
    for oid in crowd.BODY_OUTFITS[body]:
        for g, _r, (pv, _f) in crowd.person_parts(body, oid, 0):
            for v in pv[:: max(1, len(pv) // 25)]:
                w = crowd_rig.vertex_weights(body, g, v)
                assert 1 <= len(w) <= 4
                assert sum(w.values()) == pytest.approx(1.0)
                assert set(w) <= deform, (g, w)


def _clips_for(body):
    modes = {"free"} | {lk.prop for lk in crowd_looks.LOOKS if lk.body == body and lk.prop}
    return [c for m in sorted(modes) for c in crowd_rig.clip_names(m)]


@pytest.mark.parametrize("body", BODY_IDS)
def test_clips_loop_and_reach(body):
    for clip in _clips_for(body):
        d = crowd_rig.duration(body, clip)
        a, b = crowd_rig.pose(body, clip, 0.0), crowd_rig.pose(body, clip, d)
        for n in a:
            if n == "wheels":  # a quarter turn per cycle on a 90-degree symmetric wheel
                continue
            assert a[n][1] == pytest.approx(b[n][1], abs=1e-6), (clip, n)
            for ra, rb in zip(a[n][0], b[n][0], strict=True):
                assert ra == pytest.approx(rb, abs=1e-6), (clip, n)
        for k in range(13):
            errs = crowd_rig.reach_errors(body, clip, d * k / 12)
            for name, e in errs.items():
                lim = 0.01 if name.startswith("hand") else 0.002
                assert e <= lim, (clip, k, name, e)


def test_clip_durations_are_whole_frames_and_idles_key_at_10_fps():
    for body in BODY_IDS:
        for clip in _clips_for(body):
            d = crowd_rig.duration(body, clip)
            assert d * crowd_rig.FPS == pytest.approx(round(d * crowd_rig.FPS), abs=1e-9), clip
            keys = crowd_rig.key_frames(clip, d)
            assert keys[0] == 0 and keys[-1] == round(d * crowd_rig.FPS)
            steps = {b - a for a, b in zip(keys, keys[1:], strict=False)}
            assert steps == ({3} if clip.startswith("idle") else {1}), clip


@pytest.mark.parametrize("body", BODY_IDS)
def test_walk_stance_foot_moves_at_stride_rate(body):
    for clip in [c for c in _clips_for(body) if c.startswith("walk") and "wheelchair" not in c]:
        d = crowd_rig.duration(body, clip)
        s = crowd_rig.stride(body, clip)
        lay = crowd.layout(crowd.BODIES[body])
        # left foot is in stance for the first 40% of the cycle (0..0.5 minus margins)
        ys = []
        for k in range(5):
            t = d * (0.05 + 0.1 * k)
            p = crowd_rig.joints(body, clip, t)["ankle_L"]
            assert p[2] == pytest.approx(lay.ankle_z, abs=1e-6)
            ys.append(p[1])
        for y0, y1 in zip(ys, ys[1:], strict=False):
            assert y1 - y0 == pytest.approx(s * 0.1, rel=1e-3)  # +y = backwards (she faces -y)


def test_wheelchair_wheel_rolls_at_stride_and_hands_track_the_rim():
    for body in ("older_man", "adult_man", "adult_woman"):
        clip = "walk_wheelchair"
        d = crowd_rig.duration(body, clip)
        wheel = crowd_rig.wheelchair_dims(crowd.BODIES[body])
        turn = crowd_rig.wheel_angle(body, clip, d) - crowd_rig.wheel_angle(body, clip, 0.0)
        assert turn * wheel.wheel_r == pytest.approx(crowd_rig.stride(body, clip), rel=1e-6)
        assert turn == pytest.approx(math.pi / 2)  # 4-spoke wheel: a seamless loop


def test_feet_stay_on_or_above_ground_while_walking():
    for body in BODY_IDS:
        oid = crowd.BODY_OUTFITS[body][0]
        parts = [p for p in crowd.person_parts(body, oid, 1) if p[0].startswith("shoe")]
        for clip in _clips_for(body):
            d = crowd_rig.duration(body, clip)
            for k in range(8):
                posed = crowd_rig.skin_parts(body, parts, clip, d * k / 8)
                lo = min(v[2] for _g, _r, (pv, _f) in posed for v in pv)
                assert lo >= -0.012, (body, clip, k, lo)


def _stats(meshes: bool = True) -> dict:
    out = {}
    for b in BODY_IDS:
        nodes = list(crowd.BODY_OUTFITS[b])
        for lk in crowd_looks.LOOKS:
            if lk.body == b:
                nodes += crowd_looks.prop_meshes(lk.prop)
        out[b] = {
            "bones": 19,
            "clips": {
                c: {"duration": crowd_rig.duration(b, c), "frames": 31} for c in _clips_for(b)
            },
            "meshes": {f"{n}__LOD{i}": 100 for n in nodes for i in (0, 1)} if meshes else {},
        }
    return out


def test_manifest_shape():
    m = crowd_looks.build_manifest(_stats(), {b: 1000 for b in BODY_IDS})
    assert m["roles"] == list(crowd.ROLES)
    assert set(m["bodies"]) == set(BODY_IDS)
    assert len(m["looks"]) == len(crowd_looks.LOOKS)
    for lk in m["looks"]:
        assert lk["clips"]["walk"] in m["bodies"][lk["body"]]["clips"]
        assert lk["clips"]["idle"] in m["bodies"][lk["body"]]["clips"]
        assert lk["tris"][0] > 0
    clips = m["bodies"]["adult_man"]["clips"]
    assert clips["idle"]["keyFps"] == 10 and clips["idle"]["keys"] == 31
    assert clips["walk"]["keyFps"] == 30 and clips["walk"]["keys"] == 31


def test_manifest_builder_raises_on_a_missing_mesh():
    with pytest.raises(KeyError):
        crowd_looks.build_manifest(_stats(meshes=False), {b: 1000 for b in BODY_IDS})


# --- fix round 1 -------------------------------------------------------------------------------


def _shoes_low(body, clip, t):
    parts = [
        p
        for p in crowd.person_parts(body, crowd.BODY_OUTFITS[body][0], 0)
        if p[0].startswith("shoe")
    ]
    out = {}
    for g, _r, (pv, _f) in crowd_rig.skin_parts(body, parts, clip, t):
        zs = sorted(v[2] for v in pv)
        out[g] = (zs[0], sum(1 for z in zs if z <= 0.01))
    return out


@pytest.mark.parametrize("body", BODY_IDS)
def test_feet_touch_the_ground_in_idle_and_stance(body):
    """A flat sole on the ground (<= 1 cm), not a floating pole, in idle and in walk stance."""
    for clip in [c for c in _clips_for(body) if "wheelchair" not in c]:
        d = crowd_rig.duration(body, clip)
        if clip.startswith("idle"):
            for k in range(4):
                for g, (lo, n) in _shoes_low(body, clip, d * k / 4).items():
                    assert -0.012 <= lo <= 0.01 and n >= 3, (clip, k, g, lo, n)
        else:  # left foot in stance at 25% of the cycle, right foot at 75%
            for g, ph in (("shoe_L", 0.25), ("shoe_R", 0.75)):
                lo, n = _shoes_low(body, clip, d * ph)[g]
                assert -0.012 <= lo <= 0.01 and n >= 3, (clip, g, lo, n)


def test_songkok_is_a_short_cap_with_an_edge_band():
    for body in ("child", "adult_man", "older_man"):
        lay = crowd.layout(crowd.BODIES[body])
        parts = crowd.person_parts(body, "baju_melayu", 0)
        cap = [p for p in parts if p[0] == "headwear"]
        top = max(v[2] for _g, _r, (pv, _f) in cap for v in pv)
        crown = lay.head_c[2] + lay.head_r[2]
        assert 0.0 < top - crown <= 0.04 * lay.s, body
        assert {"headwear", "headwear_trim"} <= _roles(cap), body


def test_older_women_read_apart_from_adult_women():
    ow = crowd.person_parts("older_woman", "baju_kurung", 0)
    assert "glasses" in _roles(ow)
    assert 30 <= _tris([p for p in ow if crowd.role_at(p[1], (0, 0, 0)) == "glasses"]) <= 80
    assert "glasses" not in _roles(crowd.person_parts("adult_woman", "baju_kurung", 0))
    # stronger stoop while idle than walking
    idle = crowd_rig.pose("older_woman", "idle", 0.0)["head"][1]
    walk = crowd_rig.pose("older_woman", "walk", 0.0)["head"][1]
    assert idle[1] < walk[1] - 0.015  # neck further forward (-y)

    def chroma(h):
        c = [int(h[i : i + 2], 16) for i in (1, 3, 5)]
        return max(c) - min(c)

    old = [lk for lk in crowd_looks.LOOKS if lk.body == "older_woman"]
    young = [lk for lk in crowd_looks.LOOKS if lk.body == "adult_woman"]
    mean = lambda ls: sum(chroma(lk.palette["top"]) for lk in ls) / len(ls)  # noqa: E731
    assert mean(old) < mean(young)


def test_tudung_back_is_pulled_in():
    lay = crowd.layout(crowd.BODIES["adult_woman"])
    hood = [p for p in crowd.person_parts("adult_woman", "baju_kurung", 0) if p[0] == "hood"][0]
    pv = hood[2][0]
    back = max(v[1] for v in pv) - lay.head_c[1]
    side = max(v[0] for v in pv)
    assert back < side  # flatter at the back than wide
