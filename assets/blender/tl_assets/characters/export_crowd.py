"""Rig, animate and export the crowd kit (C-T6). Headless Blender 5.2:

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
        --disable-autoexec --python-exit-code 1 \
        -P assets/blender/tl_assets/characters/export_crowd.py -- [--body adult_man ...] \
        [--out assets/blender/out/raw/characters] [--sheet <contact-sheet.png>]

Per body it writes `<out>/crowd_<body>.glb` and `<out>/crowd_<body>.json` (stats):
- one 19-bone armature (`crowd_rig.bones`, same names for every body);
- per outfit of the body, a skinned mesh `<outfit>__LOD0` and `<outfit>__LOD1`;
- per prop used by the body's looks, `prop_<prop>__LOD0/1` parented to the `prop` bone (the
  wheelchair's rear wheels are `prop_wheelchair_wheels__LOD0/1` on the `wheels` bone);
- the baked FK clips `walk`, `idle` and, per prop, `walk_<prop>`, `idle_<prop>`.
Every mesh has COLOR_0 (the first look's palette, for plain viewers) and TEXCOORD_0 whose u is
the palette role (`crowd.role_u`), so C-T7 can recolour per look. `pack.py --crowd` compresses
them into apps/web/public/city/characters/ and writes `crowd.json`.

`--sheet <png>` instead renders the contact sheet of every look (front and back rows, EEVEE).
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
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from tl_assets.characters import crowd, crowd_looks, crowd_rig, hero  # noqa: E402
from tl_assets.characters import proportions as P  # noqa: E402

RAW = ASSETS_DIR / "out" / "raw" / "characters"


def reset() -> None:
    for coll in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.actions,
        bpy.data.curves,
    ):
        for block in list(coll):
            coll.remove(block)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    scene = bpy.context.scene
    scene.render.fps = crowd_rig.FPS
    scene.render.fps_base = 1.0


def _lin(hex_: str) -> tuple[float, float, float, float]:
    r, g, b = (P.srgb_to_linear(c) for c in P.hex_rgb(hex_))
    return (r, g, b, 1.0)


def make_mesh(name: str, parts, palette: dict[str, str], material, body_id: str | None = None):
    """One mesh from parts: COLOR_0 from `palette`, TEXCOORD_0.u = role, and (with `body_id`)
    bone vertex groups from `crowd_rig.vertex_weights`."""
    verts: list = []
    faces: list = []
    roles: list[str] = []
    vgroup: list[str] = []
    for group, role, (pv, pf) in parts:
        base = len(verts)
        verts += pv
        vgroup += [group] * len(pv)
        for k, f in enumerate(pf):
            faces.append(tuple(i + base for i in f))
            if isinstance(role, list):  # per-face roles fixed in the bind pose
                roles.append(role[k])
                continue
            c = tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3))
            roles.append(crowd.role_at(role, c))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if len(me.polygons) != len(faces):
        raise RuntimeError(f"{name}: {len(faces)} faces became {len(me.polygons)}")
    nloops = len(me.loops)
    cols = np.zeros((nloops, 4), dtype=np.float32)
    uvs = np.zeros((nloops, 2), dtype=np.float32)
    for poly in me.polygons:
        r = roles[poly.index]
        sl = slice(poly.loop_start, poly.loop_start + poly.loop_total)
        cols[sl] = _lin(palette[r])
        uvs[sl] = (crowd.role_u(r), 0.5)
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", uvs.ravel())
    attr = me.color_attributes.new("COLOR_0", "FLOAT_COLOR", "CORNER")
    attr.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    me.shade_smooth()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if body_id is not None:
        vg = {
            b.name: obj.vertex_groups.new(name=b.name) for b in crowd_rig.bones(body_id) if b.deform
        }
        for i, (v, g) in enumerate(zip(verts, vgroup, strict=True)):
            for bone, w in crowd_rig.vertex_weights(body_id, g, v).items():
                vg[bone].add([i], w, "REPLACE")
    return obj


def posed(body_id: str, parts, clip: str, t: float):
    """Skin bind-pose parts to a clip time, keeping the roles of the bind pose (role functions
    are defined on bind-pose positions, as in the exported glbs)."""
    fixed = []
    for g, role, (pv, pf) in parts:
        roles = [
            crowd.role_at(role, tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3)))
            for f in pf
        ]
        fixed.append((g, roles, (pv, pf)))
    return crowd_rig.skin_parts(body_id, fixed, clip, t)


def tri_count(obj) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def build_armature(body_id: str):
    data = bpy.data.armatures.new(f"crowd_{body_id}_rig")
    arm = bpy.data.objects.new(f"crowd_{body_id}", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b in crowd_rig.bones(body_id):
        eb = data.edit_bones.new(b.name)
        eb.head, eb.tail = b.head, b.tail
        eb.roll = 0.0
        eb.use_deform = b.deform
        if b.parent:
            eb.parent = data.edit_bones[b.parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def bone_parent(obj, arm, bone: str) -> None:
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world


def bake_clip(arm, body_id: str, clip: str):
    names = list(crowd_rig.BONE_NAMES)
    parent = {b.name: b.parent for b in crowd_rig.bones(body_id)}
    rest = {n: arm.data.bones[n].matrix_local.copy() for n in names}
    rest_inv = {n: m.inverted() for n, m in rest.items()}
    d = crowd_rig.duration(body_id, clip)
    keys = crowd_rig.key_frames(clip, d)
    n = keys[-1]
    frames = []
    for f in keys:
        pose = crowd_rig.pose(body_id, clip, d * f / n)
        pm = {}
        basis = {}
        for name in names:
            r, h = pose[name]
            pm[name] = Matrix.LocRotScale(Vector(h), Matrix(r) @ rest[name].to_3x3(), None)
            p = parent[name]
            carry = rest[name] if p is None else pm[p] @ rest_inv[p] @ rest[name]
            basis[name] = carry.inverted() @ pm[name]
        frames.append(basis)
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    arm.animation_data.action = act
    for name in names:
        prev = None
        locs, quats = [], []
        for b in frames:
            loc, q, _sc = b[name].decompose()
            if prev is not None and q.dot(prev) < 0:
                q = -q
            prev = q
            locs.append(loc)
            quats.append(q)
        # key only what moves or differs from rest: an absent channel keeps the rest pose, and
        # the glb stays small (no force-sampled translation/scale on every bone)
        still = all(abs(q.dot(quats[0])) > 1 - 1e-9 for q in quats)
        at_rest = abs(quats[0].w) > 1 - 1e-9
        channels = [] if (still and at_rest) else [("rotation_quaternion", quats, 4)]
        if name == "hips":
            channels.append(("location", locs, 3))
        for path, vals, size in channels:
            for i in range(size):
                fc = act.fcurve_ensure_for_datablock(
                    arm, f'pose.bones["{name}"].{path}', index=i, group_name=name
                )
                co = []
                for k, v in zip(keys, vals, strict=True):
                    co += [float(k), float(v[i])]
                fc.keyframe_points.add(len(vals))
                fc.keyframe_points.foreach_set("co", co)
                fc.keyframe_points.foreach_set("interpolation", [1] * len(vals))  # LINEAR
                fc.update()
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, n
    return act, {"duration": d, "frames": n + 1, "keys": len(keys)}


def first_palette(
    body_id: str, outfit: str | None = None, prop: str | None = None
) -> dict[str, str]:
    for lk in crowd_looks.LOOKS:
        if (
            lk.body == body_id
            and (outfit is None or lk.outfit == outfit)
            and (prop is None or lk.prop == prop)
        ):
            return lk.palette
    raise KeyError((body_id, outfit, prop))


def export_body(body_id: str, out: Path, worker: bool = False) -> dict:
    """`worker=True`: the devsim site worker (adult_man body, outfit `worker`, no props, clips
    walk + idle only) -> `crowd_worker.glb`."""
    reset()
    body_mat = hero.clay_material("crowd_body")
    prop_mat = hero.clay_material("crowd_prop", 0.4, 0.35, 0.0)
    arm = build_armature(body_id)
    arm.animation_data_create()
    keep = [arm]
    meshes = {}
    outfit_ids = ("worker",) if worker else crowd.BODY_OUTFITS[body_id]
    for outfit in outfit_ids:
        pal = crowd_looks.WORKER_LOOK.palette if worker else first_palette(body_id, outfit)
        for lod in (0, 1):
            obj = make_mesh(
                f"{outfit}__LOD{lod}",
                crowd.person_parts(body_id, outfit, lod),
                pal,
                body_mat,
                body_id,
            )
            obj.parent = arm
            mod = obj.modifiers.new("armature", "ARMATURE")
            mod.object = arm
            keep.append(obj)
            meshes[obj.name] = tri_count(obj)
    for prop in [] if worker else [m for m in crowd_looks.modes_for(body_id) if m != "free"]:
        pal = first_palette(body_id, prop=prop)
        for lod in (0, 1):
            parts = crowd.prop_parts(body_id, prop, lod)
            for stem, bone in zip(crowd_looks.prop_meshes(prop), ("prop", "wheels"), strict=False):
                sub = [p for p in parts if p[0] == bone]
                obj = make_mesh(f"{stem}__LOD{lod}", sub, pal, prop_mat)
                bone_parent(obj, arm, bone)
                keep.append(obj)
                meshes[obj.name] = tri_count(obj)
    clips = {}
    acts = []
    for clip in crowd_looks.WORKER_CLIPS if worker else crowd_looks.clips_for(body_id):
        act, info = bake_clip(arm, body_id, clip)
        acts.append(act)
        clips[clip] = info
    arm.animation_data.action = None
    for act in acts:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, 0, act)
    bpy.context.scene.frame_set(0)
    out.mkdir(parents=True, exist_ok=True)
    stem = "worker" if worker else body_id
    path = out / f"crowd_{stem}.glb"
    keep_set = set(keep)
    for o in bpy.data.objects:
        o.select_set(o in keep_set)
    bpy.context.view_layer.objects.active = arm
    props_rna = bpy.ops.export_scene.gltf.get_rna_type().properties
    kw = {
        "filepath": str(path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": False,
        "export_vertex_color": "ACTIVE",
        "export_all_vertex_colors": False,
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": False,
        "export_attributes": False,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
        "export_image_format": "NONE",
        "export_skins": True,
        "export_all_influences": False,
        "export_def_bones": False,
        "export_morph": False,
        "export_animations": True,
        "export_animation_mode": "ACTIONS",
        "export_force_sampling": False,
        "export_frame_step": 1,
        "export_optimize_animation_size": True,
        "export_anim_single_armature": True,
        "export_reset_pose_bones": True,
        "export_draco_mesh_compression_enable": False,
    }
    kw = {k: v for k, v in kw.items() if k in ("filepath", "export_format") or k in props_rna}
    bpy.ops.export_scene.gltf(**kw)
    stats = {
        "body": body_id,
        "bones": len(arm.data.bones),
        "clips": clips,
        "meshes": meshes,
        "raw_bytes": path.stat().st_size,
    }
    (out / f"crowd_{stem}.json").write_text(json.dumps(stats, indent=2) + "\n", newline="\n")
    print(json.dumps(stats))
    return stats


# --- contact sheet -----------------------------------------------------------------------------

TILE = (300, 450)  # the hero sheet's lighting and exposure (sheet.setup_scene), smaller tiles
COLS = 11


def render_sheet(path: Path) -> None:
    from tl_assets.characters import sheet

    sheet.reset()
    scene, cam = sheet.setup_scene()
    scene.render.resolution_x, scene.render.resolution_y = TILE
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.15
    body_mat = hero.clay_material("crowd_body")
    prop_mat = hero.clay_material("crowd_prop", 0.4, 0.35, 0.0)
    label_mat = bpy.data.materials.new("label")
    label_mat.use_nodes = True
    bsdf = next(n for n in label_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.05, 0.06, 1.0)
    tiles = path.parent / "tiles"
    front, back = [], []
    for lk in crowd_looks.LOOKS:
        clip = crowd_rig.clip_names(lk.prop or "free")[1]
        parts = posed(lk.body, crowd.person_parts(lk.body, lk.outfit, 0), clip, 0.0)
        objs = [make_mesh(f"look_{lk.id}", parts, lk.palette, body_mat)]
        if lk.prop:
            pp = posed(lk.body, crowd.prop_parts(lk.body, lk.prop, 0), clip, 0.0)
            objs.append(make_mesh(f"prop_{lk.id}", pp, lk.palette, prop_mat))
        cu = bpy.data.curves.new(f"label_{lk.id}", "FONT")
        cu.body = lk.id
        cu.size = 0.062
        cu.align_x = "CENTER"
        label = bpy.data.objects.new(f"label_{lk.id}", cu)
        label.data.materials.append(label_mat)
        label.rotation_euler = (math.radians(90), 0.0, math.radians(-25))
        label.location = (0.05, -0.75, -0.05)
        scene.collection.objects.link(label)
        for name, yaw, show_label, dest in (
            ("front", -25.0, True, front),
            ("back", 155.0, False, back),
        ):
            a = math.radians(yaw)
            sheet.aim(cam, (8.0 * math.sin(a), -8.0 * math.cos(a), 0.95), (0.0, 0.0, 0.95))
            label.hide_render = not show_label
            p = tiles / f"{lk.id}_{name}.png"
            sheet.render(scene, p)
            dest.append(p)
        for o in [*objs, label]:
            bpy.data.objects.remove(o, do_unlink=True)
    rows = []
    for i in range(0, len(front), COLS):
        rows.append(front[i : i + COLS])
        rows.append(back[i : i + COLS])
    sheet.compose(rows, path)
    import shutil

    shutil.rmtree(tiles, ignore_errors=True)  # keep only the sheet (disk)
    print(f"wrote {path} ({len(front)} looks)")


def render_worker_preview(path: Path) -> None:
    """Front, three-quarter and back views of the worker, LOD0 left and LOD1 right."""
    from tl_assets.characters import sheet

    sheet.reset()
    scene, cam = sheet.setup_scene()
    scene.render.resolution_x, scene.render.resolution_y = TILE
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.15
    body_mat = hero.clay_material("crowd_body")
    tiles = path.parent / "tiles"
    tiles.mkdir(parents=True, exist_ok=True)
    rows = []
    for lod in (0, 1):
        parts = posed("adult_man", crowd.person_parts("adult_man", "worker", lod), "walk", 0.2)
        obj = make_mesh("worker", parts, crowd_looks.WORKER_LOOK.palette, body_mat)
        row = []
        for name, yaw in (("front", -25.0), ("side", 65.0), ("back", 155.0)):
            a = math.radians(yaw)
            sheet.aim(cam, (8.0 * math.sin(a), -8.0 * math.cos(a), 0.95), (0.0, 0.0, 0.95))
            p = tiles / f"w{lod}_{name}.png"
            sheet.render(scene, p)
            row.append(p)
        rows.append(row)
        bpy.data.objects.remove(obj, do_unlink=True)
    sheet.compose(rows, path)
    import shutil

    shutil.rmtree(tiles, ignore_errors=True)
    print(f"wrote {path}")


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="export_crowd.py")
    ap.add_argument("--body", action="append", choices=list(crowd.BODIES), default=[])
    ap.add_argument("--out", type=Path, default=RAW)
    ap.add_argument("--worker", action="store_true", help="export only crowd_worker.glb (AS1)")
    ap.add_argument("--preview", type=Path, default=None, help="render the worker preview png")
    ap.add_argument("--sheet", type=Path, default=None, help="render the contact sheet instead")
    args = ap.parse_args(argv)
    if args.sheet is not None:
        render_sheet(args.sheet)
        return
    if args.preview is not None:
        render_worker_preview(args.preview)
        return
    if args.worker:
        export_body("adult_man", args.out, worker=True)
        return
    for b in args.body or list(crowd.BODIES):
        export_body(b, args.out)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
