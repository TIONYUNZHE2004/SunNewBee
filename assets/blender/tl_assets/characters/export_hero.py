"""Rig, animate and export the journey hero (C-T3). Headless Blender 5.2:

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
        --disable-autoexec --python-exit-code 1 \
        -P assets/blender/tl_assets/characters/export_hero.py -- [--variant walker ...] \
        [--out assets/blender/out/raw/characters] [--render <dir>]

For each variant (walker, stroller, wheelchair, none) it builds the T-pose body (LOD0, and a
decimated LOD1), a 30-bone armature (`rig.bones`), skin weights from `rig.vertex_weights`, the
prop meshes parented to the `prop` (and `wheels`) bones, and bakes the six clips from
`rig.clip_pose` (forward kinematics plus analytic two-bone IK for arms and legs, solved here
with mathutils and keyed as plain FK, so the glb needs no constraints). It writes
`<out>/hero_<variant>.glb` and `<out>/hero_<variant>.json` (measured stats and the runtime
contract). `pack.py --heroes` compresses them into apps/web/public/city/characters/.

`--render <dir>` also renders the acceptance views (walker variant): a turntable in `walk` and
`sit_idle`, and a side view of `sit_idle` on a bench of the H7 size.
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
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

from tl_assets.characters import hero, rig  # noqa: E402
from tl_assets.characters import parts as H  # noqa: E402
from tl_assets.characters import proportions as P  # noqa: E402
from tl_assets.characters import props as PR  # noqa: E402

RAW = ASSETS_DIR / "out" / "raw" / "characters"
LOD1_MAX_TRIS = 2000
LOD1_DROP_ROLES = {"eye_hi", "brow", "glasses", "blush"}
LOD_MAX_M = (40.0, None)  # LOD1 beyond 40 m (H3)
HEM_LEVEL = 0.55  # share of the shin swing the lower kain lobe does not follow
HEM_FOLLOW = 0.6  # share of the ankle offset the lobe is shifted by
HEM_R, HEM_DROP, HEM_CLEAR = 0.24, 0.035, 0.004  # hem ring radius, depth below the ankle, clearance


# --- scene -------------------------------------------------------------------------------


def reset() -> None:
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for block in list(coll):
            coll.remove(block)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    scene = bpy.context.scene
    scene.render.fps = rig.FPS
    scene.render.fps_base = 1.0


def tri_count(obj) -> int:
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def decimate_to(obj, max_tris: int) -> None:
    tris = tri_count(obj)
    if tris <= max_tris:
        return
    ratio = max_tris / tris
    for _ in range(6):
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        n = _eval_tris(obj, bpy.context.evaluated_depsgraph_get())
        if n <= max_tris:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            return
        obj.modifiers.remove(mod)
        ratio *= 0.93 * max_tris / n
    raise RuntimeError(f"{obj.name}: decimate could not reach {max_tris} tris")


def _eval_tris(obj, dg) -> int:
    me = obj.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    obj.evaluated_get(dg).to_mesh_clear()
    return n


def base_groups(obj) -> list[str]:
    """The C-T2 part group of every vertex (ignoring the soft kain_L/kain_R helpers)."""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        gs = [names[g.group] for g in v.groups if names[g.group] not in ("kain_L", "kain_R")]
        if not gs:
            raise RuntimeError(f"{obj.name}: vertex {v.index} has no part group")
        out.append(gs[0])
    return out


def skin(obj, arm) -> None:
    groups = base_groups(obj)
    obj.vertex_groups.clear()
    vg = {b.name: obj.vertex_groups.new(name=b.name) for b in rig.bones() if b.deform}
    for v, g in zip(obj.data.vertices, groups, strict=True):
        for bone, w in rig.vertex_weights(g, tuple(v.co)).items():
            vg[bone].add([v.index], w, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("armature", "ARMATURE")
    mod.object = arm


def build_armature(variant: str):
    data = bpy.data.armatures.new("hero_rig")
    arm = bpy.data.objects.new("hero", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b in rig.bones(variant):
        eb = data.edit_bones.new(b.name)
        eb.head, eb.tail = b.head, b.tail
        eb.roll = 0.0
        eb.use_deform = b.deform
        if b.parent:
            eb.parent = data.edit_bones[b.parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.pose.bones:
        b.rotation_mode = "QUATERNION"
    # the skirt squash relies on the leg bones' local z being the rest-frame depth (world y)
    for s in ("L", "R"):
        for n in (f"skirt_thigh_{s}", f"skirt_shin_{s}"):
            z = data.bones[n].matrix_local.to_3x3().col[2]
            if z.y < 0.999:
                raise RuntimeError(f"{n}: local z is {tuple(z)}, expected world +y")
    return arm


def bone_parent(obj, arm, bone: str) -> None:
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world


def prop_meshes(variant: str, mat) -> list[tuple[str, list]]:
    """(name stem, parts, bone) per prop mesh of a variant."""
    if variant == "walker":
        return [("prop", H.walker_parts(), "prop")]
    if variant == "stroller":
        return [("prop", PR.stroller_parts(), "prop")]
    if variant == "wheelchair":
        return [
            ("prop", PR.wheelchair_parts(), "prop"),
            ("prop_wheels", PR.wheelchair_wheels(), "wheels"),
        ]
    return []


# --- pose solving (FK + two-bone IK, mathutils) --------------------------------------------


class Solver:
    def __init__(self, arm, variant: str):
        self.variant = variant
        self.bones = rig.bones(variant)
        self.names = [b.name for b in self.bones]
        self.parent = {b.name: b.parent for b in self.bones}
        self.rest = {n: arm.data.bones[n].matrix_local.copy() for n in self.names}
        self.rest_inv = {n: m.inverted() for n, m in self.rest.items()}
        hand_vec = {s: Vector(rig._sub(rig.PALM, rig.WRIST)) for s in ("L", "R")}
        hand_vec["R"].x *= -1
        self.hand_vec = hand_vec

    def fk(self, basis: dict) -> dict:
        pose = {}
        for n in self.names:
            p = self.parent[n]
            m = self.rest[n] @ basis[n]
            pose[n] = m if p is None else pose[p] @ self.rest_inv[p] @ m
        return pose

    def _set_world(self, basis, pose, n, rot3: Matrix) -> dict:
        """Give bone `n` the world rotation `rot3` (head stays), keep its basis translation."""
        p = self.parent[n]
        carry = self.rest[n] if p is None else pose[p] @ self.rest_inv[p] @ self.rest[n]
        head = pose[n].translation
        want = Matrix.LocRotScale(head, rot3, None)
        b = carry.inverted() @ want
        loc = basis[n].translation.copy()
        basis[n] = Matrix.LocRotScale(loc, b.to_quaternion(), basis[n].to_scale())
        return self.fk(basis)

    def _aim(self, basis, pose, n, direction: Vector) -> dict:
        cur = pose[n].to_3x3().normalized()
        q = cur.col[1].rotation_difference(direction.normalized())
        return self._set_world(basis, pose, n, q.to_matrix() @ cur)

    def _level_hem(self, basis, pose, side: str, skirt: float) -> dict:
        """Walking: keep the lower kain lobe closer to upright than the shin (the hem would
        otherwise flip up like a plate behind a bent knee), and shift it so its bottom still
        follows the ankle."""
        k = HEM_LEVEL * (1.0 - skirt)
        if k <= 0:
            return pose
        n = f"skirt_shin_{side}"
        shin = pose[f"shin_{side}"]
        ref = pose["hips"].to_3x3() @ self.rest["hips"].to_3x3().inverted() @ self.rest[n].to_3x3()
        q = shin.to_quaternion().slerp(ref.to_quaternion(), k)
        knee = shin.translation
        ankle = pose[f"foot_{side}"].translation
        rest_vec = self.rest[f"foot_{side}"].translation - self.rest[n].translation
        lobe_end = knee + q.to_matrix() @ self.rest[n].to_3x3().inverted() @ rest_vec
        head = knee + (ankle - lobe_end) * HEM_FOLLOW
        # keep the hem off the ground: lowest point of the tilted hem ring (radius HEM_R,
        # HEM_DROP below the ankle along the lobe) at least HEM_CLEAR above z = 0
        axis = lobe_end - knee
        a = axis.normalized()
        centre = head + axis * ((rig.SHIN + HEM_DROP) / rig.SHIN)
        low = centre.z - HEM_R * math.sqrt(max(0.0, 1.0 - a.z * a.z))
        if low < HEM_CLEAR:
            head.z += HEM_CLEAR - low
        p = self.parent[n]
        carry = pose[p] @ self.rest_inv[p] @ self.rest[n]
        want = Matrix.LocRotScale(head, q.to_matrix(), None)
        b = carry.inverted() @ want
        basis[n] = Matrix.LocRotScale(b.translation, b.to_quaternion(), basis[n].to_scale())
        return self.fk(basis)

    @staticmethod
    def delta(pitch: float, roll: float, yaw: float) -> Matrix:
        """World-axis rotation: pitch forward (+x), roll to her left (+y), yaw to her left (+z)."""
        rx = Matrix.Rotation(math.radians(pitch), 3, "X")
        ry = Matrix.Rotation(math.radians(roll), 3, "Y")
        rz = Matrix.Rotation(math.radians(yaw), 3, "Z")
        return rz @ rx @ ry

    def _local_rot(self, n, d3: Matrix) -> Quaternion:
        r = self.rest[n].to_3x3()
        return (r.inverted() @ d3 @ r).to_quaternion()

    def hand_rot(self, s: str, fingers: Vector, palm: Vector) -> Matrix:
        """World delta for the hand: rest hand axis -> fingers, rest palm (-z) -> palm."""
        rest_dir = self.hand_vec[s].normalized()
        f = fingers.normalized()
        q1 = rest_dir.rotation_difference(f)
        n1 = q1 @ Vector((0.0, 0.0, -1.0))
        n = palm - f * palm.dot(f)
        if n.length < 1e-6:
            return q1.to_matrix()
        n.normalize()
        ang = n1.angle(n, 0.0)
        if f.dot(n1.cross(n)) < 0:
            ang = -ang
        return (Quaternion(f, ang) @ q1).to_matrix()

    def grip_frame(self, pose_m, s: str, yaw: float) -> tuple[Vector, Vector, Vector]:
        pos = pose_m[f"grip_{s}"].translation.copy()
        rz = Matrix.Rotation(math.radians(yaw), 3, "Z")
        if self.variant == "wheelchair":
            k = 1 if s == "L" else -1
            fingers = Vector((0.0, -0.8, -0.6))
            palm = Vector((0.25 * k, 0.0, -1.0))
        else:
            fingers = Vector((0.0, -math.cos(math.radians(10)), -math.sin(math.radians(10))))
            palm = Vector((0.0, 0.0, -1.0))
        return pos, rz @ fingers, rz @ palm

    def solve(self, pose: rig.Pose) -> tuple[dict, dict]:
        """The basis matrix of every bone for a `rig.Pose`, and the palm-to-target error (m)."""
        basis = {n: Matrix.Identity(4) for n in self.names}

        def set_rot(n, d3, loc=None):
            q = self._local_rot(n, d3)
            t = Vector((0, 0, 0)) if loc is None else loc
            basis[n] = Matrix.LocRotScale(t, q, basis[n].to_scale())

        hips_loc = self.rest["hips"].to_3x3().inverted() @ Vector(pose.hips)
        set_rot("hips", Matrix.Identity(3), hips_loc)
        for n, (pitch, roll, yaw) in pose.rot.items():
            loc = basis[n].translation.copy()
            set_rot(n, self.delta(pitch, roll, yaw), loc)
        prop_loc = self.rest["prop"].to_3x3().inverted() @ Vector(pose.prop)
        set_rot("prop", self.delta(0.0, 0.0, pose.prop_yaw), prop_loc)
        set_rot("wheels", self.delta(math.degrees(pose.wheel), 0.0, 0.0))
        s = pose.skirt
        for side in ("L", "R"):
            basis[f"skirt_thigh_{side}"] = Matrix.LocRotScale(
                Vector((0.0, 0.0, -0.06 * s)), None, Vector((1.0, 1.0, 1.0 - 0.5 * s))
            )
            basis[f"skirt_shin_{side}"] = Matrix.LocRotScale(
                None, None, Vector((1.0, 1.0, 1.0 - 0.4 * s))
            )
        pose_m = self.fk(basis)

        # legs
        for side, leg in (("L", pose.leg_L), ("R", pose.leg_R)):
            hip = pose_m[f"thigh_{side}"].translation
            knee, end = rig.two_bone(tuple(hip), leg.ankle, rig.THIGH, rig.SHIN, (0.0, -1.0, 0.25))
            pose_m = self._aim(basis, pose_m, f"thigh_{side}", Vector(knee) - hip)
            pose_m = self._aim(basis, pose_m, f"shin_{side}", Vector(end) - Vector(knee))
            foot = self.delta(leg.pitch, 0.0, 0.0) @ self.rest[f"foot_{side}"].to_3x3()
            pose_m = self._set_world(basis, pose_m, f"foot_{side}", foot)
            pose_m = self._level_hem(basis, pose_m, side, pose.skirt)

        # arms
        err = {}
        for side, a in (("L", pose.arm_L), ("R", pose.arm_R)):
            gpos, gf, gp = self.grip_frame(pose_m, side, pose.prop_yaw)
            if a.cross > 0:  # a hand-over: the target slides to the other side's grip
                other = "R" if side == "L" else "L"
                opos = pose_m[f"grip_{other}"].translation
                gpos = gpos * (1 - a.cross) + opos * a.cross
            g = a.grip
            target = gpos * g + Vector(a.pos) * (1 - g)
            fingers = gf * g + Vector(a.fingers) * (1 - g)
            palm = gp * g + Vector(a.palm) * (1 - g)
            d_hand = self.hand_rot(side, fingers, palm)
            wrist = target - d_hand @ self.hand_vec[side]
            shoulder = pose_m[f"upper_arm_{side}"].translation
            k = 1 if side == "L" else -1
            elbow, end = rig.two_bone(
                tuple(shoulder), tuple(wrist), rig.UPPER_ARM, rig.FOREARM, (0.6 * k, 0.35, -0.8)
            )
            pose_m = self._aim(basis, pose_m, f"upper_arm_{side}", Vector(elbow) - shoulder)
            pose_m = self._aim(basis, pose_m, f"forearm_{side}", Vector(end) - Vector(elbow))
            hand = d_hand @ self.rest[f"hand_{side}"].to_3x3()
            pose_m = self._set_world(basis, pose_m, f"hand_{side}", hand)
            err[side] = (pose_m[f"palm_{side}"].translation - target).length
        return basis, err


# --- clips ---------------------------------------------------------------------------------


def bake_clip(arm, solver: Solver, variant: str, clip: str) -> tuple[bpy.types.Action, dict]:
    dur = rig.durations(variant)[clip]
    n = rig.frame_count(dur)
    frames = []
    errs = {"L": 0.0, "R": 0.0}
    for f in range(n + 1):
        t = dur * f / n
        basis, err = solver.solve(rig.clip_pose(variant, clip, t))
        frames.append(basis)
        for s in errs:
            errs[s] = max(errs[s], err[s])
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    arm.animation_data.action = act
    for name in solver.names:
        locs, quats, scales = [], [], []
        prev = None
        for b in frames:
            loc, q, sc = b[name].decompose()
            if prev is not None and q.dot(prev) < 0:
                q = -q
            prev = q
            locs.append(loc)
            quats.append(q)
            scales.append(sc)
        for path, vals, size in (
            ("location", locs, 3),
            ("rotation_quaternion", quats, 4),
            ("scale", scales, 3),
        ):
            for i in range(size):
                fc = act.fcurve_ensure_for_datablock(
                    arm, f'pose.bones["{name}"].{path}', index=i, group_name=name
                )
                co = []
                for f, v in enumerate(vals):
                    co += [float(f), float(v[i])]
                fc.keyframe_points.add(len(vals))
                fc.keyframe_points.foreach_set("co", co)
                fc.keyframe_points.foreach_set("interpolation", [1] * len(vals))  # LINEAR
                fc.update()
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, n
    return act, {"duration": dur, "frames": n + 1, "palm_err_max": max(errs.values())}


def push_nla(arm, actions: list) -> None:
    arm.animation_data.action = None
    for act in actions:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, 0, act)


# --- build ---------------------------------------------------------------------------------


def build_variant(variant: str):
    reset()
    body_mat = hero.clay_material("hero_body")
    prop_mat = hero.clay_material("hero_prop", 0.4, 0.35, 0.0)
    arm = build_armature(variant)
    arm.animation_data_create()

    lod0 = hero.make_object("hero__LOD0", H.hero_parts("tpose"), body_mat)
    lod1_parts = [
        p for p in H.hero_parts("tpose") if not isinstance(p[1], str) or p[1] not in LOD1_DROP_ROLES
    ]
    lod1 = hero.make_object("hero__LOD1", lod1_parts, body_mat)
    props = []
    for stem, parts, bone in prop_meshes(variant, prop_mat):
        p0 = hero.make_object(f"{stem}__LOD0", parts, prop_mat)
        p1 = hero.make_object(f"{stem}__LOD1", parts, prop_mat)
        props.append((p0, p1, bone))
    prop_budget = 420 if props else 0
    for _p0, p1, _b in props:
        decimate_to(p1, prop_budget // len(props))
    decimate_to(lod1, LOD1_MAX_TRIS - sum(tri_count(p1) for _p0, p1, _b in props) - 20)
    for body in (lod0, lod1):
        skin(body, arm)
    for p0, p1, bone in props:
        for p in (p0, p1):
            for g in list(p.vertex_groups):
                p.vertex_groups.remove(g)
            bone_parent(p, arm, bone)
    return arm, lod0, lod1, props


def bake_all(arm, variant: str) -> tuple[list, dict]:
    solver = Solver(arm, variant)
    acts, clips = [], {}
    for clip in rig.CLIPS:
        act, info = bake_clip(arm, solver, variant, clip)
        info["loop"] = clip in rig.LOOPS
        acts.append(act)
        clips[clip] = info
    return acts, clips


def sit_contact(arm, act) -> dict:
    """Bone heights in the middle of `sit_idle` (true metres, Blender frame)."""
    set_action(arm, act, 0)
    pb = arm.pose.bones
    hips = arm.matrix_world @ pb["hips"].head
    return {"hips": [round(c, 4) for c in hips]}


def set_action(arm, act, frame: int) -> None:
    arm.animation_data.action = act
    if act.slots and arm.animation_data.action_slot is None:
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def export(variant: str, out: Path, render_dir: Path | None) -> dict:
    arm, lod0, lod1, props = build_variant(variant)
    acts, clips = bake_all(arm, variant)
    stats = {
        "variant": variant,
        "bones": len(arm.data.bones),
        "lods": [
            {
                "node": f"hero__LOD{i}",
                "tris": tri_count(body) + sum(tri_count(p[i]) for p in props),
                "maxM": LOD_MAX_M[i],
            }
            for i, body in enumerate((lod0, lod1))
        ],
        "clips": clips,
        "sit": sit_contact(arm, acts[rig.CLIPS.index("sit_idle")]),
    }
    if render_dir is not None:
        from tl_assets.characters import turntable

        turntable.render_all(arm, acts, variant, render_dir)
    push_nla(arm, acts)
    bpy.context.scene.frame_set(0)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"hero_{variant}.glb"
    for o in (lod0, lod1, *[p for t in props for p in t[:2]]):
        attrs = o.data.color_attributes
        idx = next(i for i, a in enumerate(attrs) if a.name == "COLOR_0")
        attrs.active_color_index = idx
        attrs.render_color_index = idx
    keep = {arm, lod0, lod1, *[p for t in props for p in t[:2]]}
    for o in bpy.data.objects:  # only the hero: never the render bench, ground or lights
        o.select_set(o in keep)
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
        "export_texcoords": False,
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
        "export_force_sampling": True,
        "export_frame_step": 1,
        "export_optimize_animation_size": True,
        "export_anim_single_armature": True,
        "export_reset_pose_bones": True,
        "export_draco_mesh_compression_enable": False,
    }
    kw = {k: v for k, v in kw.items() if k in ("filepath", "export_format") or k in props_rna}
    bpy.ops.export_scene.gltf(**kw)
    stats["raw_bytes"] = path.stat().st_size
    stats["display_scale"] = P.DISPLAY_SCALE
    (out / f"hero_{variant}.json").write_text(json.dumps(stats, indent=2) + "\n", newline="\n")
    print(json.dumps(stats, indent=2))
    return stats


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="export_hero.py")
    ap.add_argument("--variant", action="append", choices=rig.VARIANTS, default=[])
    ap.add_argument("--out", type=Path, default=RAW)
    ap.add_argument(
        "--render",
        type=Path,
        default=None,
        help="acceptance renders (walker at the root, others in <dir>/<variant>)",
    )
    args = ap.parse_args(argv)
    for v in args.variant or list(rig.VARIANTS):
        rd = None if args.render is None else (args.render if v == "walker" else args.render / v)
        export(v, args.out, rd)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
