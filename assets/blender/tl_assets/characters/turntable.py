"""Acceptance renders for the rigged hero (C-T3 checkpoint b), called by `export_hero.py
--render <dir>`: turntables in `walk` and `sit_idle`, walk phases from the side, and the
`sit_idle` side view on a bench of the H7 size (seat top 0.45 m true). EEVEE, 16 samples.
"""

import math
from pathlib import Path

import bpy
import mathutils

from tl_assets.characters import proportions as P
from tl_assets.characters import rig, sheet

TILE = (512, 640)


def _box(name: str, lo, hi, colour: str):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (
        *[P.srgb_to_linear(c) for c in P.hex_rgb(colour)],
        1.0,
    )
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bench() -> list:
    """The reference bench of the sit clips (`rig.BENCH_SEAT`, `rig.BENCH_BACK`; the manifest's
    `bench`), in the hero's frame (true metres), plus two legs."""
    depth = rig.BENCH_DEPTH
    y0, z = rig.SEAT_EDGE_Y, rig.SEAT_Z
    seat = _box("bench_seat", *rig.BENCH_SEAT, "#c98b55")
    back = _box("bench_back", *rig.BENCH_BACK, "#c98b55")
    legs = [
        _box(
            f"bench_leg{i}",
            (x - 0.03, y0 + 0.02, 0.0),
            (x + 0.03, y0 + depth - 0.02, z - 0.06),
            "#4b5563",
        )
        for i, x in enumerate((-0.55, 0.55))
    ]
    return [seat, back, *legs]


def _frame(arm, act, frame: int) -> None:
    arm.animation_data.action = act
    if act.slots and arm.animation_data.action_slot is None:
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)


def render_all(arm, acts: list, variant: str, out: Path) -> None:
    out = Path(out)
    tiles = out / "tiles"
    scene, cam = sheet.setup_scene()
    scene.render.resolution_x, scene.render.resolution_y = TILE
    by_name = {a.name: a for a in acts}
    turn = bpy.data.objects.new("turn", None)
    scene.collection.objects.link(turn)
    arm.parent = turn
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.0
    benches = bench()
    for b in benches:
        b.parent = turn

    def shoot(name: str, deg: float, target_z: float = 0.75) -> Path:
        turn.rotation_euler = (0.0, 0.0, math.radians(deg))
        sheet.aim(cam, (0.0, -8.0, target_z), (0.0, 0.0, target_z))
        p = tiles / f"{name}.png"
        sheet.render(scene, p)
        return p

    angles = [0, 45, 90, 135, 180, 225, 270, 315]
    for b in benches:
        b.hide_render = True
    walk = by_name["walk"]
    n = rig.frame_count(rig.durations(variant)["walk"])
    _frame(arm, walk, n // 4)
    row1 = [shoot(f"walk_{a:03d}", a) for a in angles[:4]]
    row2 = [shoot(f"walk_{a:03d}", a) for a in angles[4:]]
    phases = []
    for i in range(4):
        _frame(arm, walk, round(i * n / 4))
        phases.append(shoot(f"walk_side_ph{i}", 90))
    sheet.compose([row1, row2, phases], out / "turntable_walk.png")

    for b in benches:
        b.hide_render = False
    sit = by_name["sit_idle"]
    _frame(arm, sit, 0)
    row1 = [shoot(f"sit_{a:03d}", a) for a in angles[:4]]
    row2 = [shoot(f"sit_{a:03d}", a) for a in angles[4:]]
    sheet.compose([row1, row2], out / "turntable_sit_idle.png")

    # side view of sit_idle on the bench, plus sit_down / stand_up mid frames
    scene.render.resolution_x, scene.render.resolution_y = 768, 768
    cam.data.ortho_scale = 1.9
    side = [shoot("sit_side", 90, 0.8), shoot("sit_side_back34", 135 + 90, 0.8)]
    for clip in ("sit_down", "stand_up"):
        m = rig.frame_count(rig.durations(variant)[clip])
        _frame(arm, by_name[clip], m // 2)
        side.append(shoot(f"{clip}_mid_side", 90, 0.8))
    sheet.compose([side], out / "sit_side.png")

    # follow camera (walk) and the H9 seam check close-ups (neck and wrist) in walk / sit_idle
    cam.data.type = "PERSP"
    turn.rotation_euler = (0.0, 0.0, 0.0)
    for b in benches:
        b.hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = 768, 768
    k = 1.0 / P.DISPLAY_SCALE
    shots = []
    for name, act, fr, loc, target, lens in (
        ("follow_walk", walk, n // 4, (4.5 * k, 8.5 * k, 4.2 * k), (0.0, -0.2, 0.75), 40.0),
        ("behind_walk", walk, n // 2, (0.0, 3.0, 1.5), (0.0, -0.2, 0.8), 50.0),
        ("face34_walk", walk, 0, (1.0, -1.7, 1.3), (0.0, -0.1, 1.05), 50.0),
        ("wrist_walk", walk, n // 4, (0.9, -0.9, 0.85), (0.28, -0.32, 0.64), 70.0),
    ):
        cam.data.lens = lens
        _frame(arm, act, fr)
        cam.location = loc
        d = mathutils.Vector(target) - mathutils.Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        p = tiles / f"{name}.png"
        sheet.render(scene, p)
        shots.append(p)
    sheet.compose([shots], out / "cameras_walk.png")
    arm.parent = None
    closeups(arm, by_name, n, scene, cam, benches, tiles, out)


def closeups(arm, by_name, n, scene, cam, benches, tiles, out: Path) -> None:
    """Touch-up QA: the lap in sit_idle (front, high), the back of the tudung and the back of
    the clothing in sit_idle and walk, from close perspective cameras."""
    cam.data.type = "PERSP"
    scene.render.resolution_x, scene.render.resolution_y = 640, 640
    for b in benches:
        b.hide_render = False
    sit, walk = by_name["sit_idle"], by_name["walk"]
    shots = []
    for name, act, fr, loc, target, lens in (
        ("lap_front", sit, 0, (0.0, -1.1, 1.25), (0.0, -0.25, 0.55), 50.0),
        ("lap_side", sit, 0, (1.1, -0.3, 0.75), (0.0, -0.25, 0.55), 50.0),
        ("lap_top", sit, 0, (0.5, -0.9, 1.5), (0.0, -0.25, 0.5), 50.0),
        ("sit_back_close", sit, 0, (0.0, 1.2, 1.1), (0.0, 0.0, 0.9), 50.0),
        ("sit_back_high", sit, 0, (0.4, 1.0, 1.5), (0.0, 0.0, 0.85), 50.0),
        ("walk_back_close", walk, n // 4, (0.0, 1.1, 1.05), (0.0, 0.0, 0.9), 50.0),
        ("walk_back_low", walk, n // 2, (0.3, 1.0, 0.7), (0.0, 0.0, 0.55), 50.0),
    ):
        cam.data.lens = lens
        for b in benches:
            b.hide_render = act is walk
        _frame(arm, act, fr)
        cam.location = loc
        d = mathutils.Vector(target) - mathutils.Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        p = tiles / f"{name}.png"
        sheet.render(scene, p)
        shots.append(p)
    sheet.compose([shots[:4], shots[4:]], out / "closeups.png")
