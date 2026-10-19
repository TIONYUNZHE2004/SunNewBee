"""Render the hero modelling sheet (C-T2 owner gate). Headless Blender 5.2:

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
        --python-exit-code 1 -P assets/blender/tl_assets/characters/sheet.py -- --out <dir>

Writes to <dir>: one 768x1024 EEVEE tile per view (`tiles/*.png`), the composed sheets
`hero_sheet.png` (row 1 T-pose, row 2 walker pose: front, side, back, 3/4) and
`hero_cameras.png` (row 1: follow camera, straight behind, side, 3/4 face; row 2: 3/4 front,
the follow direction at 30 m and 80 m displayed distance),
`hero_vs_prototype.png` (the prototype's primitive hero beside this one, same
displayed scale), `hero_stats.json` (triangles, materials, measured head ratio) and `hero.blend`.

H4 is measured on the upright T-pose (the bind pose). The script exits non-zero when the
measured head ratio is outside 1/2.4-1/2.8.
"""

import argparse
import json
import math
import sys
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[2]
if str(ASSETS_DIR) not in sys.path:
    sys.path.insert(0, str(ASSETS_DIR))

import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

from tl_assets.characters import geom, hero  # noqa: E402
from tl_assets.characters import parts as H  # noqa: E402
from tl_assets.characters import proportions as P  # noqa: E402

TILE = (768, 1024)
BG = (0.93, 0.915, 0.89)
SUN, FILL, WORLD = 3.0, 0.9, 0.9


def reset() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 16
    scene.render.resolution_x, scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    for vt in ("Standard", "AgX"):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    world = bpy.data.worlds.new("sheet_world") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*[P.srgb_to_linear(c) for c in BG], 1.0)
    bg.inputs["Strength"].default_value = WORLD

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = SUN
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(40), 0.0, math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = FILL
    fill.data.angle = math.radians(30)
    fill.data.use_shadow = False
    fill.rotation_euler = (math.radians(60), 0.0, math.radians(150))
    scene.collection.objects.link(fill)

    me = bpy.data.meshes.new("ground")
    r = 150.0
    me.from_pydata([(-r, -r, 0), (r, -r, 0), (r, r, 0), (-r, r, 0)], [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    # albedo chosen so the lit ground lands near the background tone (no blown-out floor)
    irradiance = SUN * math.cos(math.radians(40)) + FILL * math.cos(math.radians(60)) + WORLD
    bsdf.inputs["Base Color"].default_value = (
        *[P.srgb_to_linear(c) * 1.5 / irradiance for c in BG],
        1.0,
    )
    bsdf.inputs["Roughness"].default_value = 0.9
    me.materials.append(mat)
    ground = bpy.data.objects.new("ground", me)
    scene.collection.objects.link(ground)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def aim(cam, loc, target) -> None:
    cam.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render(scene, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def load_rgb(path: Path) -> np.ndarray:
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)  # bottom-up rows, as Blender stores them


def compose(rows: list[list[Path]], out: Path, gap: int = 8) -> None:
    tiles = [[load_rgb(p) for p in row] for row in rows]
    th, tw = tiles[0][0].shape[:2]
    ncol = max(len(r) for r in rows)
    H = len(rows) * th + (len(rows) + 1) * gap
    W = ncol * tw + (ncol + 1) * gap
    canvas = np.ones((H, W, 4), dtype=np.float32)
    canvas[..., :3] = 0.55
    for ri, row in enumerate(tiles):
        y0 = H - (ri + 1) * (th + gap)  # first row at the top (Blender rows are bottom-up)
        for ci, t in enumerate(row):
            x0 = gap + ci * (tw + gap)
            canvas[y0 : y0 + th, x0 : x0 + tw] = t
    img = bpy.data.images.new(out.stem, W, H, alpha=True)
    img.pixels.foreach_set(canvas.ravel())
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()


def prototype_hero(scale: float = 1.55):
    """The prototype's primitive hero (docs/03-product/prototypes/resident-journey/index.html,
    `chibi({hijab, walker, hero})`, scale 1.55), rebuilt from the same primitives for a
    same-scale comparison. three.js (x front, y up, z side) -> Blender (z, -x, y)."""

    def b(x, y, z):
        return (z * scale, -x * scale, y * scale)

    def sph(c, r, role, sx=1.0, sy=1.0, sz=1.0):
        bc = b(*c)
        return (
            "proto",
            role,
            geom.ellipsoid(bc, (r * sz * scale, r * sx * scale, r * sy * scale), 20, 10),
        )

    def cyl(a, c, r, role):
        return ("proto", role, geom.tube([b(*a), b(*c)], [r * scale] * 2, 12, cap_rings=1))

    def cone(base_y, h, r, role, x=0.0):
        cx, cy, cz = b(x, base_y, 0.0)
        return (
            "proto",
            role,
            geom.lathe([(0.0, h * scale), (r * scale, 0.0), (0.0, 0.0)], 24, center=(cx, cy, cz)),
        )

    cloth, skin, hj, eye, grip, metal = (
        "#7c5cbf",
        "#d9a77c",
        "#c9a8e8",
        "#2b2622",
        "#5a6b7d",
        "#cfd6de",
    )
    parts = [cone(0.005, 1.05, 0.36, cloth)]
    for sz in (-0.29, 0.29):  # arms: capsule hanging from the shoulder, rotated z by -1 rad
        a = -1.0
        tip = (0.30 * math.sin(a), -0.30 * math.cos(a))
        top = (0.06 * math.sin(a), -0.06 * math.cos(a))
        parts.append(cyl((top[0], 0.86 + top[1], sz), (tip[0], 0.86 + tip[1], sz), 0.075, cloth))
    hy = 1.16
    parts += [
        sph((0.0, hy, 0.0), 0.33, skin),
        sph((-0.05, hy + 0.03, 0.0), 0.37, hj),
        sph((0.12, hy - 0.03, 0.0), 0.27, skin),
    ]
    for sz in (-0.1, 0.1):
        parts.append(sph((0.37, hy, sz), 0.04, eye))
    for sz in (-0.19, 0.19):
        parts.append(sph((0.27, hy - 0.08, sz), 0.045, "#f29b9b", sx=0.4, sy=0.6))
    parts.append(cone(0.71, 0.3, 0.42, hj, x=-0.02))
    for wx in (0.45, 0.88):
        for wz in (-0.3, 0.3):
            parts.append(cyl((wx, 0.0, wz), (wx, 0.84, wz), 0.022, metal))
            parts.append(sph((wx, 0.03, wz), 0.055, grip))
    for wz in (-0.3, 0.3):
        parts.append(cyl((0.41, 0.84, wz), (0.91, 0.84, wz), 0.03, grip))
    parts.append(cyl((0.88, 0.6, -0.3), (0.88, 0.6, 0.3), 0.02, metal))
    return hero.make_object("prototype_hero", parts, bpy.data.materials["hero_body"])


def tri_count(obj) -> int:
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def measure(body) -> dict:
    me = body.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)

    def group_z(name):
        gi = body.vertex_groups[name].index
        ids = [v.index for v in me.vertices if any(g.group == gi for g in v.groups)]
        return co[ids, 2]

    top = float(co[:, 2].max())
    bottom = float(co[:, 2].min())
    height = top - bottom
    chin = float(group_z("face").min())
    hood_bottom = float(group_z("head").min())
    return {
        "height_m": round(height, 4),
        "crown_z": round(top, 4),
        "chin_z": round(chin, 4),
        "hood_bottom_z": round(hood_bottom, 4),
        "head_ratio_chin": round(height / (top - chin), 3),
        "head_ratio_hood": round(height / (top - hood_bottom), 3),
        "h4_ok": P.h4_ok(height / (top - chin)),
        "display_height_m": round(height * P.DISPLAY_SCALE, 3),
    }


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="sheet.py")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    out: Path = args.out
    tiles = out / "tiles"
    reset()
    scene, cam = setup_scene()

    tpose, _ = hero.build_hero("tpose")
    body, walker = hero.build_hero("walker")
    rig = bpy.data.objects.new("turn", None)
    scene.collection.objects.link(rig)
    for o in (tpose, body, walker):
        o.parent = rig

    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.0
    views = [("front", 0.0), ("side", 90.0), ("back", 180.0), ("34", 35.0)]
    rows: list[list[Path]] = []
    for pose, objs in (("tpose", [tpose]), ("walker", [body, walker])):
        for o in (tpose, body, walker):
            o.hide_render = o not in objs
        row = []
        for name, deg in views:
            rig.rotation_euler = (0.0, 0.0, math.radians(deg))
            aim(cam, (0.0, -8.0, 0.86), (0.0, 0.0, 0.86))
            if pose == "walker":  # centre the hero-plus-walker footprint in the tile
                rig.location = mathutils.Matrix.Rotation(
                    math.radians(deg), 3, "Z"
                ) @ mathutils.Vector((0.0, 0.2, 0.0))
            else:
                rig.location = (0.0, 0.0, 0.0)
            p = tiles / f"{pose}_{name}.png"
            render(scene, p)
            row.append(p)
        rows.append(row)
    compose(rows, out / "hero_sheet.png")

    # player cameras (perspective, walker pose). True scale = displayed / 1.5 (R-J3).
    rig.rotation_euler = (0.0, 0.0, 0.0)
    rig.location = (0.0, 0.0, 0.0)
    cam.data.type = "PERSP"
    k = 1.0 / P.DISPLAY_SCALE
    follow = mathutils.Vector((4.5, 8.5, 4.2))
    unit = follow.normalized()
    shots = [
        ("follow", tuple(follow * k), (0.0, -0.2, 0.75), 40.0),
        ("behind", (0.0, 3.2, 1.6), (0.0, -0.2, 0.8), 50.0),
        ("side", (3.2, -0.25, 1.1), (0.0, -0.25, 0.75), 50.0),
        ("face34", (1.15, -1.95, 1.35), (0.0, -0.12, 1.08), 50.0),
        ("front34", (2.0, -2.6, 1.2), (0.0, -0.2, 0.75), 55.0),
        ("far30", tuple(unit * 30.0 * k), (0.0, -0.2, 0.75), 40.0),
        ("far80", tuple(unit * 80.0 * k), (0.0, -0.2, 0.75), 40.0),
    ]
    paths = []
    for name, loc, target, lens in shots:
        cam.data.lens = lens
        aim(cam, loc, target)
        p = tiles / f"cam_{name}.png"
        render(scene, p)
        paths.append(p)
    compose([paths[:4], paths[4:]], out / "hero_cameras.png")

    # beside the prototype's primitive hero, both at their displayed scale
    proto = prototype_hero()
    proto.location = (-1.9, 0.0, 0.0)
    for o in (body, walker):
        o.parent = None
        o.scale = (P.DISPLAY_SCALE,) * 3
        o.location = (1.0, 0.0, 0.0)
    tpose.hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = 1024, 768
    row = []
    for name, loc, target in (
        ("vs_front34", (2.6, -6.6, 2.6), (-0.4, -0.3, 1.1)),
        ("vs_follow", (4.5, 8.5, 4.2), (-0.4, -0.3, 1.0)),
    ):
        cam.data.lens = 38.0
        aim(cam, loc, target)
        p = tiles / f"{name}.png"
        render(scene, p)
        row.append(p)
    compose([row], out / "hero_vs_prototype.png")
    for o in (body, walker):
        o.scale = (1.0, 1.0, 1.0)
        o.location = (0.0, 0.0, 0.0)

    stats = {
        "pose_tpose_body_tris": tri_count(tpose),
        "pose_walker_body_tris": tri_count(body),
        "walker_tris": tri_count(walker),
        "lod0_total_tris": tri_count(body) + tri_count(walker),
        "materials": sorted({m.name for o in (body, walker) for m in o.data.materials}),
        "vertex_groups": [g.name for g in body.vertex_groups],
        **measure(tpose),
        "h4_pose": "tpose",
        "walker_pose_head_ratio": round(H.measure(H.hero_parts("walker"))["head_ratio"], 3),
    }
    (out / "hero_stats.json").write_text(json.dumps(stats, indent=2) + "\n", newline="\n")
    print(json.dumps(stats, indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "hero.blend"))
    if not stats["h4_ok"]:
        raise RuntimeError(f"H4 failed: head ratio {stats['head_ratio_chin']} outside {P.H4_RANGE}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
